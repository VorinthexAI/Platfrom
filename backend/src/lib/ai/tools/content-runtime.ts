import { newId } from '@/lib/ids';
import { embedText, embedTexts } from '@/lib/embeddings';
import { chunkDocumentText } from '@/lib/ai/document-processing/chunking';
import { signedMediaDownloadUrl } from '@/lib/media-delivery';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { deleteFolderInScope, getFolderInScope, insertFolder, listFoldersInParent, listFoldersInParentPage, updateFolderInScope, type Folder } from '@/lib/db/folders.node';
import { deleteFileInScope, fileSchema, fileStorageKey, fileThumbnailStorageKey, getFileInScope, insertFile, listFilesInFolder, storeFileTextIndex, updateFile, type FileRecord } from '@/lib/db/files.node';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { insertTag, listTagsByScope } from '@/lib/db/tags.node';
import { deleteTagAssignment, insertTagAssignment, listTagAssignmentsByScope } from '@/lib/db/tag-assignments.node';
import { getDefaultUserSearchService } from '@/lib/user-searches/service';
import { contextUserKey, type ToolContext } from './tool-context';
import { ContentError } from './content-errors';
import { contentFolderSchema, contentFileSchema, contentTagSchema, contentToolContracts, type ContentToolName } from './content-schemas';
import { listWorkspaceInventory } from '@/lib/ai/agents/workspace-inventory';

export type ContentToolDependencies = Record<string, never>;

const MUTATIONS = new Set<ContentToolName>(['folder.create', 'folder.update', 'folder.rename', 'folder.move', 'folder.copy', 'folder.delete', 'file.update', 'file.rename', 'file.move', 'file.copy', 'file.delete', 'content.search-history.record', 'content.search-history.delete', 'tag.create', 'tag.assignment.set']);

export function isContentMutation(name: string, _input?: unknown) {
  return MUTATIONS.has(name as ContentToolName);
}

function publicFolder(folder: Folder) {
  return contentFolderSchema.parse({ key: folder.key, scopeKey: folder.scopeKey, parentFolderKey: folder.parentFolderKey, name: folder.name, description: folder.description, coverFileKey: folder.coverFileKey, isFavorite: folder.isFavorite, isHidden: folder.isHidden, createdAt: folder.createdAt, updatedAt: folder.updatedAt });
}

function publicFile(file: FileRecord) {
  return contentFileSchema.parse({ key: file.key, scopeKey: file.scopeKey, folderKey: file.folderKey, name: file.name, extension: file.extension, mimeType: file.mimeType, sizeBytes: file.sizeBytes, caption: file.caption, hasThumbnail: Boolean(file.thumbnailStorageKey), hasExtractedText: file.processing === 'ready' && Boolean(file.extractedText?.trim()), processing: file.processing, isFavorite: file.isFavorite, isHidden: file.isHidden, createdAt: file.createdAt, updatedAt: file.updatedAt });
}

export const publicContentFile = publicFile;

function publicTag(tag: { key: string; name: string; description?: string; createdAt: string; updatedAt: string }) {
  return contentTagSchema.parse({ key: tag.key, name: tag.name, description: tag.description, createdAt: tag.createdAt, updatedAt: tag.updatedAt });
}

async function requireFolder(context: ToolContext, folderKey: string) {
  const folder = await getFolderInScope(context.runtimeScopeKey, folderKey, contextUserKey(context));
  if (!folder) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', 'folder.find');
  return folder;
}

async function requireFile(context: ToolContext, fileKey: string) {
  const file = await getFileInScope(context.runtimeScopeKey, fileKey, contextUserKey(context));
  if (!file) throw new ContentError('CONTENT_NOT_FOUND', 'File was not found.', 'file.find');
  return file;
}

async function filesInFolder(scopeKey: string, userKey: string, folderKey: string | undefined) {
  const cursor = await db.query(`
    FOR file IN files
      FILTER file.scopeKey == @scopeKey && file.userKey == @userKey
      FILTER @folderKey == null ? !HAS(file, 'folderKey') : file.folderKey == @folderKey
      RETURN file
  `, { scopeKey, userKey, folderKey: folderKey ?? null });
  return (await cursor.all() as Record<string, unknown>[]).map((row) => fileSchema.parse(withArangoKey(row)));
}

async function folderIsInside(scopeKey: string, userKey: string, folderKey: string, candidateParentKey: string | undefined) {
  if (!candidateParentKey) return false;
  let current: string | undefined = candidateParentKey;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    if (current === folderKey) return true;
    seen.add(current);
    current = (await getFolderInScope(scopeKey, current, userKey))?.parentFolderKey;
  }
  return false;
}

async function copyFileRecord(file: FileRecord, folderKey: string | undefined, userKey: string) {
  const key = newId();
  const storageKey = fileStorageKey(userKey, key, file.extension);
  const thumbnailStorageKey = file.thumbnailStorageKey ? fileThumbnailStorageKey(userKey, key) : undefined;
  await documentStorage.copy({ sourceKey: file.storageKey, destinationKey: storageKey, mimeType: file.mimeType, billingUserKey: userKey });
  try {
    if (file.thumbnailStorageKey && thumbnailStorageKey) await documentStorage.copy({ sourceKey: file.thumbnailStorageKey, destinationKey: thumbnailStorageKey, mimeType: 'image/jpeg', billingUserKey: userKey });
    const now = new Date().toISOString();
    return await insertFile({
    key,
    userKey,
    scopeKey: file.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    name: file.name,
    extension: file.extension,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    storageKey,
    ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}),
    extractedText: file.extractedText,
    caption: file.caption,
    contentChunks: file.contentChunks,
    chunkEmbeddings: file.chunkEmbeddings,
    processing: file.processing,
    isFavorite: false,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
    });
  } catch (error) {
    await Promise.all([storageKey, thumbnailStorageKey].filter((value): value is string => Boolean(value)).map((value) => documentStorage.delete(value).catch(() => undefined)));
    throw error;
  }
}

async function copyFolderRecord(folder: Folder, parentFolderKey: string | undefined, context: ToolContext) {
  const userKey = contextUserKey(context);
  const now = new Date().toISOString();
  const copied = await insertFolder({
    key: newId(),
    userKey,
    scopeKey: folder.scopeKey,
    ...(parentFolderKey ? { parentFolderKey } : {}),
    name: folder.name,
    description: folder.description,
    coverFileKey: folder.coverFileKey,
    isFavorite: false,
    isHidden: false,
    createdAt: now,
    updatedAt: now,
  });
  for (const file of await filesInFolder(folder.scopeKey, userKey, folder.key)) await copyFileRecord(file, copied.key, userKey);
  for (const child of await listFoldersInParent(folder.scopeKey, userKey, folder.key, 1_000)) await copyFolderRecord(child, copied.key, context);
  return copied;
}

function visible<T extends { isFavorite?: boolean; isHidden?: boolean }>(rows: T[], favoritesOnly?: boolean, includeHidden?: boolean) {
  return rows.filter((row) => (includeHidden || !row.isHidden) && (!favoritesOnly || row.isFavorite));
}

async function matchingTagKeys(scopeKey: string, sourceType: 'folder' | 'file', sourceKey: string, required: string[]) {
  if (!required.length) return true;
  const assignments = await listTagAssignmentsByScope(scopeKey, sourceType, sourceKey);
  const present = new Set(assignments.map((assignment) => assignment.tagKey));
  return required.every((key) => present.has(key));
}

export async function searchWorkspace(context: ToolContext, input: { query: string; folderKey?: string; folderKeys?: string[]; excludeManaged?: boolean; favoritesOnly?: boolean; includeHidden?: boolean; tagKeys?: string[]; extensions?: string[]; limit?: number }, options: { entireScope?: boolean; includeUnranked?: boolean } = {}) {
  const userKey = contextUserKey(context);
  const scopeKey = context.runtimeScopeKey;
  const limit = input.limit ?? 50;
  if (input.folderKey) await requireFolder(context, input.folderKey);
  // Name matching must remain available when the embedding provider is unavailable.
  const embedding = await embedText({ text: input.query, purpose: 'query' }).catch(() => [] as number[]);
  const folderFilter = input.folderKeys ? 'FILTER row.parentFolderKey IN @folderKeys' : input.folderKey ? 'FILTER row.parentFolderKey == @folderKey' : options.entireScope ? '' : 'FILTER !HAS(row, "parentFolderKey")';
  const fileFolderFilter = input.folderKeys ? 'FILTER row.folderKey IN @folderKeys' : input.folderKey ? 'FILTER row.folderKey == @folderKey' : options.entireScope ? '' : 'FILTER !HAS(row, "folderKey")';
  const folderBinding = input.folderKeys ? { folderKeys: input.folderKeys } : input.folderKey ? { folderKey: input.folderKey } : {};
  const hiddenFilter = input.includeHidden ? '' : 'FILTER row.isHidden != true';
  const favoriteFilter = input.favoritesOnly ? 'FILTER row.isFavorite == true' : '';
  const managedFileFilter = input.excludeManaged ? 'FILTER row.managedPurpose == null' : '';
  const foldersCursor = await db.query(`
    FOR row IN folders
      FILTER row.scopeKey == @scopeKey && row.userKey == @userKey
      ${folderFilter}
      ${hiddenFilter}
      ${favoriteFilter}
      LET semantic = IS_ARRAY(row.embedding) && LENGTH(@embedding) > 0 && LENGTH(row.embedding) == LENGTH(@embedding) ? COSINE_SIMILARITY(row.embedding, @embedding) : null
      LET score = MAX([IS_NUMBER(semantic) ? semantic : 0, CONTAINS(LOWER(row.name), @needle) ? 0.4 : 0])
      FILTER score > 0 || @tagged || @includeUnranked
      SORT score DESC, row.updatedAt DESC
      LIMIT @limit
      RETURN MERGE(row, { score })
  `, { scopeKey, userKey, embedding, needle: input.query.toLocaleLowerCase(), ...folderBinding, tagged: Boolean(input.tagKeys?.length), includeUnranked: options.includeUnranked === true, limit });
  const filesCursor = await db.query(`
    FOR row IN files
      FILTER row.scopeKey == @scopeKey && row.userKey == @userKey
      ${fileFolderFilter}
      ${hiddenFilter}
      ${favoriteFilter}
      FILTER @extensions == null || row.extension IN @extensions
      ${managedFileFilter}
      LET semantic = IS_ARRAY(row.embedding) && LENGTH(@embedding) > 0 && LENGTH(row.embedding) == LENGTH(@embedding) ? COSINE_SIMILARITY(row.embedding, @embedding) : null
      LET score = MAX([IS_NUMBER(semantic) ? semantic : 0, CONTAINS(LOWER(row.name), @needle) ? 0.4 : 0])
      FILTER score > 0 || @tagged || @includeUnranked
      SORT score DESC, row.updatedAt DESC
      LIMIT @limit
      RETURN MERGE(row, { score })
  `, { scopeKey, userKey, embedding, needle: input.query.toLocaleLowerCase(), ...folderBinding, extensions: input.extensions ?? null, tagged: Boolean(input.tagKeys?.length), includeUnranked: options.includeUnranked === true, limit });
  const folderRows = (await foldersCursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row));
  const fileRows = (await filesCursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row));
  const tagKeys = input.tagKeys ?? [];
  const folders = [];
  for (const row of folderRows) {
    if (!(await matchingTagKeys(scopeKey, 'folder', String(row.key), tagKeys))) continue;
    folders.push({ ...publicFolder(row as unknown as Folder), score: Number(row.score ?? 0) });
  }
  const files = [];
  for (const row of fileRows) {
    if (!(await matchingTagKeys(scopeKey, 'file', String(row.key), tagKeys))) continue;
    files.push({ ...publicFile(row as unknown as FileRecord), score: Number(row.score ?? 0) });
  }
  return { query: input.query, folders, files };
}

export async function runContentTool(name: ContentToolName, rawInput: unknown, context: ToolContext, _dependencies?: ContentToolDependencies): Promise<unknown> {
  const input = contentToolContracts[name].input.parse(rawInput) as Record<string, unknown>;
  const userKey = contextUserKey(context);
  const scopeKey = context.runtimeScopeKey;
  const now = new Date().toISOString();
  if (name === 'folder.create') {
    const folders = input.folders as Array<{ key?: string; parentFolderKey?: string; name: string; description?: string }>;
    const created = [];
    for (const item of folders) {
      if (item.parentFolderKey) await requireFolder(context, item.parentFolderKey);
      const existing = item.key ? await getFolderInScope(scopeKey, item.key, userKey) : null;
      if (existing && (existing.name !== item.name || existing.parentFolderKey !== item.parentFolderKey || existing.description !== item.description)) throw new ContentError('CONTENT_CONFLICT', 'Folder key is already in use.', name);
      const folder = existing ?? await insertFolder({ key: item.key ?? newId(), userKey, scopeKey, parentFolderKey: item.parentFolderKey, name: item.name, description: item.description, isFavorite: false, isHidden: false, createdAt: now, updatedAt: now });
      created.push({ key: folder.key, success: true, data: { folder: publicFolder(folder) } });
    }
    return { results: created, summary: { requested: created.length, succeeded: created.length, failed: 0 } };
  }
  if (name === 'folder.list') {
    const parentFolderKey = input.folderKey as string | undefined;
    if (parentFolderKey) await requireFolder(context, parentFolderKey);
    const cursorKey = input.cursor as string | undefined;
    const after = cursorKey ? await requireFolder(context, cursorKey) : undefined;
    if (after && after.parentFolderKey !== parentFolderKey) throw new ContentError('CONTENT_INVALID_INPUT', 'Folder cursor does not belong to this location.', name);
    const page = await listFoldersInParentPage(scopeKey, userKey, parentFolderKey, Number(input.limit ?? 50), after);
    return { folders: visible(page.folders, input.favoritesOnly as boolean | undefined, input.includeHidden as boolean | undefined).map(publicFolder), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  if (name === 'folder.find') return { folder: publicFolder(await requireFolder(context, input.folderKey as string)) };
  if (name === 'folder.update' || name === 'folder.rename' || name === 'folder.move') {
    const folderKey = input.folderKey as string;
    await requireFolder(context, folderKey);
    const patch: Parameters<typeof updateFolderInScope>[3] = {};
    if (typeof input.name === 'string') patch.name = input.name;
    if ('description' in input) patch.description = input.description as string | undefined;
    if ('coverFileKey' in input) patch.coverFileKey = (input.coverFileKey as string | null) ?? undefined;
    if (typeof input.isFavorite === 'boolean') patch.isFavorite = input.isFavorite;
    if (typeof input.isHidden === 'boolean') patch.isHidden = input.isHidden;
    if (name === 'folder.move') patch.parentFolderKey = (input.parentFolderKey as string | null) ?? undefined;
    const updated = await updateFolderInScope(scopeKey, folderKey, userKey, patch);
    if (!updated) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', name);
    return { folder: publicFolder(updated) };
  }
  if (name === 'folder.copy') {
    const folder = await requireFolder(context, input.folderKey as string);
    const parentFolderKey = (input.parentFolderKey as string | null) ?? undefined;
    if (parentFolderKey) await requireFolder(context, parentFolderKey);
    if (await folderIsInside(scopeKey, userKey, folder.key, parentFolderKey)) throw new ContentError('CONTENT_INVALID_INPUT', 'A folder cannot be copied into itself.', name);
    return { folder: publicFolder(await copyFolderRecord(folder, parentFolderKey, context)) };
  }
  if (name === 'folder.delete') {
    const deleted = await deleteFolderInScope(scopeKey, input.folderKey as string, userKey);
    if (!deleted) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', name);
    return { deleted: true };
  }
  if (name === 'file.list') {
    const folderKey = input.folderKey as string | undefined;
    if (folderKey) await requireFolder(context, folderKey);
    if (input.includeDescendants === true) {
      if (input.limit !== undefined && input.limit !== 50) throw new ContentError('CONTENT_INVALID_INPUT', 'Nested inventory pages contain 50 files.', name);
      if (input.favoritesOnly || input.includeHidden || input.createdFrom || input.createdTo) throw new ContentError('CONTENT_INVALID_INPUT', 'Nested inventory does not support these filters.', name);
      const folderCursor = await db.query('FOR folder IN folders FILTER folder.userKey == @userKey && folder.scopeKey == @scopeKey && folder.isHidden != true RETURN KEEP(folder, "_key", "parentFolderKey")', { userKey, scopeKey });
      const ownedFolders = (await folderCursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row) as { key: string; parentFolderKey?: string });
      const folderKeys = new Set(ownedFolders.map(({ key }) => key));
      const descendants = (key: string) => {
        const keys = new Set([key]);
        for (let changed = true; changed;) {
          changed = false;
          for (const folder of ownedFolders) if (folder.parentFolderKey && keys.has(folder.parentFolderKey) && !keys.has(folder.key)) { keys.add(folder.key); changed = true; }
        }
        return [...keys];
      };
      const inventory = await listWorkspaceInventory({ context, folderKey, extensions: input.extensions as FileRecord['extension'][] | undefined, cursor: input.cursor as string | undefined, folderExists: (key) => folderKeys.has(key), descendants, folderPath: () => [] });
      if (inventory.status === 'partial' && inventory.count === undefined) throw new ContentError('CONTENT_INVALID_INPUT', inventory.reason ?? 'Inventory page unavailable.', name);
      const files = (await Promise.all(inventory.files.map((file) => getFileInScope(scopeKey, file.key, userKey)))).filter((file): file is FileRecord => Boolean(file) && !file!.isHidden).map(publicFile);
      return { files, count: inventory.count, ...(inventory.nextCursor ? { cursor: inventory.nextCursor } : {}) };
    }
    const cursorKey = input.cursor as string | undefined;
    const after = cursorKey ? await requireFile(context, cursorKey) : undefined;
    if (after && after.folderKey !== folderKey) throw new ContentError('CONTENT_INVALID_INPUT', 'File cursor does not belong to this location.', name);
    const page = await listFilesInFolder(scopeKey, userKey, folderKey, Number(input.limit ?? 50), after);
    const extensions = input.extensions as string[] | undefined;
    return { files: visible(page.files, input.favoritesOnly as boolean | undefined, input.includeHidden as boolean | undefined).filter((file) => !extensions || extensions.includes(file.extension)).map(publicFile), ...(page.cursor ? { cursor: page.cursor } : {}) };
  }
  if (name === 'file.find') return { file: publicFile(await requireFile(context, input.fileKey as string)) };
  if (name === 'file.update' || name === 'file.rename' || name === 'file.move') {
    const file = await requireFile(context, input.fileKey as string);
    const patch: Parameters<typeof updateFile>[1] = {};
    if (typeof input.name === 'string') patch.name = input.name;
    if (typeof input.isFavorite === 'boolean') patch.isFavorite = input.isFavorite;
    if (typeof input.isHidden === 'boolean') patch.isHidden = input.isHidden;
    if (name === 'file.move') patch.folderKey = (input.folderKey as string | null) ?? undefined;
    return { file: publicFile(await updateFile(file.key, patch)) };
  }
  if (name === 'file.copy') {
    const file = await requireFile(context, input.fileKey as string);
    const folderKey = (input.folderKey as string | null) ?? undefined;
    if (folderKey) await requireFolder(context, folderKey);
    return { file: publicFile(await copyFileRecord(file, folderKey, userKey)) };
  }
  if (name === 'file.delete') {
    const storageKey = await deleteFileInScope(scopeKey, input.fileKey as string, userKey);
    if (!storageKey) throw new ContentError('CONTENT_NOT_FOUND', 'File was not found.', name);
    return { deleted: true };
  }
  if (name === 'file.download') {
    const file = await requireFile(context, input.fileKey as string);
    return { fileKey: file.key, url: await signedMediaDownloadUrl(file.storageKey), ...(file.thumbnailStorageKey ? { thumbnailUrl: await signedMediaDownloadUrl(file.thumbnailStorageKey) } : {}), fileName: `${file.name}.${file.extension}`, mimeType: file.mimeType };
  }
  if (name === 'content.search') {
    return searchWorkspace(context, input as { query: string; folderKey?: string; favoritesOnly?: boolean; includeHidden?: boolean; tagKeys?: string[]; extensions?: string[]; limit?: number }, { includeUnranked: true });
  }
  if (name === 'content.search-history.record') {
    return { item: await getDefaultUserSearchService().record(userKey, input.query as string) };
  }
  if (name === 'content.search-history.list') {
    const items = await getDefaultUserSearchService().list(userKey, Number(input.limit ?? 50));
    return { items };
  }
  if (name === 'content.search-history.delete') {
    const result = await getDefaultUserSearchService().remove(userKey, input.normalizedQuery as string);
    return { deleted: result.deleted };
  }
  if (name === 'tag.list') {
    return { items: (await listTagsByScope(scopeKey, userKey)).map(publicTag) };
  }
  if (name === 'tag.create') {
    const nameValue = String(input.name).normalize('NFKC').trim().replace(/\s+/g, ' ');
    const tag = {
      key: (input.key as string | undefined) ?? newId(),
      scopeKey,
      userKey,
      name: nameValue,
      normalizedName: nameValue.toLowerCase(),
      createdAt: now,
      updatedAt: now,
    };
    return { tag: publicTag(await insertTag(tag)) };
  }
  if (name === 'tag.assignment.list') {
    const targets = input.targets as Array<{ type: 'folder' | 'file'; key: string }>;
    const ownedTags = new Set((await listTagsByScope(scopeKey, userKey)).map(({ key }) => key));
    const items = [];
    for (const target of targets) {
      if (target.type === 'folder') await requireFolder(context, target.key);
      else await requireFile(context, target.key);
      const assignments = await listTagAssignmentsByScope(scopeKey, target.type, target.key);
      items.push({ target, tagKeys: [...new Set(assignments.map(({ tagKey }) => tagKey).filter((key) => ownedTags.has(key)))] });
    }
    return { items };
  }
  if (name === 'tag.assignment.set') {
    const targets = input.targets as Array<{ type: 'folder' | 'file'; key: string }>;
    const tagKeys = input.tagKeys as string[];
    const assigned = input.assigned as boolean;
    const ownedTags = new Set((await listTagsByScope(scopeKey, userKey)).map(({ key }) => key));
    if (tagKeys.some((key) => !ownedTags.has(key))) throw new ContentError('CONTENT_NOT_FOUND', 'Tag was not found.', name);
    for (const target of targets) {
      if (target.type === 'folder') await requireFolder(context, target.key);
      else await requireFile(context, target.key);
    }
    let changedCount = 0;
    for (const target of targets) {
      for (const tagKey of tagKeys) {
        const existing = (await listTagAssignmentsByScope(scopeKey, target.type, target.key)).find((row) => row.tagKey === tagKey);
        if (assigned && !existing) {
          await insertTagAssignment({ key: newId(), scopeKey, tagKey, sourceType: target.type, sourceKey: target.key, source: 'user', createdAt: now });
          changedCount += 1;
        }
        if (!assigned && existing) {
          await deleteTagAssignment(existing.key);
          changedCount += 1;
        }
      }
    }
    return { changedCount };
  }
  throw new ContentError('CONTENT_INVALID_INPUT', `Unknown content tool ${name}.`, name);
}

export async function ingestExtractedText(fileKey: string, extractedText: string) {
  const chunks = chunkDocumentText(extractedText);
  const texts = chunks.map((chunk) => chunk.text);
  const [embedding, chunkEmbeddings] = await Promise.all([
    embedText({ text: extractedText.slice(0, 8_000) }),
    texts.length ? embedTexts({ texts }) : Promise.resolve([]),
  ]);
  return storeFileTextIndex(fileKey, { extractedText, contentChunks: texts, chunkEmbeddings, embedding });
}

export async function markFileReady(fileKey: string) {
  return updateFile(fileKey, { processing: 'ready' });
}

export async function markFileFailed(fileKey: string) {
  await updateFile(fileKey, { processing: 'failed' });
}

export { insertFile };
