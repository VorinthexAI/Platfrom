import { z } from 'zod';
import { aql } from 'arangojs';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { db, withTransaction } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const FILES_COLLECTION = 'files';
export const fileExtensionSchema = z.enum(['txt', 'md', 'docx', 'pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'mp3', 'mp4']);
export const fileProcessingSchema = z.enum(['pending', 'ready', 'failed']);

export const fileSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  folderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(255),
  extension: fileExtensionSchema,
  mimeType: z.string().trim().min(1),
  sizeBytes: z.number().int().positive(),
  storageKey: z.string().trim().min(1),
  extractedText: z.string().optional(),
  contentChunks: z.array(z.string()).optional(),
  chunkEmbeddings: z.array(z.array(z.number().finite())).optional(),
  embedding: currentEmbeddingSchema.or(z.array(z.number().finite()).length(0)).default([]),
  processing: fileProcessingSchema.default('pending'),
  isFavorite: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FileRecord = z.infer<typeof fileSchema>;
export type FileExtension = z.infer<typeof fileExtensionSchema>;

const helpers = createNodeHelpers(FILES_COLLECTION, fileSchema, ['name', 'extractedText'], { requireEmbedding: false, includeEmbeddingMetadata: false });
export const insertFile = helpers.insert;
export const getFileById = helpers.getById;
export const upsertFileByKey = helpers.upsertByKey;
export const getAllFilesChunked = helpers.getAllChunked;
export const listFilesPage = helpers.listPage;

export async function updateFile(key: string, patch: Partial<Omit<FileRecord, 'key' | 'userKey' | 'scopeKey' | 'storageKey' | 'createdAt'>>): Promise<FileRecord> {
  const current = await helpers.getById(key);
  if (!current) throw new Error(`File ${key} was not found.`);
  return helpers.updateById(key, { ...patch, updatedAt: new Date().toISOString() });
}

export async function getFileInScope(scopeKey: string, fileKey: string, userKey: string): Promise<FileRecord | null> {
  const cursor = await db.query(aql`
    FOR file IN ${db.collection(FILES_COLLECTION)}
      FILTER file._key == ${fileKey} && file.scopeKey == ${scopeKey} && file.userKey == ${userKey}
      LIMIT 1
      RETURN file
  `);
  const row = await cursor.next();
  return row ? fileSchema.parse(withArangoKey(row as Record<string, unknown>)) : null;
}

export async function listFilesInFolder(scopeKey: string, userKey: string, folderKey: string | undefined, limit: number, cursor?: string) {
  const cursorValue = cursor ?? null;
  const result = await db.query(aql`
    FOR file IN ${db.collection(FILES_COLLECTION)}
      FILTER file.scopeKey == ${scopeKey} && file.userKey == ${userKey}
      FILTER ${folderKey ?? null} == null ? !HAS(file, 'folderKey') : file.folderKey == ${folderKey ?? null}
      FILTER ${cursorValue} == null || file.updatedAt < ${cursorValue} || (file.updatedAt == ${cursorValue} && file._key > ${cursorValue})
      SORT file.updatedAt DESC, file._key ASC
      LIMIT ${limit}
      RETURN file
  `);
  return (await result.all()).map((row) => fileSchema.parse(withArangoKey(row as Record<string, unknown>)));
}

export async function deleteFileInScope(scopeKey: string, fileKey: string, userKey: string): Promise<string | null> {
  return withTransaction([FILES_COLLECTION, 'storageDeletionJobs'], async (trx) => {
    const cursor = await trx.query(aql`
      LET file = DOCUMENT(${db.collection(FILES_COLLECTION)}, ${fileKey})
      FILTER file != null && file.scopeKey == ${scopeKey} && file.userKey == ${userKey}
      LET queued = (UPSERT { storageKey: file.storageKey } INSERT { storageKey: file.storageKey, createdAt: ${new Date().toISOString()}, status: 'pending' } UPDATE {} IN storageDeletionJobs RETURN 1)
      REMOVE file IN ${db.collection(FILES_COLLECTION)}
      RETURN file.storageKey
    `);
    const storageKey = await cursor.next();
    return typeof storageKey === 'string' ? storageKey : null;
  });
}

export function fileStorageKey(userKey: string, fileKey: string, extension: FileExtension) {
  return `files/${userKey}/${fileKey}.${extension}`;
}

export function toArangoFile(file: FileRecord) {
  return toArangoDoc(file);
}
