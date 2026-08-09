import { apiClient } from "./api-client";
import { useAuthStore } from "@/state/auth";

export type ContentContext = {
  organizationKey: string;
  agentKey: string;
  scopeKey: string;
};

export type ContentFolder = {
  key: string;
  name: string;
  description?: string;
};

export type ContentDocument = {
  key: string;
  name: string;
  updatedAt: string;
};

export type ContentDocumentVersion = {
  key: string;
  documentKey: string;
  version: number;
  label?: string;
  createdAt: string;
};

export type ContentSearchResponse = {
  query: string;
  cached: boolean;
  folders: (ContentFolder & { score: number })[];
  documents: {
    documentKey: string;
    name: string;
    score: number;
    summary: string;
  }[];
};

export type ContentSearchHistoryItem = {
  query: string;
  normalizedQuery: string;
  searchedAt: string;
};

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

async function callContentTool<T>(tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const contentContext = getContentContext();
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/api/v1/content/tools/${tool}`, {
      organizationKey: contentContext.organizationKey,
      agentKey: contentContext.agentKey,
      input,
    }, { signal, timeout: tool === "document.parse" ? 5 * 60_000 : tool === "autocomplete" ? 15_000 : 60_000 });
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

export async function readContentDocument(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument & { content?: string } } }[];
  }>("document.find", { documentKeys: [documentKey], include: ["content"] });
  const document = data.results[0]?.data?.document;
  if (!document || document.content === undefined) throw new Error("The note could not be opened.");
  return { ...document, content: document.content };
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

export async function saveContentDocument(documentKey: string, content: string, expectedUpdatedAt: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.update", {
    updates: [{ documentKey, content, createVersion: false, expectedUpdatedAt }],
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

export async function createContentFolder(name: string, parentFolderKey?: string) {
  const contentContext = getContentContext();
  const data = await callContentTool<{
    results: { success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }[];
  }>("folder.create", {
    folders: [{ scopeKey: contentContext.scopeKey, parentFolderKey, name }],
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The folder could not be created.");
  return result.data.folder;
}

export function uploadContentDocument(file: { name: string; type: string; size: number; base64: string }, folderKey?: string) {
  const contentContext = getContentContext();
  return callContentTool<{ document: ContentDocument }>("document.parse", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    file: {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      encoding: "base64",
      content: file.base64,
    },
    idempotencyKey: createContentMutationKey(),
  });
}

export function searchContent(query: string) {
  const contentContext = getContentContext();
  return callContentTool<ContentSearchResponse>("scope.content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    minimumScore: 0.55,
  });
}

export async function listContentSearchHistory() {
  const contentContext = getContentContext();
  const data = await callContentTool<{ history: ContentSearchHistoryItem[] }>("scope.content.search-history", {
    scopeKey: contentContext.scopeKey,
    limit: 8,
  });
  return data.history;
}
