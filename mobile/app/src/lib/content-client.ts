import { apiClient } from "./api-client";
import * as Crypto from "expo-crypto";
import { useAuthStore } from "@/state/auth";
import type { AssistantChange } from "./assistant-changes";

export type ContentContext = {
  organizationKey: string;
  agentKey: string;
  scopeKey: string;
};

export type ContentFolder = {
  key: string;
  parentFolderKey?: string;
  name: string;
  description?: string;
  coverUrl?: string;
};

export type ContentDocument = {
  key: string;
  name: string;
  folderKey?: string;
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceImageCount?: number;
  isFavorite: boolean;
  updatedAt: string;
};

export type ContentDocumentPreview = ContentDocument & {
  extension: string;
  blocks: import("@vorinthex/shared/ui/file-viewer").FileViewerBlock[];
};

export type ContentDocumentSourceImage = { page: number; url: string };

export type ContentDocumentVersion = {
  key: string;
  documentKey: string;
  version: number;
  label?: string;
  createdAt: string;
  content?: string;
};

export type ContentSearchDocument = {
  documentKey: string;
  name: string;
  extension?: ContentDocument["extension"];
  score: number;
  summary: string;
  scopeKey?: string;
  folderKey?: string;
};

export type ContentSearchMatch = Omit<ContentSearchDocument, "summary">;

export type ContentSearchResponse = {
  query: string;
  cached: boolean;
  folders: (ContentFolder & { score: number })[];
  documents: ContentSearchDocument[];
};

export type ContentSearchHistoryItem = {
  query: string;
  normalizedQuery: string;
  searchedAt: string;
  count: number;
  documents: ContentSearchDocument[];
};

export type ContentDocumentDownload = {
  documentKey: string;
  format: "original" | "txt";
  fileName: string;
  mimeType: string;
  encoding: "base64";
  content: string;
};

export type PersonalAssistantResponse =
  | { type: "answer"; message: string; sources: { documentKey: string; name: string }[]; changes?: AssistantChange[] }
  | { type: "note"; content: string; message: string; sources: { documentKey: string; name: string }[]; changes?: AssistantChange[] }
  | { type: "unsupported"; message: string; sources: []; changes?: AssistantChange[] };

type ToolResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string } };

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

export function getContentContext(): ContentContext {
  const state = useAuthStore.getState();
  return {
    organizationKey: recordKey(state.organization),
    agentKey: state.contentExecution?.agentKey ?? "",
    scopeKey: recordKey(state.scope),
  };
}

export function isContentContextConfigured(context: ContentContext) {
  return Object.values(context).every((value) => value.trim().length > 0);
}

export function createContentMutationKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function documentMimeType(name: string, reported: string) {
  const extension = name.toLowerCase().split(".").pop();
  const extensionMimeType = extension === "txt" ? "text/plain"
    : extension === "md" ? "text/markdown"
      : extension === "pdf" ? "application/pdf"
        : extension === "doc" ? "application/msword"
          : extension === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : undefined;
  if (extensionMimeType) return extensionMimeType;
  const normalized = reported.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (["application/x-pdf", "application/acrobat", "applications/vnd.pdf", "com.adobe.pdf"].includes(normalized)) return "application/pdf";
  return normalized || "application/octet-stream";
}

function documentFilename(name: string, mimeType: string) {
  const normalized = name.trim() || "Document";
  if (/\.(?:txt|md|pdf|doc|docx)$/i.test(normalized)) return normalized;
  const extension = mimeType === "application/pdf" ? "pdf"
    : mimeType === "text/plain" ? "txt"
      : mimeType === "text/markdown" ? "md"
        : mimeType === "application/msword" ? "doc"
          : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx"
            : undefined;
  return extension ? `${normalized}.${extension}` : normalized;
}

const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function callContentTool<T>(tool: string, input: Record<string, unknown>, signal?: AbortSignal, requestContext = getContentContext()): Promise<T> {
  const contentContext = requestContext;
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/api/v1/content/tools/${tool}`, {
      organizationKey: contentContext.organizationKey,
      agentKey: contentContext.agentKey,
      input,
    }, { signal, timeout: tool === "document.parse" || tool === "document.scan" ? 5 * 60_000 : tool === "autocomplete" ? 15_000 : 60_000 });
    if (!response.data.success) throw new Error(response.data.error.message);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ToolResponse<T> } }).response?.data;
    if (failure && !failure.success) throw new Error(failure.error.message);
    throw error;
  }
}

export function autocompleteContent(context: string, wordCount: number, signal?: AbortSignal) {
  return callContentTool<{ completion: string }>("autocomplete", { context, wordCount }, signal);
}

export function enhanceContent(content: string, signal?: AbortSignal) {
  return callContentTool<{ content: string }>("enhance", { content }, signal);
}

export async function askPersonalAssistant(message: string, currentNote: { documentKey?: string; title: string; content: string; selection?: { start: number; end: number } }, folderKey?: string, signal?: AbortSignal) {
  const contentContext = getContentContext();
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<PersonalAssistantResponse>>("/api/v1/assistant/respond", {
      organizationKey: contentContext.organizationKey,
      agentKey: contentContext.agentKey,
      input: { surface: "knowledge-workspace", message, currentNote, requestKey: createContentMutationKey(), ...(folderKey ? { folderKey } : {}) },
    }, { signal, timeout: 4 * 60_000 });
    if (!response.data.success) throw new Error(response.data.error.message);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ToolResponse<PersonalAssistantResponse> } }).response?.data;
    if (failure && !failure.success) throw new Error(failure.error.message);
    throw error;
  }
}

export async function translateContentDocument(documentKey: string, targetLanguage: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { text: string; persistedDocumentKey?: string }; error?: { message: string } }[];
  }>("document.translate", {
    documentKeys: [documentKey],
    targetLanguage,
    preserveFormatting: true,
    mode: "replace",
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || result.data?.persistedDocumentKey !== documentKey) throw new Error(result?.error?.message ?? "The note could not be translated.");
  return result.data;
}

export async function listContentDocumentVersions(documentKey: string) {
  const versions: ContentDocumentVersion[] = [];
  let cursor: string | undefined;
  do {
    const data = await callContentTool<{
      results: { success: boolean; data?: { versions: ContentDocumentVersion[]; cursor?: string }; error?: { message: string } }[];
    }>("document.list-versions", { documentKeys: [documentKey], cursor, limit: 100 });
    const result = data.results[0];
    if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Version history could not be loaded.");
    versions.push(...result.data.versions);
    cursor = result.data.cursor;
  } while (cursor);
  return versions;
}

export async function findContentDocumentVersion(versionKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { version: ContentDocumentVersion }; error?: { message: string } }[];
  }>("document.find-version", { versionKeys: [versionKey], include: ["content"] });
  const result = data.results[0];
  if (!result?.success || !result.data?.version.content) throw new Error(result?.error?.message ?? "The version could not be loaded.");
  return result.data.version;
}

export async function restoreContentDocumentVersion(documentKey: string, versionKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.restore-version", {
    restores: [{ documentKey, versionKey, createBackupVersion: true }],
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The version could not be restored.");
  return result.data.document;
}

export async function listContentLocation(folderKey?: string) {
  const contentContext = getContentContext();
  const location = folderKey ? { folderKey } : {};
  const listFolders = async () => {
    const folders: ContentFolder[] = [];
    let cursor: string | undefined;
    do {
      const data: { folders: ContentFolder[]; cursor?: string } = await callContentTool("folder.list", {
        scopeKey: contentContext.scopeKey,
        parentFolderKey: folderKey,
        cursor,
        limit: 100,
        sort: { field: "name", direction: "asc" },
      });
      folders.push(...data.folders);
      cursor = data.cursor;
    } while (cursor);
    return folders;
  };
  const listDocuments = async () => {
    const documents: ContentDocument[] = [];
    let cursor: string | undefined;
    do {
      const data: { documents: ContentDocument[]; cursor?: string } = await callContentTool("document.list", {
        scopeKey: contentContext.scopeKey,
        ...location,
        cursor,
        limit: 100,
        sort: { field: "updatedAt", direction: "desc" },
      });
      documents.push(...data.documents);
      cursor = data.cursor;
    } while (cursor);
    return documents;
  };
  const [folders, documents] = await Promise.all([listFolders(), listDocuments()]);
  return { folders, documents };
}

export async function loadInitialContentLocation() {
  const root = await listContentLocation();
  const initialFolder = root.folders.find((folder) => folder.name === "My Documents");
  if (!initialFolder) return { root, location: root };
  return { root, location: await listContentLocation(initialFolder.key), initialFolder };
}

export async function readContentDocument(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument & { content?: string } }; error?: { message: string } }[];
  }>("document.find", { documentKeys: [documentKey], include: ["content"] });
  const result = data.results[0];
  const document = result?.data?.document;
  if (!result?.success || !document || document.content === undefined) throw new Error(result?.error?.message ?? "The document could not be opened.");
  return { ...document, content: document.content };
}

export async function readContentDocumentPreview(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument & { blocks?: ContentDocumentPreview["blocks"] } }; error?: { message: string } }[];
  }>("document.find", { documentKeys: [documentKey], include: ["blocks"] });
  const result = data.results[0];
  const document = result?.data?.document;
  if (!result?.success || !document || document.blocks === undefined) throw new Error(result?.error?.message ?? "The file could not be opened.");
  if (!document.extension) throw new Error("Notes open in the document editor, not the file viewer.");
  return { ...document, extension: document.extension, blocks: document.blocks };
}

export async function readContentDocumentSources(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument & { sourceImages?: ContentDocumentSourceImage[] } }; error?: { message: string } }[];
  }>("document.find", { documentKeys: [documentKey], include: ["sourceImages"] });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The scanned pages could not be opened.");
  return result.data.document.sourceImages ?? [];
}

export async function createContentDocument(name: string, content: string, folderKey?: string, mutationKey = createContentMutationKey()) {
  const contentContext = getContentContext();
  const data = await callContentTool<{ document: ContentDocument }>("document.create", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    name,
    representation: { content },
    idempotencyKey: mutationKey,
  });
  return data.document;
}

export async function saveContentDocument(documentKey: string, content: string, expectedUpdatedAt: string, createVersion = false) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.update", {
    updates: [{ documentKey, content, createVersion, expectedUpdatedAt }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The note could not be saved.");
  return result.data.document;
}

export async function renameContentDocument(documentKey: string, name: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.rename", {
    renames: [{ documentKey, name }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The note could not be renamed.");
  return result.data.document;
}

export async function setContentDocumentFavorite(documentKey: string, isFavorite: boolean) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.update", {
    updates: [{ documentKey, isFavorite }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The favorite could not be updated.");
  return result.data.document;
}

export async function moveContentDocument(documentKey: string, targetFolderKey?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.move", {
    moves: [{ documentKey, targetScopeKey: contentContext.scopeKey, ...(targetFolderKey ? { targetFolderKey } : {}) }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The document could not be moved.");
  return result.data.document;
}

export async function copyContentDocument(documentKey: string, targetFolderKey?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.copy", {
    copies: [{
      documentKey,
      targetScopeKey: contentContext.scopeKey,
      ...(targetFolderKey ? { targetFolderKey } : {}),
      includeVersions: false,
      includeShares: false,
    }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The document could not be copied.");
  return result.data.document;
}

export async function archiveContentDocument(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.archive", { documentKeys: [documentKey], atomic: false, idempotencyKey: createContentMutationKey() });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The document could not be deleted.");
  return result.data.document;
}

export async function downloadContentDocument(documentKey: string, format: "original" | "txt" = "original") {
  const data = await callContentTool<{
    results: { success: boolean; data?: ContentDocumentDownload; error?: { message: string } }[];
  }>("document.download", { documentKeys: [documentKey], format });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The original file could not be downloaded.");
  return result.data;
}

export async function createContentFolder(name: string, parentFolderKey?: string, description?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.create", {
    folders: [{ scopeKey: contentContext.scopeKey, parentFolderKey, name, ...(description ? { description } : {}) }],
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be created.");
  return result.data.folder;
}

export async function updateContentFolder(folderKey: string, name: string, description: string | null) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.update", {
    updates: [{ folderKey, name, description }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be updated.");
  return result.data.folder;
}

export async function setContentFolderCover(folderKey: string, coverImageKey: string | null) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.update", {
    updates: [{ folderKey, coverImageKey }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder cover could not be updated.");
  return result.data.folder;
}

export async function moveContentFolder(folderKey: string, targetParentFolderKey?: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.move", {
    moves: [{ folderKey, ...(targetParentFolderKey ? { targetParentFolderKey } : {}) }],
    atomic: false,
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be moved.");
  return result.data.folder;
}

export async function uploadContentDocument(file: { name: string; type: string; size: number; base64: string }, folderKey?: string, contentContext = getContentContext()) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  const mimeType = documentMimeType(file.name, file.type);
  const filename = documentFilename(file.name, mimeType);
  const [contentDigest, identityDigest] = await Promise.all([
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, file.base64),
    Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${filename}\0${mimeType}`),
  ]);
  const idempotencyKey = `upload-${contentDigest}-${identityDigest}-${folderKey ?? "root"}`;
  let data = await callContentTool<{ document: ContentDocument } | { job: { key: string; state: string } }>("document.parse", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    file: {
      filename,
      mimeType,
      sizeBytes: file.size,
      encoding: "base64",
      content: file.base64,
    },
    idempotencyKey,
  }, undefined, contentContext);
  const deadline = Date.now() + 30 * 60_000;
  let firstPoll = true;
  while (!("document" in data)) {
    if (Date.now() >= deadline) throw new Error("The upload is still processing. Retry the same file to reconnect.");
    if (!firstPoll) await wait(2_000);
    firstPoll = false;
    const response = await apiClient.post<ToolResponse<{ document: ContentDocument } | { job: { key: string; state: string } }>>(`/api/v1/content/document-jobs/${data.job.key}`, {
      organizationKey: contentContext.organizationKey,
      agentKey: contentContext.agentKey,
    }, { timeout: 30_000 });
    if (!response.data.success) throw new Error(response.data.error.message);
    data = response.data.data;
  }
  return data;
}

export async function scanContentDocument(pages: { name: string; size: number; base64: string }[], folderKey?: string, contentContext = getContentContext()) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  const contentDigest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pages.map((page) => page.base64).join("\0"));
  const idempotencyKey = `scan-${contentDigest}-${folderKey ?? "root"}`;
  let data = await callContentTool<{ document: ContentDocument } | { job: { key: string; state: string } }>("document.scan", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    name: `Scanned document ${new Date().toISOString().slice(0, 10)}`,
    pages: pages.map((page) => ({ filename: page.name, mimeType: "image/jpeg", sizeBytes: page.size, encoding: "base64", content: page.base64 })),
    idempotencyKey,
  }, undefined, contentContext);
  const deadline = Date.now() + 30 * 60_000;
  let firstPoll = true;
  while (!("document" in data)) {
    if (Date.now() >= deadline) throw new Error("The scan is still processing. Submit the same pages to reconnect.");
    if (!firstPoll) await wait(2_000);
    firstPoll = false;
    const response = await apiClient.post<ToolResponse<{ document: ContentDocument } | { job: { key: string; state: string } }>>(`/api/v1/content/document-jobs/${data.job.key}`, { organizationKey: contentContext.organizationKey, agentKey: contentContext.agentKey, tool: "document.scan" }, { timeout: 30_000 });
    if (!response.data.success) throw new Error(response.data.error.message);
    data = response.data.data;
  }
  return data;
}

export function searchContent(query: string, folderKey?: string, includeDescendants = false) {
  const contentContext = getContentContext();
  return callContentTool<ContentSearchResponse>("scope.content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    minimumScore: 0.55,
    ...(folderKey ? { folderKey, includeDescendants } : {}),
  });
}

export async function searchContentMatches(query: string, signal?: AbortSignal, folderKey?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{ query: string; results: ContentSearchMatch[] }>("scope.document.search", {
    scopeKey: contentContext.scopeKey,
    query,
    topK: 10,
    ...(folderKey ? { sources: [{ type: "folder", folderKeys: [folderKey], includeDescendants: true }] } : {}),
  }, signal);
  return data.results;
}

export async function summarizeContentDocument(documentKey: string, signal?: AbortSignal) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { text: string }; error?: { message: string } }[];
  }>("document.summarize", { documentKeys: [documentKey], style: "brief", persist: false }, signal);
  const result = data.results[0];
  if (!result?.success || !result.data?.text) throw new Error(result?.error?.message ?? "The document summary could not be created.");
  return result.data.text;
}

export async function listContentSearchHistory(folderKey?: string, includeDescendants = false) {
  const contentContext = getContentContext();
  const data = await callContentTool<{ history: ContentSearchHistoryItem[] }>("scope.content.search-history", {
    scopeKey: contentContext.scopeKey,
    ...(folderKey ? { folderKey, includeDescendants } : {}),
    limit: 8,
  });
  return data.history;
}
