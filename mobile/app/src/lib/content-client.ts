import { apiClient } from "./api-client";

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

export const contentContext: ContentContext = {
  organizationKey: process.env.EXPO_PUBLIC_CONTENT_ORGANIZATION_KEY ?? "",
  agentKey: process.env.EXPO_PUBLIC_CONTENT_AGENT_KEY ?? "",
  scopeKey: process.env.EXPO_PUBLIC_CONTENT_SCOPE_KEY ?? "",
};

export function isContentContextConfigured(context: ContentContext) {
  return Object.values(context).every((value) => value.trim().length > 0);
}

export const hasContentContext = isContentContextConfigured(contentContext);

export function createContentMutationKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function callContentTool<T>(tool: string, input: Record<string, unknown>): Promise<T> {
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/api/v1/content/tools/${tool}`, {
      organizationKey: contentContext.organizationKey,
      agentKey: contentContext.agentKey,
      input,
    });
    if (!response.data.success) throw new Error(response.data.error.message);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ToolResponse<T> } }).response?.data;
    if (failure && !failure.success) throw new Error(failure.error.message);
    throw error;
  }
}

export async function listContentLocation(folderKey?: string) {
  const location = folderKey ? { folderKey } : {};
  const [folderData, documentData] = await Promise.all([
    callContentTool<{ folders: ContentFolder[] }>("folder.list", {
      scopeKey: contentContext.scopeKey,
      parentFolderKey: folderKey,
      limit: 100,
      sort: { field: "name", direction: "asc" },
    }),
    callContentTool<{ documents: ContentDocument[] }>("document.list", {
      scopeKey: contentContext.scopeKey,
      ...location,
      limit: 100,
      sort: { field: "updatedAt", direction: "desc" },
    }),
  ]);
  return { folders: folderData.folders, documents: documentData.documents };
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
  return callContentTool<ContentSearchResponse>("scope.content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    minimumScore: 0.55,
  });
}

export async function listContentSearchHistory() {
  const data = await callContentTool<{ history: ContentSearchHistoryItem[] }>("scope.content.search-history", {
    scopeKey: contentContext.scopeKey,
    limit: 8,
  });
  return data.history;
}
