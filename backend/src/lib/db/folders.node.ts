import { z } from 'zod';
import { aql } from 'arangojs';
import { createNodeHelpers, withArangoKey } from './base';
import { db, withTransaction } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { FILES_COLLECTION } from './files.node';

export const FOLDERS_COLLECTION = 'folders';

export const folderSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  parentFolderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).optional(),
  coverFileKey: z.string().cuid().optional(),
  embedding: currentEmbeddingSchema.or(z.array(z.number().finite()).length(0)).default([]),
  isFavorite: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  managedPurpose: z.enum(['conversation-root', 'conversation', 'conversation-summaries']).optional(),
  managedOwnerKey: z.string().trim().min(1).max(160).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Folder = z.infer<typeof folderSchema>;
export const foldersEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(FOLDERS_COLLECTION, folderSchema, foldersEmbeddingFields, { requireEmbedding: false, includeEmbeddingMetadata: false });
export const insertFolder = helpers.insert;
export const getFolderById = helpers.getById;
export const upsertFolderByKey = helpers.upsertByKey;
export const getAllFoldersChunked = helpers.getAllChunked;
export const listFoldersPage = helpers.listPage;

export async function getFolderInScope(scopeKey: string, folderKey: string, userKey: string): Promise<Folder | null> {
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder._key == ${folderKey} && folder.scopeKey == ${scopeKey} && folder.userKey == ${userKey}
      LIMIT 1
      RETURN folder
  `);
  const row = await cursor.next();
  return row ? folderSchema.parse(withArangoKey(row as Record<string, unknown>)) : null;
}

export async function listFoldersInParent(scopeKey: string, userKey: string, parentFolderKey: string | undefined, limit: number) {
  const result = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey} && folder.userKey == ${userKey}
      FILTER ${parentFolderKey ?? null} == null ? !HAS(folder, 'parentFolderKey') : folder.parentFolderKey == ${parentFolderKey ?? null}
      SORT folder.name ASC, folder._key ASC
      LIMIT ${limit}
      RETURN folder
  `);
  return (await result.all()).map((row) => folderSchema.parse(withArangoKey(row as Record<string, unknown>)));
}

export async function listFoldersInParentPage(scopeKey: string, userKey: string, parentFolderKey: string | undefined, limit: number, after?: Pick<Folder, 'key' | 'name'>) {
  const result = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey} && folder.userKey == ${userKey}
      FILTER ${parentFolderKey ?? null} == null ? !HAS(folder, 'parentFolderKey') : folder.parentFolderKey == ${parentFolderKey ?? null}
      FILTER ${after?.key ?? null} == null || folder.name > ${after?.name ?? null} || (folder.name == ${after?.name ?? null} && folder._key > ${after?.key ?? null})
      SORT folder.name ASC, folder._key ASC
      LIMIT ${limit + 1}
      RETURN folder
  `);
  const folders = (await result.all()).map((row) => folderSchema.parse(withArangoKey(row as Record<string, unknown>)));
  return { folders: folders.slice(0, limit), cursor: folders.length > limit ? folders[limit - 1]!.key : undefined };
}

export async function updateFolderInScope(scopeKey: string, folderKey: string, userKey: string, patch: Partial<Pick<Folder, 'name' | 'description' | 'coverFileKey' | 'isFavorite' | 'isHidden' | 'parentFolderKey' | 'embedding'>>) {
  const current = await getFolderInScope(scopeKey, folderKey, userKey);
  if (!current) return null;
  return helpers.updateById(folderKey, { ...patch, updatedAt: new Date().toISOString() });
}

export async function deleteFolderInScope(scopeKey: string, folderKey: string, userKey: string): Promise<boolean> {
  return withTransaction([FOLDERS_COLLECTION, FILES_COLLECTION, 'storageDeletionJobs'], async (trx) => {
    const now = new Date().toISOString();
    const cursor = await trx.query(`
      LET root = DOCUMENT(@@folders, @folderKey)
      FILTER root != null && root.scopeKey == @scopeKey && root.userKey == @userKey
      LET descendants = (FOR vertex IN 0..20 OUTBOUND root @@edges OPTIONS { uniqueVertices: 'global' } RETURN vertex._key)
      LET folderKeys = LENGTH(descendants) > 0 ? descendants : [root._key]
      LET removedFiles = (
        FOR file IN @@files
          FILTER file.scopeKey == @scopeKey && file.userKey == @userKey && (file.folderKey IN folderKeys)
           LET queued = (FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) UPSERT { storageKey: key } INSERT { storageKey: key, createdAt: @now, status: 'pending' } UPDATE {} IN storageDeletionJobs RETURN 1)
          REMOVE file IN @@files
          RETURN 1
      )
      LET removedFolders = (FOR folder IN @@folders FILTER folder._key IN folderKeys && folder.scopeKey == @scopeKey && folder.userKey == @userKey REMOVE folder IN @@folders RETURN 1)
      RETURN LENGTH(removedFolders) > 0
    `, { '@folders': FOLDERS_COLLECTION, '@files': FILES_COLLECTION, '@edges': FOLDERS_COLLECTION, folderKey, scopeKey, userKey, now }).catch(async () => {
      const fallback = await trx.query(`
        LET root = DOCUMENT(@@folders, @folderKey)
        FILTER root != null && root.scopeKey == @scopeKey && root.userKey == @userKey
        LET folderKeys = APPEND((FOR folder IN @@folders FILTER folder.scopeKey == @scopeKey && folder.userKey == @userKey && folder.parentFolderKey == @folderKey RETURN folder._key), [@folderKey])
        LET removedFiles = (
          FOR file IN @@files
            FILTER file.scopeKey == @scopeKey && file.userKey == @userKey && file.folderKey IN folderKeys
             LET queued = (FOR key IN [file.storageKey, file.thumbnailStorageKey] FILTER IS_STRING(key) UPSERT { storageKey: key } INSERT { storageKey: key, createdAt: @now, status: 'pending' } UPDATE {} IN storageDeletionJobs RETURN 1)
            REMOVE file IN @@files
            RETURN 1
        )
        LET removedFolders = (FOR folder IN @@folders FILTER folder._key IN folderKeys && folder.scopeKey == @scopeKey && folder.userKey == @userKey REMOVE folder IN @@folders RETURN 1)
        RETURN LENGTH(removedFolders) > 0
      `, { '@folders': FOLDERS_COLLECTION, '@files': FILES_COLLECTION, folderKey, scopeKey, userKey, now });
      return fallback;
    });
    return Boolean(await cursor.next());
  });
}
