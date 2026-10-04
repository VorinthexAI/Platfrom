import { apiClient } from "./api-client";
import * as Crypto from "expo-crypto";
import { File, UploadType } from "expo-file-system";
import { useAuthStore } from "@/state/auth";
import { mapWithConcurrency } from "./bounded-concurrency";
import { createImageThumbnail, createVideoThumbnail, type LocalThumbnail } from "./content-thumbnails";

import {
  planContentSelectionCopy,
  planContentSelectionDelete,
  planContentSelectionFavorite,
  planContentSelectionMove,
  type ContentSelection,
  type ContentSelectionOperation,
  type ContentSelectionPlan,
} from "./content-selection-plans";

export type { ContentSelection } from "./content-selection-plans";

export const FILE_EXTENSIONS = ["txt", "md", "docx", "pdf", "jpg", "jpeg", "png", "webp", "gif", "mp3", "mp4", "mov"] as const;
export type FileExtension = (typeof FILE_EXTENSIONS)[number];
export const FILE_LOCATION_PAGE_SIZE = 50;

export type ContentContext = {
  scopeKey: string;
  userKey?: string;
};

export type ContentFolder = {
  key: string;
  scopeKey: string;
  parentFolderKey?: string;
  name: string;
  description?: string;
  coverFileKey?: string;
  isFavorite?: boolean;
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContentFile = {
  key: string;
  scopeKey: string;
  folderKey?: string;
  name: string;
  extension: FileExtension;
  mimeType: string;
  sizeBytes: number;
  caption?: string;
  hasThumbnail?: boolean;
  hasExtractedText?: boolean;
  processing: "pending" | "ready" | "failed";
  isFavorite: boolean;
  isHidden?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ContentSearchHistoryItem = {
  query: string;
  normalizedQuery: string;
  searchedAt: string;
  usageCount: number;
};

export type ContentSearchFile = {
  fileKey: string;
  name: string;
  extension?: FileExtension;
  isFavorite: boolean;
  hasThumbnail?: boolean;
  hasExtractedText?: boolean;
  score: number;
  scopeKey?: string;
  folderKey?: string;
  folder?: { key: string; name: string };
};

export type ContentSearchResponse = {
  query: string;
  cached: boolean;
  folders: (ContentFolder & { score: number })[];
  files: ContentSearchFile[];
};

type ToolResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string; action?: string } };

export type ContentBatchFailure = ContentSelectionOperation & { tool: string; message: string; code?: string; action?: string };

export type ContentBatchOutcome = {
  folders: ContentFolder[];
  files: ContentFile[];
  failures: ContentBatchFailure[];
  requested: number;
  succeeded: number;
  failed: number;
};

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

function contentToolError(error: { message: string; code?: string; action?: string }) {
  return Object.assign(new Error(error.message), error.code ? { code: error.code } : {}, error.action ? { action: error.action } : {});
}

export function getContentContext(): ContentContext {
  const state = useAuthStore.getState();
  return { scopeKey: recordKey(state.scope), userKey: state.user?.key ?? "" };
}

export function isContentContextConfigured(context: ContentContext) {
  return context.scopeKey.trim().length > 0;
}

export function createContentMutationKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createContentRecordKey() {
  return `c${Crypto.randomUUID().replace(/-/g, "")}`;
}

async function callContentTool<T>(tool: string, input: Record<string, unknown>, signal?: AbortSignal, requestContext = getContentContext()): Promise<T> {
  if (!isContentContextConfigured(requestContext)) throw new Error("Files are unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/api/v1/content/tools/${tool}`, {
      scopeKey: requestContext.scopeKey,
      input,
    }, { signal, ...(typeof input.idempotencyKey === "string" ? { headers: { "Idempotency-Key": input.idempotencyKey } } : {}), timeout: 60_000 });
    if (!response.data.success) throw contentToolError(response.data.error);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ToolResponse<T> } }).response?.data;
    if (failure && !failure.success) throw contentToolError(failure.error);
    throw error;
  }
}

async function executeContentSelectionPlan(plan: ContentSelectionPlan): Promise<ContentBatchOutcome> {
  const folders: ContentFolder[] = [];
  const files: ContentFile[] = [];
  const failures: ContentBatchFailure[] = [];
  for (const call of plan.calls) {
    for (const operation of call.operations) {
      try {
        const data = await callContentTool<Record<string, unknown>>(call.tool, call.inputFor(operation));
        if (data.folder) folders.push(data.folder as ContentFolder);
        if (data.file) files.push(data.file as ContentFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The file operation failed.";
        const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
        const action = typeof (error as { action?: unknown })?.action === "string" ? (error as { action: string }).action : undefined;
        failures.push({ ...operation, tool: call.tool, message, ...(code ? { code } : {}), ...(action ? { action } : {}) });
      }
    }
  }
  return { folders, files, failures, requested: plan.operationCount, succeeded: plan.operationCount - failures.length, failed: failures.length };
}

const FILE_MIME: Record<FileExtension, string> = {
  txt: "text/plain",
  md: "text/markdown",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  mov: "video/quicktime",
};

function fileExtensionOf(name: string, mimeType: string): FileExtension | undefined {
  const fromName = name.toLowerCase().split(".").pop();
  if (fromName && (FILE_EXTENSIONS as readonly string[]).includes(fromName)) return fromName as FileExtension;
  const mime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const match = (Object.entries(FILE_MIME) as [FileExtension, string][]).find(([, type]) => type === mime);
  return match?.[0];
}

function fileFilename(name: string, extension: FileExtension) {
  const filename = name.trim() || "File";
  return filename.toLowerCase().endsWith(`.${extension}`) ? filename : `${filename}.${extension}`;
}

export async function listContentFolderPage(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext(), cursor?: string, limit = FILE_LOCATION_PAGE_SIZE, filters?: { favoritesOnly?: boolean; includeHidden?: boolean }) {
  return callContentTool<{ folders: ContentFolder[]; cursor?: string }>("folder.list", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
    ...(filters?.favoritesOnly ? { favoritesOnly: true } : {}),
    ...(filters?.includeHidden ? { includeHidden: true } : {}),
  }, signal, contentContext);
}

export async function listContentFilePage(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext(), cursor?: string, limit = FILE_LOCATION_PAGE_SIZE, extensions?: readonly string[], filters?: { favoritesOnly?: boolean; includeHidden?: boolean }) {
  return callContentTool<{ files: ContentFile[]; cursor?: string }>("file.list", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
    ...(extensions?.length ? { extensions: [...extensions] } : {}),
    ...(filters?.favoritesOnly ? { favoritesOnly: true } : {}),
    ...(filters?.includeHidden ? { includeHidden: true } : {}),
  }, signal, contentContext);
}

export async function listContentInventoryPage(context: ContentContext, input: { folderKey?: string; extensions?: readonly FileExtension[]; cursor?: string }, signal?: AbortSignal) {
  return callContentTool<{ files: ContentFile[]; count: number; cursor?: string }>("file.list", {
    scopeKey: context.scopeKey, includeDescendants: true, limit: 50,
    ...(input.folderKey ? { folderKey: input.folderKey } : {}),
    ...(input.extensions ? { extensions: [...input.extensions] } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
  }, signal, context);
}

export async function listContentLocation(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext()) {
  const [foldersPage, filesPage] = await Promise.all([
    listContentFolderPage(folderKey, signal, contentContext),
    listContentFilePage(folderKey, signal, contentContext),
  ]);
  return { folders: foldersPage.folders, files: filesPage.files, folderCursor: foldersPage.cursor, fileCursor: filesPage.cursor };
}

export async function findContentFolder(folderKey: string, contentContext = getContentContext(), signal?: AbortSignal) {
  const data = await callContentTool<{ folder: ContentFolder }>("folder.find", { folderKey }, signal, contentContext);
  return data.folder;
}

export async function findContentFile(fileKey: string, contentContext = getContentContext(), signal?: AbortSignal) {
  const data = await callContentTool<{ file: ContentFile }>("file.find", { fileKey }, signal, contentContext);
  return data.file;
}

export async function createContentFolder(name: string, parentFolderKey?: string, description?: string, mutationKey = createContentMutationKey(), folderKey?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.create", {
    scopeKey: contentContext.scopeKey,
    folders: [{ scopeKey: contentContext.scopeKey, ...(folderKey ? { key: folderKey } : {}), ...(parentFolderKey ? { parentFolderKey } : {}), name, ...(description ? { description } : {}) }],
    idempotencyKey: mutationKey,
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be created.");
  return result.data.folder;
}

export async function updateContentFolder(folderKey: string, patch: { name?: string; description?: string | null; isFavorite?: boolean; isHidden?: boolean; coverFileKey?: string | null }) {
  return (await callContentTool<{ folder: ContentFolder }>("folder.update", { folderKey, ...patch })).folder;
}

export async function renameContentFolder(folderKey: string, name: string) {
  return (await callContentTool<{ folder: ContentFolder }>("folder.rename", { folderKey, name })).folder;
}

export async function moveContentFolder(folderKey: string, parentFolderKey?: string) {
  return (await callContentTool<{ folder: ContentFolder }>("folder.move", { folderKey, parentFolderKey: parentFolderKey ?? null })).folder;
}

export async function deleteContentFolder(folderKey: string) {
  await callContentTool<{ deleted: true }>("folder.delete", { folderKey });
}

export async function renameContentFile(fileKey: string, name: string) {
  return (await callContentTool<{ file: ContentFile }>("file.rename", { fileKey, name })).file;
}

export async function updateContentFile(fileKey: string, patch: { name?: string; isFavorite?: boolean; isHidden?: boolean }) {
  return (await callContentTool<{ file: ContentFile }>("file.update", { fileKey, ...patch })).file;
}

export async function moveContentFile(fileKey: string, folderKey?: string) {
  return (await callContentTool<{ file: ContentFile }>("file.move", { fileKey, folderKey: folderKey ?? null })).file;
}

export async function deleteContentFile(fileKey: string) {
  await callContentTool<{ deleted: true }>("file.delete", { fileKey });
}

export async function downloadContentFile(fileKey: string, contentContext = getContentContext()) {
  return callContentTool<{ fileKey: string; url: string; thumbnailUrl?: string; fileName: string; mimeType: string }>("file.download", { fileKey }, undefined, contentContext);
}

export function setContentSelectionFavorite(selection: ContentSelection, isFavorite: boolean, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionFavorite(selection, isFavorite, idempotencyKey));
}

export function moveContentSelection(selection: ContentSelection, targetFolderKey?: string, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionMove(selection, targetFolderKey, idempotencyKey));
}

export function copyContentSelection(selection: ContentSelection, targetFolderKey?: string, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionCopy(selection, targetFolderKey, idempotencyKey));
}

export function hardDeleteContentSelection(selection: ContentSelection, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionDelete(selection, idempotencyKey));
}

export async function setContentFolderFavorite(folderKey: string, isFavorite: boolean) {
  return updateContentFolder(folderKey, { isFavorite });
}

export async function setContentFileFavorite(fileKey: string, isFavorite: boolean) {
  return updateContentFile(fileKey, { isFavorite });
}

type DirectFile = { name: string; type: string; size: number; uri: string };

async function extractLocalText(uri: string, extension: FileExtension) {
  if (extension === "txt" || extension === "md") {
    const bytes = await new File(uri).arrayBuffer();
    return new TextDecoder().decode(bytes);
  }
  if (extension === "docx") {
    try {
      const mammoth = await import("mammoth");
      const bytes = await new File(uri).arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: bytes });
      const text = result.value.trim();
      return text || undefined;
    } catch {
      return undefined;
    }
  }
  if (extension === "pdf") {
    const { extractText } = await import("react-native-pdf-text-extractor");
    const text = await extractText(uri, { normalize: true });
    return text.trim() || undefined;
  }
  return undefined;
}

export async function uploadContentFiles(files: DirectFile[], folderKey?: string, contentContext = getContentContext(), idempotencyKey = createContentMutationKey(), onThumbnail?: (index: number, uri: string) => void) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Files are unavailable for this session.");
  const sources = files.map((file) => {
    const extension = fileExtensionOf(file.name, file.type);
    if (!extension) throw new Error(`Unsupported file type: ${file.name}`);
    return { filename: fileFilename(file.name, extension), mimeType: FILE_MIME[extension], sizeBytes: file.size, extension, uri: file.uri };
  });
  const thumbnails = await mapWithConcurrency(sources, 3, async (source, index): Promise<LocalThumbnail | undefined> => {
    try {
      const thumbnail = ["jpg", "jpeg", "png", "webp", "gif"].includes(source.extension) ? await createImageThumbnail(source.uri) : source.extension === "mp4" || source.extension === "mov" ? await createVideoThumbnail(source.uri) : undefined;
      if (thumbnail) onThumbnail?.(index, thumbnail.uri);
      return thumbnail;
    } catch { /* A file remains uploadable when a local thumbnail cannot be decoded. */ }
    return undefined;
  });
  try {
  if (sources.some((source, index) => (["jpg", "jpeg", "png", "webp", "gif", "mp4", "mov"] as FileExtension[]).includes(source.extension) && !thumbnails[index])) throw new Error("A preview image could not be prepared for this media file.");
  const localText = await Promise.all(sources.map((source) => extractLocalText(source.uri, source.extension)));
  const unwrap = <T>(response: ToolResponse<T>) => {
    if (!response.success) throw contentToolError(response.error);
    return response.data;
  };
  const reserved = unwrap((await apiClient.post<ToolResponse<{ uploadKey: string; files: { fileKey: string; url: string; headers: Record<string, string>; thumbnail?: { url: string; headers: Record<string, string> } }[] }>>("/api/v1/content/uploads/presign", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    idempotencyKey,
    files: sources.map(({ uri: _uri, ...file }, index) => ({ ...file, ...(thumbnails[index] ? { thumbnail: { mimeType: thumbnails[index]!.mimeType, sizeBytes: thumbnails[index]!.sizeBytes } } : {}) })),
  })).data);
  if (reserved.files.length !== sources.length) throw new Error("File upload reservation did not match the selected files.");
  const extractedText: Record<string, string> = {};
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    const upload = reserved.files[index]!;
    const sourceFile = new File(source.uri);
    if (sourceFile.size !== source.sizeBytes) throw new Error("A selected file changed before it could be uploaded.");
    const controller = new AbortController();
    const video = source.extension === "mp4" || source.extension === "mov";
    const timeout = setTimeout(() => controller.abort(), video ? 10 * 60_000 : 2 * 60_000);
    try {
      if (video) {
        const response = await sourceFile.upload(upload.url, { httpMethod: "PUT", uploadType: UploadType.BINARY_CONTENT, headers: upload.headers, signal: controller.signal });
        if (response.status < 200 || response.status >= 300) throw new Error(`File upload failed (${response.status}).`);
      } else {
        const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: await sourceFile.arrayBuffer(), signal: controller.signal });
        if (!response.ok) throw new Error(`File upload failed (${response.status}).`);
      }
      const thumbnail = thumbnails[index];
      if (thumbnail) {
        if (!upload.thumbnail) throw new Error("The thumbnail reservation was not returned.");
        const thumbnailBytes = await new File(thumbnail.uri).arrayBuffer();
        if (thumbnailBytes.byteLength !== thumbnail.sizeBytes) throw new Error("The thumbnail changed before it could be uploaded.");
        const saved = await fetch(upload.thumbnail.url, { method: "PUT", headers: upload.thumbnail.headers, body: thumbnailBytes, signal: controller.signal });
        if (!saved.ok) throw new Error(`Thumbnail upload failed (${saved.status}).`);
      }
    } finally {
      clearTimeout(timeout);
    }
    const text = localText[index];
    if (text) extractedText[upload.fileKey] = text;
  }
  return unwrap((await apiClient.post<ToolResponse<{ files: { key: string; name: string; extension: FileExtension; processing: ContentFile["processing"]; hasThumbnail: boolean }[] }>>("/api/v1/content/uploads/complete", {
    scopeKey: contentContext.scopeKey,
    uploadKey: reserved.uploadKey,
    idempotencyKey,
    ...(Object.keys(extractedText).length ? { extractedText } : {}),
  }, { timeout: 5 * 60_000 })).data);
  } finally {
    for (const thumbnail of thumbnails) if (thumbnail) { try { new File(thumbnail.uri).delete(); } catch { /* Temporary images can already be gone. */ } }
  }
}

export async function uploadContentFile(file: DirectFile, folderKey?: string, contentContext = getContentContext(), idempotencyKey = createContentMutationKey()) {
  return uploadContentFiles([file], folderKey, contentContext, idempotencyKey);
}

export async function searchContent(query: string, folderKey?: string, filters?: { favoritesOnly?: boolean; includeHidden?: boolean; tagKeys?: string[]; extensions?: FileExtension[] }): Promise<ContentSearchResponse> {
  const output = await callContentTool<{ query: string; folders: (ContentFolder & { score: number })[]; files: (ContentFile & { score: number })[] }>("content.search", {
    scopeKey: getContentContext().scopeKey,
    query,
    ...(folderKey ? { folderKey } : {}),
    ...(filters?.favoritesOnly ? { favoritesOnly: true } : {}),
    ...(filters?.includeHidden ? { includeHidden: true } : {}),
    ...(filters?.tagKeys?.length ? { tagKeys: filters.tagKeys } : {}),
    ...(filters?.extensions?.length ? { extensions: filters.extensions } : {}),
    limit: 50,
  });
  return {
    query: output.query,
    cached: false,
    folders: output.folders,
    files: output.files.map((file) => ({
      fileKey: file.key,
      name: file.name,
      extension: file.extension,
      isFavorite: file.isFavorite,
      hasThumbnail: file.hasThumbnail,
      hasExtractedText: file.hasExtractedText,
      score: file.score,
      folderKey: file.folderKey,
    })),
  };
}

export function searchContentMatches(query: string, _signal?: AbortSignal, folderKey?: string) {
  return searchContent(query, folderKey);
}

export async function recordContentSearchHistory(query: string, context = getContentContext()): Promise<ContentSearchHistoryItem> {
  const data = await callContentTool<{ item: ContentSearchHistoryItem }>("content.search-history.record", { scopeKey: context.scopeKey, query }, undefined, context);
  return data.item;
}

export async function listContentSearchHistory(_requestContext = getContentContext()): Promise<ContentSearchHistoryItem[]> {
  const data = await callContentTool<{ items: ContentSearchHistoryItem[] }>("content.search-history.list", { scopeKey: _requestContext.scopeKey, limit: 50 }, undefined, _requestContext);
  return data.items;
}

export async function deleteContentSearchHistory(normalizedQuery: string) {
  return callContentTool<{ deleted: boolean }>("content.search-history.delete", { scopeKey: getContentContext().scopeKey, normalizedQuery });
}
