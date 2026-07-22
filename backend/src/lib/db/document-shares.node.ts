import { z } from 'zod';
import { createNodeHelpers } from './base';

export const DOCUMENT_SHARES_COLLECTION = 'documentShares';

export const documentShareSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  documentKey: z.string().cuid(),
  token: z.string().trim().min(1),
  expiresAt: z.string().datetime().optional(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DocumentShare = z.infer<typeof documentShareSchema>;
export const documentSharesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(DOCUMENT_SHARES_COLLECTION, documentShareSchema, documentSharesEmbeddingFields);
export const insertDocumentShare = helpers.insert;
export const getDocumentShareById = helpers.getById;
export const updateDocumentShare = helpers.updateById;
export const deleteDocumentShare = helpers.deleteById;
export const upsertDocumentShareByKey = helpers.upsertByKey;
export const getAllDocumentSharesChunked = helpers.getAllChunked;
export const listDocumentSharesPage = helpers.listPage;

export async function archiveDocumentShare(key: string): Promise<DocumentShare> {
  const timestamp = new Date().toISOString();
  return updateDocumentShare(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreDocumentShare(key: string): Promise<DocumentShare> {
  const timestamp = new Date().toISOString();
  return updateDocumentShare(key, { deletedAt: null, updatedAt: timestamp });
}
