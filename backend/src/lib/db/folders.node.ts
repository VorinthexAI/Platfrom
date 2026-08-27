import { z } from 'zod';
import { aql } from 'arangojs';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const FOLDERS_COLLECTION = 'folders';

export const folderSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  parentFolderKey: z.string().cuid().optional(),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).optional(),
  coverImageKey: z.string().cuid().optional(),
  purpose: z.enum(['generated-documents-root', 'generated-documents-guide', 'generated-documents-brief', 'generated-documents-accommodations', 'generated-documents-restaurants', 'generated-documents-activities', 'communication-mail-root', 'communication-mail-inboxes', 'communication-mail-threads', 'communication-mail-drafts', 'communication-mail-tones', 'communication-mail-reply-context', 'communication-mail-settings']).optional(),
  managedPurpose: z.enum(['mail-attachment', 'mail-inbox', 'mail-inbox-files', 'mail-thread']).optional(), managedOwnerKey: z.string().cuid().optional(),
  mutationPolicy: z.enum(['user', 'system-container']).optional(),
  archiveVisibility: z.enum(['visible', 'domain-only']).default('visible'),
  embedding: currentEmbeddingSchema,
  isFavorite: z.boolean().default(false),
  _internalDeletion: z.object({
    kind: z.literal('folder'),
    owner: z.string().trim().min(1),
    folderKeys: z.array(z.string().cuid()).optional(),
    documentKeys: z.array(z.string().cuid()).optional(),
    objectKeys: z.array(z.string().trim().min(1)).optional(),
    startedAt: z.string().datetime(),
  }).strict().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Folder = Omit<z.infer<typeof folderSchema>, 'archiveVisibility'> & { archiveVisibility?: 'visible' | 'domain-only' };
export const foldersEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(FOLDERS_COLLECTION, folderSchema, foldersEmbeddingFields, { includeEmbeddingMetadata: false });
export async function insertFolder(folder: Folder): Promise<Folder> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.insertFolder(folder);
}
export const getFolderById: (id: string) => Promise<Folder | null> = helpers.getById;
export const upsertFolderByKey = helpers.upsertByKey;
export const getAllFoldersChunked = helpers.getAllChunked;
export const listFoldersPage = helpers.listPage;

export async function updateFolder(folderKey: string, patch: import('./content-persistence.node').ScopedFolderPatch): Promise<Folder> {
  const current = await helpers.getById(folderKey);
  if (!current) throw new Error(`Folder ${folderKey} was not found.`);
  const scoped = await updateFolderInScope(current.scopeKey, folderKey, patch);
  if (!scoped) throw new Error(`Folder ${folderKey} left scope ${current.scopeKey} during update.`);
  return scoped;
}

export async function updateFolderInScope(scopeKey: string, folderKey: string, patch: import('./content-persistence.node').ScopedFolderPatch) {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.updateFolder(scopeKey, folderKey, patch);
}

export async function deleteFolderInScope(scopeKey: string, folderKey: string): Promise<boolean> {
  const { contentPersistence } = await import('./content-persistence.node');
  return contentPersistence.deleteFolder(scopeKey, folderKey);
}

export async function deleteFolder(folderKey: string): Promise<void> {
  const current = await helpers.getById(folderKey);
  if (!current || !await deleteFolderInScope(current.scopeKey, folderKey)) throw new Error(`Folder ${folderKey} was not found.`);
}

export async function getFolderInScope(scopeKey: string, folderKey: string): Promise<Folder | null> {
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder._key == ${folderKey} && folder.scopeKey == ${scopeKey}
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER (folder.archiveVisibility || "visible") == "visible"
      LIMIT 1
      RETURN folder
  `);
  const folder = await cursor.next();
  if (!folder) return null;
  return (await archiveVisibleFolderKeys(scopeKey)).has(folderKey) ? folderSchema.parse(withArangoKey(folder)) : null;
}

export async function archiveVisibleFolderKeys(scopeKey: string): Promise<Set<string>> {
  const cursor = await db.query(aql`FOR folder IN ${db.collection(FOLDERS_COLLECTION)} FILTER folder.scopeKey == ${scopeKey} RETURN { key: folder._key, parentFolderKey: folder.parentFolderKey, archiveVisibility: folder.archiveVisibility }`);
  const folders = await cursor.all() as Array<{ key: string; parentFolderKey?: string; archiveVisibility?: string }>;
  const byKey = new Map(folders.map((folder) => [folder.key, folder]));
  const visible = new Set<string>();
  for (const folder of folders) {
    const visited = new Set<string>();
    let current: typeof folder | undefined = folder;
    while (current && current.archiveVisibility !== 'domain-only' && !visited.has(current.key)) {
      visited.add(current.key);
      if (!current.parentFolderKey) { visible.add(folder.key); break; }
      current = byKey.get(current.parentFolderKey);
    }
  }
  return visible;
}

/** Scope authorization is applied before semantic scoring. */
export async function semanticSearchFolders(input: { embedding: number[]; authorizedScopeKeys: string[]; folderKeys?: string[]; minScore: number; limit: number }): Promise<Array<{ score: number; folder: Folder }>> {
  const embedding = currentEmbeddingSchema.parse(input.embedding);
  if (input.authorizedScopeKeys.length === 0 || input.folderKeys?.length === 0) return [];
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey IN ${input.authorizedScopeKeys}
      FILTER ${input.folderKeys === undefined} || folder._key IN ${input.folderKeys ?? []}
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER (folder.archiveVisibility || "visible") == "visible"
      FILTER IS_ARRAY(folder.embedding) && LENGTH(folder.embedding) == LENGTH(${embedding})
      LET score = COSINE_SIMILARITY(folder.embedding, ${embedding})
      FILTER IS_NUMBER(score) && score >= ${input.minScore}
      SORT score DESC, folder._key ASC
      LIMIT ${Math.min(Math.max(input.limit, 1), 40)}
      RETURN { score, folder }
  `);
  const visibleByScope = new Map(await Promise.all(input.authorizedScopeKeys.map(async (scopeKey) => [scopeKey, await archiveVisibleFolderKeys(scopeKey)] as const)));
  return (await cursor.all()).map((match: Record<string, unknown>) => ({
    score: Number(match.score),
    folder: folderSchema.parse(withArangoKey(match.folder as Record<string, unknown>)),
  })).filter(({ folder }) => visibleByScope.get(folder.scopeKey)?.has(folder.key));
}

export async function listFoldersByScope(
  scopeKey: string,
  options: { parentFolderKey?: string | null; includePendingDeletion?: boolean } = {},
): Promise<Folder[]> {
  const hasParentBoundary = Object.prototype.hasOwnProperty.call(options, 'parentFolderKey');
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey}
      FILTER ${options.includePendingDeletion ?? false} || !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      FILTER !${hasParentBoundary} || (${options.parentFolderKey ?? null} == null
        ? (!HAS(folder, "parentFolderKey") || folder.parentFolderKey == null)
        : folder.parentFolderKey == ${options.parentFolderKey ?? null})
      SORT folder.name ASC, folder._key ASC
      RETURN folder
  `);
  const visibleKeys = await archiveVisibleFolderKeys(scopeKey);
  return (await cursor.all()).map((folder) => folderSchema.parse(withArangoKey(folder))).filter((folder) => visibleKeys.has(folder.key));
}

export function listFoldersByParent(
  scopeKey: string,
  parentFolderKey: string | null,
): Promise<Folder[]> {
  return listFoldersByScope(scopeKey, { parentFolderKey });
}

/** Returns descendants in breadth-first order while keeping the complete read scope-bounded in AQL. */
export async function listFolderDescendants(scopeKey: string, folderKey: string): Promise<Folder[]> {
  const visibleKeys = await archiveVisibleFolderKeys(scopeKey);
  if (!visibleKeys.has(folderKey)) return [];
  const cursor = await db.query(aql`
    FOR folder IN ${db.collection(FOLDERS_COLLECTION)}
      FILTER folder.scopeKey == ${scopeKey}
      FILTER !HAS(folder, "_internalDeletion") || folder._internalDeletion == null
      RETURN folder
  `);
  const folders = (await cursor.all()).map((folder) => folderSchema.parse(withArangoKey(folder))).filter((folder) => visibleKeys.has(folder.key));
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
