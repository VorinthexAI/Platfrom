import { apiClient } from "./api-client";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { z } from "zod";
import { useAuthStore } from "@/state/auth";
import { appSearchResults, searchApp } from "./app-search-client";
import {
  planContentSelectionDelete,
  planContentSelectionFavorite,
  planContentSelectionMove,
  type ContentSelection,
  type ContentSelectionOperation,
  type ContentSelectionPlan,
} from "./content-selection-plans";

export type { ContentSelection } from "./content-selection-plans";

export const FILE_EXTENSIONS = ["txt", "md", "docx", "pdf", "jpg", "jpeg", "png", "webp", "gif", "mp3", "mp4"] as const;
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
  isFavorite?: boolean;
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
  processing: "pending" | "ready" | "failed";
  isFavorite: boolean;
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

export async function listContentFolderTree(signal?: AbortSignal, contentContext = getContentContext()) {
  const folders: ContentFolder[] = [];
  let cursor: string | undefined;
  do {
    const data: { folders: ContentFolder[]; cursor?: string } = await callContentTool("folder.list", {
      scopeKey: contentContext.scopeKey,
      ...(cursor ? { cursor } : {}),
      limit: 100,
    }, signal, contentContext);
    folders.push(...data.folders);
    cursor = data.cursor;
  } while (cursor);
  return folders;
}

export async function listContentFolderPage(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext(), cursor?: string, limit = FILE_LOCATION_PAGE_SIZE) {
  return callContentTool<{ folders: ContentFolder[]; cursor?: string }>("folder.list", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
  }, signal, contentContext);
}

export async function listContentFilePage(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext(), cursor?: string, limit = FILE_LOCATION_PAGE_SIZE, extensions?: readonly string[]) {
  return callContentTool<{ files: ContentFile[]; cursor?: string }>("file.list", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    ...(cursor ? { cursor } : {}),
    limit,
    ...(extensions?.length ? { extensions: [...extensions] } : {}),
  }, signal, contentContext);
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

export async function createContentFolder(name: string, parentFolderKey?: string, description?: string, mutationKey = createContentMutationKey()) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.create", {
    scopeKey: contentContext.scopeKey,
    folders: [{ scopeKey: contentContext.scopeKey, parentFolderKey, name, ...(description ? { description } : {}) }],
    idempotencyKey: mutationKey,
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be created.");
  return result.data.folder;
}

export async function updateContentFolder(folderKey: string, patch: { name?: string; description?: string | null; isFavorite?: boolean }) {
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

export async function updateContentFile(fileKey: string, patch: { name?: string; isFavorite?: boolean }) {
  return (await callContentTool<{ file: ContentFile }>("file.update", { fileKey, ...patch })).file;
}

export async function moveContentFile(fileKey: string, folderKey?: string) {
  return (await callContentTool<{ file: ContentFile }>("file.move", { fileKey, folderKey: folderKey ?? null })).file;
}

export async function deleteContentFile(fileKey: string) {
  await callContentTool<{ deleted: true }>("file.delete", { fileKey });
}

export async function downloadContentFile(fileKey: string) {
  return callContentTool<{ fileKey: string; url: string; fileName: string; mimeType: string }>("file.download", { fileKey });
}

export function setContentSelectionFavorite(selection: ContentSelection, isFavorite: boolean, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionFavorite(selection, isFavorite, idempotencyKey));
}

export function moveContentSelection(selection: ContentSelection, targetFolderKey?: string, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionMove(selection, targetFolderKey, idempotencyKey));
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
  return undefined;
}

export async function uploadContentFiles(files: DirectFile[], folderKey?: string, contentContext = getContentContext(), idempotencyKey = createContentMutationKey()) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Files are unavailable for this session.");
  const sources = files.map((file) => {
    const extension = fileExtensionOf(file.name, file.type);
    if (!extension) throw new Error(`Unsupported file type: ${file.name}`);
    return { filename: fileFilename(file.name, extension), mimeType: FILE_MIME[extension], sizeBytes: file.size, extension, uri: file.uri };
  });
  const unwrap = <T>(response: ToolResponse<T>) => {
    if (!response.success) throw contentToolError(response.error);
    return response.data;
  };
  const reserved = unwrap((await apiClient.post<ToolResponse<{ uploadKey: string; files: { fileKey: string; url: string; headers: Record<string, string> }[] }>>("/api/v1/content/uploads/presign", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey } : {}),
    idempotencyKey,
    files: sources.map(({ uri: _uri, ...file }) => file),
  })).data);
  if (reserved.files.length !== sources.length) throw new Error("File upload reservation did not match the selected files.");
  const extractedText: Record<string, string> = {};
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]!;
    const upload = reserved.files[index]!;
    const bytes = await new File(source.uri).arrayBuffer();
    if (bytes.byteLength !== source.sizeBytes) throw new Error("A selected file changed before it could be uploaded.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2 * 60_000);
    try {
      const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes, signal: controller.signal });
      if (!response.ok) throw new Error(`File upload failed (${response.status}).`);
    } finally {
      clearTimeout(timeout);
    }
    const text = await extractLocalText(source.uri, source.extension);
    if (text) extractedText[upload.fileKey] = text;
  }
  return unwrap((await apiClient.post<ToolResponse<{ files: { key: string; name: string; extension: FileExtension; processing: ContentFile["processing"] }[] }>>("/api/v1/content/uploads/complete", {
    scopeKey: contentContext.scopeKey,
    uploadKey: reserved.uploadKey,
    idempotencyKey,
    ...(Object.keys(extractedText).length ? { extractedText } : {}),
  }, { timeout: 5 * 60_000 })).data);
}

export async function uploadContentFile(file: DirectFile, folderKey?: string, contentContext = getContentContext(), idempotencyKey = createContentMutationKey()) {
  return uploadContentFiles([file], folderKey, contentContext, idempotencyKey);
}

const appFolderResultSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  parentFolderKey: z.string().min(1).optional(),
  isFavorite: z.boolean().optional(),
});
const appFileResultSchema = z.strictObject({
  key: z.string().min(1),
  name: z.string().min(1),
  extension: z.enum(FILE_EXTENSIONS).optional(),
  folderKey: z.string().min(1).optional(),
  sizeBytes: z.number().optional(),
  processing: z.enum(["pending", "ready", "failed"]).optional(),
  isFavorite: z.boolean().optional(),
});

export async function searchContent(query: string, folderKey?: string): Promise<ContentSearchResponse> {
  const output = await searchApp({
    ...(query ? { query } : { operation: "list" as const }),
    collectionSlugs: ["folders", "files"],
    recordHistory: Boolean(query),
    limit: 50,
    ...(folderKey ? { folderKey } : {}),
  });
  const folders = appSearchResults(output, "folders", appFolderResultSchema).map((folder) => ({
    key: folder.key,
    scopeKey: getContentContext().scopeKey,
    parentFolderKey: folder.parentFolderKey,
    name: folder.name,
    isFavorite: folder.isFavorite,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    score: 0,
  }));
  const files = appSearchResults(output, "files", appFileResultSchema).map((file) => ({
    fileKey: file.key,
    name: file.name,
    extension: file.extension,
    isFavorite: Boolean(file.isFavorite),
    score: 0,
    folderKey: file.folderKey,
  }));
  return { query: output.query ?? query, folders, files, cached: false };
}

export function searchContentMatches(query: string, _signal?: AbortSignal, folderKey?: string) {
  return searchContent(query, folderKey);
}

export async function listContentSearchHistory(_requestContext = getContentContext()): Promise<ContentSearchHistoryItem[]> {
  return [];
}

export async function deleteContentSearchHistory(_normalizedQuery: string) {
  return { deleted: true };
}
