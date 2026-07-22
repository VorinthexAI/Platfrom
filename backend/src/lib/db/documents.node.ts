import { z } from 'zod';
import { createNodeHelpers } from './base';

export const DOCUMENTS_COLLECTION = 'documents';
export const documentExtensionSchema = z.enum(['txt', 'md', 'doc', 'docx', 'pdf']);

export const documentSchema = z.object({
  key: z.string().cuid(),
  name: z.string().trim().min(1),
  extension: documentExtensionSchema,
  mimeType: z.string().trim().min(1),
  html: z.string(),
  json: z.unknown().refine((value) => value !== undefined, 'JSON document representation is required'),
  content: z.string(),
  embedding: z.array(z.number().finite()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Document = z.infer<typeof documentSchema>;
export type DocumentExtension = z.infer<typeof documentExtensionSchema>;
export const documentsEmbeddingFields = ['content'] as const;
const helpers = createNodeHelpers(DOCUMENTS_COLLECTION, documentSchema, documentsEmbeddingFields);
export const insertDocument = helpers.insert;
export const getDocumentById = helpers.getById;
export const updateDocument = helpers.updateById;
export const deleteDocument = helpers.deleteById;
export const upsertDocumentByKey = helpers.upsertByKey;
export const getAllDocumentsChunked = helpers.getAllChunked;
export const listDocumentsPage = helpers.listPage;
