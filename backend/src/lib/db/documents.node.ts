import { z } from 'zod';
import { db } from './client';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { embeddingMetadata } from '@/lib/bedrock-titan';
import { editorDocumentJsonSchema } from '@/lib/ai/document-processing/schemas';
import { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';

export const DOCUMENTS_COLLECTION = 'documents';
export { documentExtensionSchema } from '@/lib/ai/document-processing/schemas';

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
  embedding: z.array(z.number().finite()).min(1),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Document = z.infer<typeof documentSchema>;
export type DocumentExtension = z.infer<typeof documentExtensionSchema>;
export const documentsEmbeddingFields = ['name', 'content'] as const;
const helpers = createNodeHelpers(DOCUMENTS_COLLECTION, documentSchema, documentsEmbeddingFields);
export const insertDocument = helpers.insert;
export const getDocumentById = helpers.getById;
export const updateDocument = helpers.updateById;
export const deleteDocument = helpers.deleteById;
export const upsertDocumentByKey = helpers.upsertByKey;
export const getAllDocumentsChunked = helpers.getAllChunked;
export const listDocumentsPage = helpers.listPage;

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
  const result = await db.collection(DOCUMENTS_COLLECTION).save(
    toArangoDoc({ ...document, ...embeddingMetadata() }),
    { returnNew: true },
  );
  return documentSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}
