import { newId } from '@/lib/ids';
import { embedText, embedTexts } from '@/lib/embeddings';
import { chunkDocumentText } from '@/lib/ai/document-processing/chunking';
import { signedMediaDownloadUrl } from '@/lib/media-delivery';
import { deleteFolderInScope, getFolderInScope, insertFolder, listFoldersInParent, updateFolderInScope, type Folder } from '@/lib/db/folders.node';
import { deleteFileInScope, getFileInScope, insertFile, listFilesInFolder, updateFile, type FileRecord } from '@/lib/db/files.node';
import { contextUserKey, type ToolContext } from './tool-context';
import { ContentError } from './content-errors';
import { contentFolderSchema, contentFileSchema, contentToolContracts, type ContentToolName } from './content-schemas';

export type ContentToolDependencies = Record<string, never>;

const MUTATIONS = new Set<ContentToolName>(['folder.create', 'folder.update', 'folder.rename', 'folder.move', 'folder.delete', 'file.update', 'file.rename', 'file.move', 'file.delete']);

export function isContentMutation(name: string, _input?: unknown) {
  return MUTATIONS.has(name as ContentToolName);
}

function publicFolder(folder: Folder) {
  return contentFolderSchema.parse({ key: folder.key, scopeKey: folder.scopeKey, parentFolderKey: folder.parentFolderKey, name: folder.name, description: folder.description, isFavorite: folder.isFavorite, createdAt: folder.createdAt, updatedAt: folder.updatedAt });
}

function publicFile(file: FileRecord) {
  return contentFileSchema.parse({ key: file.key, scopeKey: file.scopeKey, folderKey: file.folderKey, name: file.name, extension: file.extension, mimeType: file.mimeType, sizeBytes: file.sizeBytes, processing: file.processing, isFavorite: file.isFavorite, createdAt: file.createdAt, updatedAt: file.updatedAt });
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

export async function runContentTool(name: ContentToolName, rawInput: unknown, context: ToolContext, _dependencies?: ContentToolDependencies): Promise<unknown> {
  const input = contentToolContracts[name].input.parse(rawInput) as Record<string, unknown>;
  const userKey = contextUserKey(context);
  const scopeKey = context.runtimeScopeKey;
  const now = new Date().toISOString();
  if (name === 'folder.create') {
    const folders = input.folders as Array<{ parentFolderKey?: string; name: string; description?: string }>;
    const created = [];
    for (const item of folders) {
      if (item.parentFolderKey) await requireFolder(context, item.parentFolderKey);
      const folder = await insertFolder({ key: newId(), userKey, scopeKey, parentFolderKey: item.parentFolderKey, name: item.name, description: item.description, isFavorite: false, createdAt: now, updatedAt: now });
      created.push({ key: folder.key, success: true, data: { folder: publicFolder(folder) } });
    }
    return { results: created, summary: { requested: created.length, succeeded: created.length, failed: 0 } };
  }
  if (name === 'folder.list') {
    const folders = await listFoldersInParent(scopeKey, userKey, input.folderKey as string | undefined, Number(input.limit ?? 50));
    return { folders: folders.map(publicFolder) };
  }
  if (name === 'folder.find') return { folder: publicFolder(await requireFolder(context, input.folderKey as string)) };
  if (name === 'folder.update' || name === 'folder.rename' || name === 'folder.move') {
    const folderKey = input.folderKey as string;
    await requireFolder(context, folderKey);
    const patch: Parameters<typeof updateFolderInScope>[3] = {};
    if (typeof input.name === 'string') patch.name = input.name;
    if ('description' in input) patch.description = input.description as string | undefined;
    if (typeof input.isFavorite === 'boolean') patch.isFavorite = input.isFavorite;
    if (name === 'folder.move') patch.parentFolderKey = (input.parentFolderKey as string | null) ?? undefined;
    const updated = await updateFolderInScope(scopeKey, folderKey, userKey, patch);
    if (!updated) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', name);
    return { folder: publicFolder(updated) };
  }
  if (name === 'folder.delete') {
    const deleted = await deleteFolderInScope(scopeKey, input.folderKey as string, userKey);
    if (!deleted) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', name);
    return { deleted: true };
  }
  if (name === 'file.list') {
    const files = await listFilesInFolder(scopeKey, userKey, input.folderKey as string | undefined, Number(input.limit ?? 50), input.cursor as string | undefined);
    const extensions = input.extensions as string[] | undefined;
    return { files: files.filter((file) => !extensions || extensions.includes(file.extension)).map(publicFile) };
  }
  if (name === 'file.find') return { file: publicFile(await requireFile(context, input.fileKey as string)) };
  if (name === 'file.update' || name === 'file.rename' || name === 'file.move') {
    const file = await requireFile(context, input.fileKey as string);
    const patch: Parameters<typeof updateFile>[1] = {};
    if (typeof input.name === 'string') patch.name = input.name;
    if (typeof input.isFavorite === 'boolean') patch.isFavorite = input.isFavorite;
    if (name === 'file.move') patch.folderKey = (input.folderKey as string | null) ?? undefined;
    return { file: publicFile(await updateFile(file.key, patch)) };
  }
  if (name === 'file.delete') {
    const storageKey = await deleteFileInScope(scopeKey, input.fileKey as string, userKey);
    if (!storageKey) throw new ContentError('CONTENT_NOT_FOUND', 'File was not found.', name);
    return { deleted: true };
  }
  if (name === 'file.download') {
    const file = await requireFile(context, input.fileKey as string);
    return { fileKey: file.key, url: await signedMediaDownloadUrl(file.storageKey), fileName: `${file.name}.${file.extension}`, mimeType: file.mimeType };
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
  await updateFile(fileKey, { extractedText, contentChunks: texts, chunkEmbeddings, embedding, processing: 'ready' });
}

export async function markFileReady(fileKey: string) {
  await updateFile(fileKey, { processing: 'ready' });
}

export async function markFileFailed(fileKey: string) {
  await updateFile(fileKey, { processing: 'failed' });
}

export { insertFile };
