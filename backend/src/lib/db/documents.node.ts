import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';
import { editorDocumentJsonSchema } from '@/lib/ai/document-processing/schemas';
import { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';

export const DOCUMENTS_COLLECTION = 'documents';
export { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';

const configuredEmbeddingSchema = z.array(z.number().finite()).min(1).superRefine((embedding, context) => {
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  if (Number.isInteger(dimensions) && dimensions > 0 && embedding.length !== dimensions) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Embedding must contain ${dimensions} dimensions.` });
  }
});

export const documentSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid(),
  name: z.string().trim().min(1),
  extension: documentExtensionSchema,
  mimeType: z.string().trim().min(1),
  html: z.string().min(1),
  storageKey: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  json: editorDocumentJsonSchema,
  content: z.string().trim().min(1),
  embedding: configuredEmbeddingSchema,
  speechStorageKeys: z.array(z.string().trim().min(1)).optional(),
  deletedAt: z.string().datetime().nullable().default(null),
  _internalDeletion: z.object({
    kind: z.enum(['folder', 'document', 'version']),
    owner: z.string().trim().min(1),
    objectKeys: z.array(z.string().trim().min(1)).optional(),
    startedAt: z.string().datetime(),
    versionKey: z.string().cuid().optional(),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Document = z.infer<typeof documentSchema>;
export type DocumentExtension = z.infer<typeof documentExtensionSchema>;
export const documentsEmbeddingFields = ['name', 'content'] as const;
const helpers = createNodeHelpers(DOCUMENTS_COLLECTION, documentSchema, documentsEmbeddingFields);
export async function insertDocument(document: Document): Promise<Document> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.insertDocument(document);
}
export const getDocumentById = helpers.getById;
export const upsertDocumentByKey = helpers.upsertByKey;
export const getAllDocumentsChunked = helpers.getAllChunked;
export const listDocumentsPage = helpers.listPage;

export async function updateDocument(documentKey: string, patch: import('./archive-persistence.node').ScopedDocumentPatch): Promise<Document> {
  const current = await helpers.getById(documentKey);
  if (!current) throw new Error(`Document ${documentKey} was not found.`);
  const scoped = await updateDocumentInScope(current.scopeKey, documentKey, patch);
  if (!scoped) throw new Error(`Document ${documentKey} left scope ${current.scopeKey} during update.`);
  return scoped;
}

export async function updateDocumentInScope(scopeKey: string, documentKey: string, patch: import('./archive-persistence.node').ScopedDocumentPatch) {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.updateDocument(scopeKey, documentKey, patch);
}

export async function deleteDocumentInScope(scopeKey: string, documentKey: string): Promise<boolean> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.deleteDocument(scopeKey, documentKey);
}

export async function deleteDocument(documentKey: string): Promise<void> {
  const current = await helpers.getById(documentKey);
  if (!current || !await deleteDocumentInScope(current.scopeKey, documentKey)) throw new Error(`Document ${documentKey} was not found.`);
}

function assertConfiguredEmbeddingDimensions(embedding: number[]): void {
  const configuredDimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  if (Number.isInteger(configuredDimensions) && configuredDimensions > 0 && embedding.length !== configuredDimensions) {
    throw new Error(`Document embedding must contain ${configuredDimensions} dimensions.`);
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
  const document = documentSchema.parse(input);
  assertConfiguredEmbeddingDimensions(document.embedding);
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.insertDocument(document);
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
  options: { folderKey?: string; includeArchived?: boolean; includePendingDeletion?: boolean } = {},
): Promise<Document[]> {
  const cursor = await db.query(aql`
    FOR document IN ${db.collection(DOCUMENTS_COLLECTION)}
      FILTER document.scopeKey == ${scopeKey}
      FILTER ${options.includePendingDeletion ?? false} || !HAS(document, "_internalDeletion") || document._internalDeletion == null
      FILTER ${options.folderKey ?? null} == null || document.folderKey == ${options.folderKey ?? null}
      FILTER ${options.includeArchived ?? false} || document.deletedAt == null
      SORT document.name ASC, document._key ASC
      RETURN document
  `);
  return (await cursor.all()).map((document) => documentSchema.parse(withArangoKey(document)));
}

export function listDocumentsByFolder(scopeKey: string, folderKey: string, includeArchived = false): Promise<Document[]> {
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

export interface ArchiveSemanticSearchInput {
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

export interface ArchiveSemanticMatch {
  source: 'document' | 'version';
  score: number;
  document: Document;
  version?: import('./document-versions.node').DocumentVersion;
}

/** Search boundaries are applied in AQL before scoring; callers cannot retrieve outside authorized scopes. */
export async function semanticSearchArchive(input: ArchiveSemanticSearchInput): Promise<ArchiveSemanticMatch[]> {
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
        LET folder = DOCUMENT(${db.collection('folders')}, document.folderKey)
        FILTER folder != null && folder.scopeKey == document.scopeKey
        FILTER ${input.includeArchived ?? false} || document.deletedAt == null
        FILTER ${input.includeArchived ?? false} || folder.deletedAt == null
        FILTER ${folderKeys} == null || document.folderKey IN ${folderKeys ?? []}
        FILTER ${documentKeys} == null || document._key IN ${documentKeys ?? []}
        FILTER ${extensions} == null || document.extension IN ${extensions ?? []}
        FILTER ${mimeTypes} == null || document.mimeType IN ${mimeTypes ?? []}
        FILTER ${createdAfter ?? null} == null || document.createdAt >= ${createdAfter ?? null}
        FILTER ${createdBefore ?? null} == null || document.createdAt <= ${createdBefore ?? null}
        FILTER ${input.updatedAfter ?? null} == null || document.updatedAt >= ${input.updatedAfter ?? null}
        FILTER ${input.updatedBefore ?? null} == null || document.updatedAt <= ${input.updatedBefore ?? null}
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(${input.embedding})
        LET score = COSINE_SIMILARITY(document.embedding, ${input.embedding})
        FILTER score >= ${input.minScore ?? 0}
        RETURN { source: "document", score, document }
    ) : []
    LET versionMatches = ${sources.includes('version')} ? (
      FOR version IN ${db.collection('documentVersions')}
        FILTER version.scopeKey IN ${input.authorizedScopeKeys}
        FILTER ${input.includeArchived ?? false} || version.deletedAt == null
        FILTER ${documentKeys} == null || version.documentKey IN ${documentKeys ?? []}
        FILTER ${createdAfter ?? null} == null || version.createdAt >= ${createdAfter ?? null}
        FILTER ${createdBefore ?? null} == null || version.createdAt <= ${createdBefore ?? null}
        FILTER ${input.updatedAfter ?? null} == null || (version.updatedAt != null ? version.updatedAt : version.createdAt) >= ${input.updatedAfter ?? null}
        FILTER ${input.updatedBefore ?? null} == null || (version.updatedAt != null ? version.updatedAt : version.createdAt) <= ${input.updatedBefore ?? null}
        FILTER IS_ARRAY(version.embedding) && LENGTH(version.embedding) == LENGTH(${input.embedding})
        LET document = DOCUMENT(${db.collection(DOCUMENTS_COLLECTION)}, version.documentKey)
        FILTER document != null && document.scopeKey == version.scopeKey
        FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
        LET folder = DOCUMENT(${db.collection('folders')}, document.folderKey)
        FILTER folder != null && folder.scopeKey == document.scopeKey
        FILTER ${input.includeArchived ?? false} || document.deletedAt == null
        FILTER ${input.includeArchived ?? false} || folder.deletedAt == null
        FILTER ${folderKeys} == null || document.folderKey IN ${folderKeys ?? []}
        FILTER ${extensions} == null || document.extension IN ${extensions ?? []}
        FILTER ${mimeTypes} == null || document.mimeType IN ${mimeTypes ?? []}
        LET score = COSINE_SIMILARITY(version.embedding, ${input.embedding})
        FILTER score >= ${input.minScore ?? 0}
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
      ...(source === 'version' ? { version: documentVersionSchema.parse(withArangoKey(match.version as Record<string, unknown>)) } : {}),
    };
  });
}

export function semanticSearchDocuments(input: Omit<ArchiveSemanticSearchInput, 'sources'>): Promise<ArchiveSemanticMatch[]> {
  return semanticSearchArchive({ ...input, sources: ['document'] });
}
