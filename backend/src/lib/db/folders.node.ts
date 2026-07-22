import { z } from 'zod';
import { aql } from 'arangojs';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const FOLDERS_COLLECTION = 'folders';

export const folderSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  parentFolderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  embedding: z.array(z.number().finite()).default([]),
  archivedAt: z.string().datetime().optional(),
  _internalDeletion: z.object({
    kind: z.literal('folder'),
    owner: z.string().trim().min(1),
    objectKeys: z.array(z.string().trim().min(1)).optional(),
    startedAt: z.string().datetime(),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Folder = z.infer<typeof folderSchema>;
export const foldersEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(FOLDERS_COLLECTION, folderSchema, foldersEmbeddingFields);
export async function insertFolder(folder: Folder): Promise<Folder> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.insertFolder(folder);
}
export const getFolderById = helpers.getById;
export const upsertFolderByKey = helpers.upsertByKey;
export const getAllFoldersChunked = helpers.getAllChunked;
export const listFoldersPage = helpers.listPage;

export async function updateFolder(folderKey: string, patch: import('./archive-persistence.node').ScopedFolderPatch): Promise<Folder> {
  const current = await helpers.getById(folderKey);
  if (!current) throw new Error(`Folder ${folderKey} was not found.`);
  const scoped = await updateFolderInScope(current.scopeKey, folderKey, patch);
  if (!scoped) throw new Error(`Folder ${folderKey} left scope ${current.scopeKey} during update.`);
  return scoped;
}

export async function updateFolderInScope(scopeKey: string, folderKey: string, patch: import('./archive-persistence.node').ScopedFolderPatch) {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.updateFolder(scopeKey, folderKey, patch);
}

export async function deleteFolderInScope(scopeKey: string, folderKey: string): Promise<boolean> {
  const { archivePersistence } = await import('./archive-persistence.node');
  return archivePersistence.deleteFolder(scopeKey, folderKey);
}

export async function deleteFolder(folderKey: string): Promise<void> {
  const current = await helpers.getById(folderKey);
  if (!current || !await deleteFolderInScope(current.scopeKey, folderKey)) throw new Error(`Folder ${folderKey} was not found.`);
}

export async function getFolderInScope(scopeKey: string, folderKey: string, includeArchived = false): Promise<Folder | null> {
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder._key == ${folderKey} && folder.scopeKey == ${scopeKey}
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER ${includeArchived} || !HAS(folder, "archivedAt") || folder.archivedAt == null
      LIMIT 1
      RETURN folder
  `);
  const folder = await cursor.next();
  return folder ? folderSchema.parse(withArangoKey(folder)) : null;
}

export async function listFoldersByScope(
  scopeKey: string,
  options: { parentFolderKey?: string | null; includeArchived?: boolean; includePendingDeletion?: boolean } = {},
): Promise<Folder[]> {
  const hasParentBoundary = Object.prototype.hasOwnProperty.call(options, 'parentFolderKey');
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey}
      FILTER ${options.includePendingDeletion ?? false} || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER ${options.includeArchived ?? false} || !HAS(folder, "archivedAt") || folder.archivedAt == null
      FILTER !${hasParentBoundary} || (${options.parentFolderKey ?? null} == null
        ? (!HAS(folder, "parentFolderKey") || folder.parentFolderKey == null)
        : folder.parentFolderKey == ${options.parentFolderKey ?? null})
      SORT folder.name ASC, folder._key ASC
      RETURN folder
  `);
  return (await cursor.all()).map((folder) => folderSchema.parse(withArangoKey(folder)));
}

export function listFoldersByParent(
  scopeKey: string,
  parentFolderKey: string | null,
  includeArchived = false,
): Promise<Folder[]> {
  return listFoldersByScope(scopeKey, { parentFolderKey, includeArchived });
}

/** Returns descendants in breadth-first order while keeping the complete read scope-bounded in AQL. */
export async function listFolderDescendants(scopeKey: string, folderKey: string, includeArchived = false): Promise<Folder[]> {
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey}
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER ${includeArchived} || !HAS(folder, "archivedAt") || folder.archivedAt == null
      RETURN folder
  `);
  const folders = (await cursor.all()).map((folder) => folderSchema.parse(withArangoKey(folder)));
  const children = new Map<string, Folder[]>();
  for (const folder of folders) {
    if (!folder.parentFolderKey) continue;
    const siblings = children.get(folder.parentFolderKey) ?? [];
    siblings.push(folder);
    children.set(folder.parentFolderKey, siblings);
  }
  const descendants: Folder[] = [];
  const pending = [...(children.get(folderKey) ?? [])];
  const visited = new Set([folderKey]);
  while (pending.length > 0) {
    const folder = pending.shift()!;
    if (visited.has(folder.key)) continue;
    visited.add(folder.key);
    descendants.push(folder);
    pending.push(...(children.get(folder.key) ?? []));
  }
  return descendants;
}
