import { z } from 'zod';
import { aql } from 'arangojs';
import { editorDocumentJsonSchema } from '@/lib/ai/document-processing/schemas';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { db } from './client';

export const DOCUMENT_VERSIONS_COLLECTION = 'documentVersions';

const configuredEmbeddingSchema = z.array(z.number().finite()).min(1).superRefine((embedding, context) => {
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  if (Number.isInteger(dimensions) && dimensions > 0 && embedding.length !== dimensions) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `Embedding must contain ${dimensions} dimensions.` });
  }
});

export const documentVersionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  version: z.number().int().positive(),
  label: z.string().trim().min(1).max(120).optional(),
  html: z.string().min(1).refine((value) => value.trim().length > 0, 'HTML must not be blank.'),
  json: editorDocumentJsonSchema,
  content: z.string().trim().min(1),
  embedding: configuredEmbeddingSchema,
  // Legacy uploaded versions may retain their object reference; new snapshots do not require one.
  storageKey: z.string().trim().min(1).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional(),
});

export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export const documentVersionsEmbeddingFields = ['content'] as const;
const helpers = createNodeHelpers(DOCUMENT_VERSIONS_COLLECTION, documentVersionSchema, documentVersionsEmbeddingFields);
export const getDocumentVersionById = helpers.getById;
export const getAllDocumentVersionsChunked = helpers.getAllChunked;
export const listDocumentVersionsPage = helpers.listPage;

function assertConfiguredEmbeddingDimensions(embedding: number[]): void {
  const configuredDimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  if (Number.isInteger(configuredDimensions) && configuredDimensions > 0 && embedding.length !== configuredDimensions) {
    throw new Error(`Document version embedding must contain ${configuredDimensions} dimensions.`);
  }
}

/** Prepared snapshots preserve the exact embedding that belonged to the saved content. */
export async function insertDocumentVersion(input: DocumentVersion): Promise<DocumentVersion> {
  const snapshot = documentVersionSchema.parse(input);
  assertConfiguredEmbeddingDimensions(snapshot.embedding);
  const cursor = await db.query(`
    LET document = DOCUMENT(documents, @documentKey)
    FILTER document != null && document.scopeKey == @scopeKey
    FILTER !HAS(document, "_internalDeletion") || document._internalDeletion == null
    LET folder = DOCUMENT(folders, document.folderKey)
    FILTER folder != null && folder.scopeKey == @scopeKey
    FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
    INSERT @snapshot INTO documentVersions RETURN NEW
  `, { documentKey: snapshot.documentKey, scopeKey: snapshot.scopeKey, snapshot: toArangoDoc(snapshot) });
  const created = await cursor.next();
  if (!created) throw new Error('Document version owner is pending deletion.');
  return documentVersionSchema.parse(withArangoKey(created as Record<string, unknown>));
}

/** Migration/import-only keyed replacement; normal writes use createDocumentVersion. */
export async function upsertDocumentVersionByKey(input: DocumentVersion): Promise<DocumentVersion> {
  const snapshot = documentVersionSchema.parse(input);
  assertConfiguredEmbeddingDimensions(snapshot.embedding);
  const result = await db.collection(DOCUMENT_VERSIONS_COLLECTION).save(toArangoDoc(snapshot), { returnNew: true, overwriteMode: 'replace' });
  return documentVersionSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}

export async function getDocumentVersion(
  scopeKey: string,
  documentKey: string,
  version: number,
): Promise<DocumentVersion | null> {
  const cursor = await db.query(aql`
    FOR snapshot IN ${db.collection(DOCUMENT_VERSIONS_COLLECTION)}
      FILTER snapshot.scopeKey == ${scopeKey} && snapshot.documentKey == ${documentKey} && snapshot.version == ${version}
      FILTER snapshot.deletedAt == null
      LIMIT 1
      RETURN snapshot
  `);
  const snapshot = await cursor.next();
  return snapshot ? documentVersionSchema.parse(withArangoKey(snapshot)) : null;
}

export async function listDocumentVersions(scopeKey: string, documentKey: string): Promise<DocumentVersion[]> {
  const cursor = await db.query(aql`
    FOR snapshot IN ${db.collection(DOCUMENT_VERSIONS_COLLECTION)}
      FILTER snapshot.scopeKey == ${scopeKey} && snapshot.documentKey == ${documentKey}
      FILTER snapshot.deletedAt == null
      SORT snapshot.version DESC
      RETURN snapshot
  `);
  return (await cursor.all()).map((snapshot) => documentVersionSchema.parse(withArangoKey(snapshot)));
}

export async function getDocumentVersionInScope(scopeKey: string, versionKey: string): Promise<DocumentVersion | null> {
  const cursor = await db.query(aql`
    FOR snapshot IN ${db.collection(DOCUMENT_VERSIONS_COLLECTION)}
      FILTER snapshot._key == ${versionKey} && snapshot.scopeKey == ${scopeKey}
      LIMIT 1
      RETURN snapshot
  `);
  const snapshot = await cursor.next();
  return snapshot ? documentVersionSchema.parse(withArangoKey(snapshot)) : null;
}

export async function listDocumentVersionsByKeysInScope(scopeKey: string, versionKeys: string[]): Promise<DocumentVersion[]> {
  if (versionKeys.length === 0) return [];
  const cursor = await db.query(aql`
    FOR snapshot IN ${db.collection(DOCUMENT_VERSIONS_COLLECTION)}
      FILTER snapshot.scopeKey == ${scopeKey} && snapshot._key IN ${versionKeys}
      SORT POSITION(${versionKeys}, snapshot._key) ASC
      RETURN snapshot
  `);
  return (await cursor.all()).map((snapshot) => documentVersionSchema.parse(withArangoKey(snapshot)));
}

export async function listDocumentVersionsByDocumentKeys(scopeKey: string, documentKeys: string[]): Promise<DocumentVersion[]> {
  if (documentKeys.length === 0) return [];
  const cursor = await db.query(aql`
    FOR snapshot IN ${db.collection(DOCUMENT_VERSIONS_COLLECTION)}
      FILTER snapshot.scopeKey == ${scopeKey} && snapshot.documentKey IN ${documentKeys}
      FILTER snapshot.deletedAt == null
      SORT POSITION(${documentKeys}, snapshot.documentKey) ASC, snapshot.version DESC
      RETURN snapshot
  `);
  return (await cursor.all()).map((snapshot) => documentVersionSchema.parse(withArangoKey(snapshot)));
}

/** Policy and retention checks belong to the caller; this primitive only removes the selected snapshot. */
export async function deleteDocumentVersion(versionKey: string): Promise<void> {
  const current = await helpers.getById(versionKey);
  if (!current || !await deleteDocumentVersionInScope(current.scopeKey, versionKey)) throw new Error(`Document version ${versionKey} was not found.`);
}

export async function deleteDocumentVersionInScope(scopeKey: string, versionKey: string): Promise<boolean> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.deleteVersion(scopeKey, versionKey);
}

type NewDocumentVersion = Omit<DocumentVersion, 'key' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

/** Exclusive collection transaction makes MAX(version)+1 monotonic under concurrent writers. */
export async function createDocumentVersion(input: NewDocumentVersion): Promise<DocumentVersion> {
  const { storageKey: _storageKey, sizeBytes: _sizeBytes, ...logicalSnapshot } = input;
  assertConfiguredEmbeddingDimensions(logicalSnapshot.embedding);
  const { withArchivePersistenceTransaction } = await import('./archive-persistence.node');
  return withArchivePersistenceTransaction((persistence) => persistence.createVersion(logicalSnapshot));
}

export async function semanticSearchDocumentVersions(input: Omit<import('./documents.node').ArchiveSemanticSearchInput, 'sources'>) {
  const { semanticSearchArchive } = await import('./documents.node');
  return semanticSearchArchive({ ...input, sources: ['version'] });
}

export async function updateDocumentVersion(key: string, patch: Partial<Pick<DocumentVersion, 'deletedAt' | 'updatedAt'>>): Promise<DocumentVersion> {
  const updated = await helpers.updateById(key, patch);
  if (!updated) throw new Error(`Document version ${key} was not found.`);
  return updated;
}

export async function archiveDocumentVersion(key: string): Promise<DocumentVersion> {
  const timestamp = new Date().toISOString();
  return updateDocumentVersion(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreDocumentVersion(key: string): Promise<DocumentVersion> {
  const timestamp = new Date().toISOString();
  return updateDocumentVersion(key, { deletedAt: null, updatedAt: timestamp });
}
