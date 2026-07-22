import { z } from 'zod';
import { createNodeHelpers } from './base';

export const FOLDERS_COLLECTION = 'folders';

export const folderSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  parentFolderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  embedding: z.array(z.number().finite()).default([]),
  deletedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Folder = z.infer<typeof folderSchema>;
export const foldersEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(FOLDERS_COLLECTION, folderSchema, foldersEmbeddingFields);
export const insertFolder = helpers.insert;
export const getFolderById = helpers.getById;
export const updateFolder = helpers.updateById;
export const deleteFolder = helpers.deleteById;
export const upsertFolderByKey = helpers.upsertByKey;
export const getAllFoldersChunked = helpers.getAllChunked;
export const listFoldersPage = helpers.listPage;

export async function archiveFolder(key: string): Promise<Folder> {
  const timestamp = new Date().toISOString();
  return updateFolder(key, { deletedAt: timestamp, updatedAt: timestamp });
}

export async function restoreFolder(key: string): Promise<Folder> {
  const timestamp = new Date().toISOString();
  return updateFolder(key, { deletedAt: null, updatedAt: timestamp });
}
