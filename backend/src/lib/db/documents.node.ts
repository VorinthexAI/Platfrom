import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';
import { EMBEDDING_DIMENSIONS, currentEmbeddingBatchSchema, currentEmbeddingSchema, embedTexts } from '@/lib/embeddings';
import { canonicalDocumentRepresentations } from '@/lib/ai/document-processing/representation';
import { chunkDocumentContent, documentContentChunksSchema, documentEmbeddingTexts, documentSemanticHash } from '@/lib/ai/document-processing/chunking';

export const DOCUMENTS_COLLECTION = 'documents';
export { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';

export const documentSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1),
  extension: documentExtensionSchema.optional(),
  mimeType: z.string().trim().min(1).optional(),
  html: z.string().min(1).refine((value) => value.trim().length > 0, 'HTML must not be blank.'),
  storageKey: z.string().trim().min(1).optional(),
  sizeBytes: z.number().int().positive().optional(),
  content: z.string().trim().min(1),
  embedding: currentEmbeddingSchema,
  contentChunks: documentContentChunksSchema.optional(),
  chunkEmbeddings: currentEmbeddingBatchSchema.optional(),
  semanticChunkCount: z.number().int().positive().optional(),
  semanticContentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  _semanticChunkingSkipped: z.boolean().optional(),
  speechStorageKeys: z.array(z.string().trim().min(1)).optional(),
  isFavorite: z.boolean().default(false),
  deletedAt: z.string().datetime().nullable().default(null),
  _internalDeletion: z.object({
    kind: z.literal('document'),
    owner: z.string().trim().min(1),
    objectKeys: z.array(z.string().trim().min(1)).optional(),
    startedAt: z.string().datetime(),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Document = z.infer<typeof documentSchema>;
export type DocumentExtension = z.infer<typeof documentExtensionSchema>;
export const documentsEmbeddingFields = ['name', 'content'] as const;
const helpers = createNodeHelpers(DOCUMENTS_COLLECTION, documentSchema, documentsEmbeddingFields, { includeEmbeddingMetadata: false });
export async function insertDocument(document: Document): Promise<Document> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.insertDocument(document);
}
export const getDocumentById = helpers.getById;
export async function upsertDocumentByKey(input: Omit<z.input<typeof documentSchema>, 'embedding' | 'contentChunks' | 'chunkEmbeddings'>): Promise<Document> {
  const representations = canonicalDocumentRepresentations(input.html);
  const contentChunks = chunkDocumentContent(representations.content);
  const chunkEmbeddings = await embedTexts({ texts: documentEmbeddingTexts(input.name, contentChunks) });
  const document = documentSchema.parse({ ...input, ...representations, contentChunks, embedding: chunkEmbeddings[0], chunkEmbeddings, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(representations.content) });
  const result = await db.collection(DOCUMENTS_COLLECTION).save(toArangoDoc(document), { returnNew: true, overwriteMode: 'replace' });
  return documentSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}
export const getAllDocumentsChunked = helpers.getAllChunked;
export const listDocumentsPage = helpers.listPage;

export async function updateDocument(documentKey: string, patch: import('./content-persistence.node').ScopedDocumentPatch): Promise<Document> {
  const current = await helpers.getById(documentKey);
  if (!current) throw new Error(`Document ${documentKey} was not found.`);
  const scoped = await updateDocumentInScope(current.scopeKey, documentKey, patch);
  if (!scoped) throw new Error(`Document ${documentKey} left scope ${current.scopeKey} during update.`);
  return scoped;
}

export async function updateDocumentInScope(scopeKey: string, documentKey: string, patch: import('./content-persistence.node').ScopedDocumentPatch, options?: { expectedUpdatedAt?: string }) {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.updateDocument(scopeKey, documentKey, patch, options);
}

export async function deleteDocumentInScope(scopeKey: string, documentKey: string): Promise<boolean> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.deleteDocument(scopeKey, documentKey);
}

export async function deleteDocument(documentKey: string): Promise<void> {
  const current = await helpers.getById(documentKey);
  if (!current || !await deleteDocumentInScope(current.scopeKey, documentKey)) throw new Error(`Document ${documentKey} was not found.`);
}

function assertConfiguredEmbeddingDimensions(embedding: number[]): void {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Document embedding must contain ${EMBEDDING_DIMENSIONS} dimensions.`);
  }
}

export async function archiveDocument(key: string): Promise<Document> {
  const timestamp = new Date().toISOString();
  return updateDocument(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreDocument(key: string): Promise<Document> {
  const timestamp = new Date().toISOString();
  return updateDocument(key, { deletedAt: null, updatedAt: timestamp });
}

/** Inserts an already embedded document without invoking the generic auto-embed path. */
export async function insertPreparedDocument(input: Document): Promise<Document> {
  const expectedChunks = chunkDocumentContent(input.content);
  if (input.contentChunks && (input.contentChunks.length !== expectedChunks.length || input.contentChunks.some((chunk, index) => chunk !== expectedChunks[index]))) throw new Error('Document chunks must be derived from canonical content.');
  const contentChunks = input.contentChunks ?? expectedChunks;
  const chunkEmbeddings = input.chunkEmbeddings ?? (contentChunks.length === 1 ? [input.embedding] : undefined);
  const document = documentSchema.parse({ ...input, contentChunks, chunkEmbeddings, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(input.content), _semanticChunkingSkipped: undefined });
  currentEmbeddingSchema.parse(document.embedding);
  if (!document.contentChunks || !document.chunkEmbeddings || document.contentChunks.length !== document.chunkEmbeddings.length) throw new Error('Prepared documents require aligned semantic chunks and embeddings.');
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.insertDocument(document);
}

export async function getDocumentInScope(scopeKey: string, documentKey: string, includeArchived = false): Promise<Document | null> {
  const cursor = await db.query(aql`
    FOR document IN ${db.collection(DOCUMENTS_COLLECTION)}
      FILTER document._key == ${documentKey} && document.scopeKey == ${scopeKey}
      FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
      FILTER ${includeArchived} || document.deletedAt == null
      LIMIT 1
      RETURN document
  `);
  const document = await cursor.next();
  return document ? documentSchema.parse(withArangoKey(document)) : null;
}

export async function listDocumentsByScope(
  scopeKey: string,
  options: { folderKey?: string | null; includeArchived?: boolean; includePendingDeletion?: boolean } = {},
): Promise<Document[]> {
  const hasFolderBoundary = Object.prototype.hasOwnProperty.call(options, 'folderKey');
  const cursor = await db.query(aql`
    FOR document IN ${db.collection(DOCUMENTS_COLLECTION)}
      FILTER document.scopeKey == ${scopeKey}
      FILTER ${options.includePendingDeletion ?? false} || !HAS(document, "_internalDeletion") || document._internalDeletion == null
      FILTER !${hasFolderBoundary} || (${options.folderKey ?? null} == null
        ? (!HAS(document, "folderKey") || document.folderKey == null)
        : document.folderKey == ${options.folderKey ?? null})
      FILTER ${options.includeArchived ?? false} || document.deletedAt == null
      SORT document.name ASC, document._key ASC
      RETURN document
  `);
  return (await cursor.all()).map((document) => documentSchema.parse(withArangoKey(document)));
}

export function listDocumentsByFolder(scopeKey: string, folderKey: string | null, includeArchived = false): Promise<Document[]> {
  return listDocumentsByScope(scopeKey, { folderKey, includeArchived });
}

export async function listDocumentsByKeysInScope(
  scopeKey: string,
  documentKeys: string[],
  includeArchived = false,
): Promise<Document[]> {
  if (documentKeys.length === 0) return [];
  const cursor = await db.query(aql`
    FOR document IN ${db.collection(DOCUMENTS_COLLECTION)}
      FILTER document.scopeKey == ${scopeKey} && document._key IN ${documentKeys}
      FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
      FILTER ${includeArchived} || document.deletedAt == null
      SORT POSITION(${documentKeys}, document._key) ASC
      RETURN document
  `);
  return (await cursor.all()).map((document) => documentSchema.parse(withArangoKey(document)));
}

export interface ContentSemanticSearchInput {
  embedding: number[];
  authorizedScopeKeys: string[];
  sources?: Array<'document' | 'version'>;
  folderKeys?: string[];
  documentKeys?: string[];
  extensions?: DocumentExtension[];
  mimeTypes?: string[];
  createdFrom?: string;
  createdTo?: string;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  includeArchived?: boolean;
  minScore?: number;
  limit?: number;
}

export interface ContentSemanticMatch {
  source: 'document' | 'version';
  score: number;
  document: Document;
  matchedContent?: string;
  version?: import('./document-versions.node').DocumentVersion;
}

/** Search boundaries are applied in AQL before scoring; callers cannot retrieve outside authorized scopes. */
export async function semanticSearchContent(input: ContentSemanticSearchInput): Promise<ContentSemanticMatch[]> {
  if (input.authorizedScopeKeys.length === 0 || input.embedding.length === 0) return [];
  if (input.embedding.some((value) => !Number.isFinite(value))) throw new Error('Search embedding must contain only finite values.');
  assertConfiguredEmbeddingDimensions(input.embedding);
  const sources = input.sources ?? ['document'];
  if (sources.length === 0) return [];
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
  const createdAfter = input.createdAfter ?? input.createdFrom;
  const createdBefore = input.createdBefore ?? input.createdTo;
  const folderKeys = input.folderKeys?.length ? input.folderKeys : null;
  const documentKeys = input.documentKeys?.length ? input.documentKeys : null;
  const extensions = input.extensions?.length ? input.extensions : null;
  const mimeTypes = input.mimeTypes?.length ? input.mimeTypes : null;
  const cursor = await db.query(aql`
    LET documentMatches = ${sources.includes('document')} ? (
      FOR document IN ${db.collection(DOCUMENTS_COLLECTION)}
        FILTER document.scopeKey IN ${input.authorizedScopeKeys}
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(${db.collection('folders')}, document.folderKey) : null
        FILTER folder == null || folder.scopeKey == document.scopeKey
        FILTER folder == null || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
        FILTER ${input.includeArchived ?? false} || document.deletedAt == null
        FILTER ${input.includeArchived ?? false} || folder == null || folder.deletedAt == null
        FILTER ${folderKeys} == null || document.folderKey IN ${folderKeys ?? []}
        FILTER ${documentKeys} == null || document._key IN ${documentKeys ?? []}
        FILTER ${extensions} == null || document.extension IN ${extensions ?? []}
        FILTER ${mimeTypes} == null || document.mimeType IN ${mimeTypes ?? []}
        FILTER ${createdAfter ?? null} == null || document.createdAt >= ${createdAfter ?? null}
        FILTER ${createdBefore ?? null} == null || document.createdAt <= ${createdBefore ?? null}
        FILTER ${input.updatedAfter ?? null} == null || document.updatedAt >= ${input.updatedAfter ?? null}
        FILTER ${input.updatedBefore ?? null} == null || document.updatedAt <= ${input.updatedBefore ?? null}
        LET vectors = IS_ARRAY(document.chunkEmbeddings) && LENGTH(document.chunkEmbeddings) > 0 ? document.chunkEmbeddings : [document.embedding]
        LET rankedVectors = (FOR index IN 0..LENGTH(vectors)-1 LET vector = vectors[index] FILTER IS_ARRAY(vector) && LENGTH(vector) == LENGTH(${input.embedding}) && LENGTH(vector[* FILTER !IS_NUMBER(CURRENT)]) == 0 LET vectorScore = COSINE_SIMILARITY(vector, ${input.embedding}) SORT vectorScore DESC LIMIT 1 RETURN { index, score: vectorScore })
        LET bestVector = FIRST(rankedVectors)
        LET score = bestVector.score
        FILTER score != null
        FILTER score >= ${input.minScore ?? -1}
        LET matchedContent = IS_ARRAY(document.contentChunks) && bestVector.index < LENGTH(document.contentChunks) ? document.contentChunks[bestVector.index] : LEFT(document.content, 16000)
        RETURN { source: "document", score, document, matchedContent }
    ) : []
    LET versionMatches = ${sources.includes('version')} ? (
      FOR version IN ${db.collection('documentVersions')}
        FILTER version.scopeKey IN ${input.authorizedScopeKeys}
        FILTER ${input.includeArchived ?? false} || version.deletedAt == null
        FILTER ${documentKeys} == null || version.documentKey IN ${documentKeys ?? []}
        FILTER ${createdAfter ?? null} == null || version.createdAt >= ${createdAfter ?? null}
        FILTER ${createdBefore ?? null} == null || version.createdAt <= ${createdBefore ?? null}
        FILTER ${input.updatedAfter ?? null} == null || version.createdAt >= ${input.updatedAfter ?? null}
        FILTER ${input.updatedBefore ?? null} == null || version.createdAt <= ${input.updatedBefore ?? null}
        LET vectors = IS_ARRAY(version.chunkEmbeddings) && LENGTH(version.chunkEmbeddings) > 0 ? version.chunkEmbeddings : [version.embedding]
        LET scores = (FOR vector IN vectors FILTER IS_ARRAY(vector) && LENGTH(vector) == LENGTH(${input.embedding}) && LENGTH(vector[* FILTER !IS_NUMBER(CURRENT)]) == 0 RETURN COSINE_SIMILARITY(vector, ${input.embedding}))
        LET score = MAX(scores)
        FILTER score != null
        LET document = DOCUMENT(${db.collection(DOCUMENTS_COLLECTION)}, version.documentKey)
        FILTER document != null && document.scopeKey == version.scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        LET folder = HAS(document, "folderKey") && document.folderKey != null ? DOCUMENT(${db.collection('folders')}, document.folderKey) : null
        FILTER folder == null || folder.scopeKey == document.scopeKey
        FILTER ${input.includeArchived ?? false} || document.deletedAt == null
        FILTER ${input.includeArchived ?? false} || folder == null || folder.deletedAt == null
        FILTER ${folderKeys} == null || document.folderKey IN ${folderKeys ?? []}
        FILTER ${extensions} == null || document.extension IN ${extensions ?? []}
        FILTER ${mimeTypes} == null || document.mimeType IN ${mimeTypes ?? []}
        FILTER score >= ${input.minScore ?? -1}
        RETURN { source: "version", score, document, version }
    ) : []
    FOR match IN APPEND(documentMatches, versionMatches)
      SORT match.score DESC
      LIMIT ${limit}
      RETURN match
  `);
  const { documentVersionSchema } = await import('./document-versions.node');
  return (await cursor.all()).map((match: Record<string, unknown>) => {
    const source = match.source === 'version' ? 'version' : 'document';
    return {
      source,
      score: Number(match.score),
      document: documentSchema.parse(withArangoKey(match.document as Record<string, unknown>)),
      ...(typeof match.matchedContent === 'string' ? { matchedContent: match.matchedContent } : {}),
      ...(source === 'version' ? { version: documentVersionSchema.parse(withArangoKey(match.version as Record<string, unknown>)) } : {}),
    };
  });
}

export function semanticSearchDocuments(input: Omit<ContentSemanticSearchInput, 'sources'>): Promise<ContentSemanticMatch[]> {
  return semanticSearchContent({ ...input, sources: ['document'] });
}
