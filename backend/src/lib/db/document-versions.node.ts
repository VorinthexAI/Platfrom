import { z } from 'zod';
import { createNodeHelpers } from './base';

export const DOCUMENT_VERSIONS_COLLECTION = 'documentVersions';

export const documentVersionSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  version: z.number().int().positive(),
  storageKey: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
  content: z.string(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DocumentVersion = z.infer<typeof documentVersionSchema>;
export const documentVersionsEmbeddingFields = ['content'] as const;
const helpers = createNodeHelpers(DOCUMENT_VERSIONS_COLLECTION, documentVersionSchema, documentVersionsEmbeddingFields);
export const insertDocumentVersion = helpers.insert;
export const getDocumentVersionById = helpers.getById;
export const updateDocumentVersion = helpers.updateById;
export const deleteDocumentVersion = helpers.deleteById;
export const upsertDocumentVersionByKey = helpers.upsertByKey;
export const getAllDocumentVersionsChunked = helpers.getAllChunked;
export const listDocumentVersionsPage = helpers.listPage;

export async function archiveDocumentVersion(key: string): Promise<DocumentVersion> {
  const timestamp = new Date().toISOString();
  return updateDocumentVersion(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreDocumentVersion(key: string): Promise<DocumentVersion> {
  const timestamp = new Date().toISOString();
  return updateDocumentVersion(key, { deletedAt: null, updatedAt: timestamp });
}
