import { apiClient } from "@vorinthex/shared/lib/api-client";

export type ContentContext = {
  organizationKey: string;
  agentKey: string;
  scopeKey: string;
};

export type ContentFolder = {
  key: string;
  scopeKey: string;
  parentFolderKey?: string;
  name: string;
  description?: string;
  childrenCount?: number;
  documentCount?: number;
};

export type ContentDocument = {
  key: string;
  scopeKey: string;
  folderKey?: string;
  name: string;
  extension?: string;
  updatedAt: string;
};

export type SearchResponse = {
  query: string;
  cached: boolean;
  folders: Array<ContentFolder & { score: number }>;
  documents: Array<{
    documentKey: string;
    scopeKey: string;
    folderKey?: string;
    name: string;
    score: number;
    summary: string;
  }>;
};

export type SearchHistoryItem = {
  query: string;
  normalizedQuery: string;
  searchedAt: string;
  count: number;
};

type ToolResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

export const contentContext: ContentContext = {
  organizationKey: process.env.NEXT_PUBLIC_CONTENT_ORGANIZATION_KEY ?? "",
  agentKey: process.env.NEXT_PUBLIC_CONTENT_AGENT_KEY ?? "",
  scopeKey: process.env.NEXT_PUBLIC_CONTENT_SCOPE_KEY ?? "",
};

export const hasContentContext = Object.values(contentContext).every(Boolean);

async function callContentTool<T>(tool: string, input: Record<string, unknown>): Promise<T> {
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/content/tools/${tool}`, {
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

export async function listLocation(folderKey?: string) {
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

export async function readDocument(documentKey: string) {
  const data = await callContentTool<{
    results: Array<{ success: boolean; data?: { document: ContentDocument & { content?: string } } }>;
  }>("document.find", { documentKeys: [documentKey], include: ["content"] });
  const result = data.results[0];
  if (!result?.success || !result.data?.document.content) throw new Error("Documentet kunde inte lasas.");
  return { ...result.data.document, content: result.data.document.content };
}

export async function createDocument(name: string, content: string, folderKey?: string) {
  const data = await callContentTool<{ document: ContentDocument }>("document.create", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    name,
    representation: { content },
    idempotencyKey: crypto.randomUUID(),
  });
  return data.document;
}

export async function saveDocument(documentKey: string, content: string, expectedUpdatedAt: string) {
  const data = await callContentTool<{
    results: Array<{ success: boolean; data?: { document: ContentDocument }; error?: { message: string } }>;
  }>("document.update", {
    updates: [{ documentKey, content, createVersion: false, expectedUpdatedAt }],
    atomic: false,
    idempotencyKey: crypto.randomUUID(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Dokumentet kunde inte sparas.");
  return result.data.document;
}

export async function renameDocument(documentKey: string, name: string) {
  const data = await callContentTool<{
    results: Array<{ success: boolean; data?: { document: ContentDocument }; error?: { message: string } }>;
  }>("document.rename", {
    renames: [{ documentKey, name }],
    atomic: false,
    idempotencyKey: crypto.randomUUID(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Dokumentet kunde inte byta namn.");
  return result.data.document;
}

export async function createFolder(name: string, parentFolderKey?: string) {
  const data = await callContentTool<{
    results: Array<{ success: boolean; data?: { folder: ContentFolder }; error?: { message: string } }>;
  }>("folder.create", {
    folders: [{ scopeKey: contentContext.scopeKey, parentFolderKey, name }],
    idempotencyKey: crypto.randomUUID(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Mappen kunde inte skapas.");
  return result.data.folder;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

export async function uploadDocument(file: File, folderKey?: string) {
  return callContentTool<{ document: ContentDocument }>("document.parse", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    file: {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      encoding: "base64",
      content: bytesToBase64(new Uint8Array(await file.arrayBuffer())),
    },
    idempotencyKey: crypto.randomUUID(),
  });
}

export function searchContent(query: string) {
  return callContentTool<SearchResponse>("scope.content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    minimumScore: 0.55,
  });
}

export async function listSearchHistory() {
  const data = await callContentTool<{ history: SearchHistoryItem[] }>("scope.content.search-history", {
    scopeKey: contentContext.scopeKey,
    limit: 12,
  });
  return data.history;
}
