import { apiClient } from "./api-client";
import * as Crypto from "expo-crypto";
import { useAuthStore } from "@/state/auth";
import type { AssistantChange } from "./assistant-changes";
import {
  planContentSelectionDelete,
  planContentSelectionCopy,
  planContentSelectionFavorite,
  planContentSelectionMove,
  type ContentSelection,
  type ContentSelectionOperation,
  type ContentSelectionPlan,
} from "./content-selection-plans";

export type { ContentSelection } from "./content-selection-plans";

export type ContentContext = {
  organizationKey: string;
  scopeKey: string;
  userKey?: string;
};

export type ContentFolder = {
  key: string;
  parentFolderKey?: string;
  name: string;
  description?: string;
  coverUrl?: string;
  isFavorite?: boolean;
};

export type ContentDocument = {
  key: string;
  name: string;
  folderKey?: string;
  extension?: string;
  mimeType?: string;
  sizeBytes?: number;
  sourceImageCount?: number;
  currentVersionKey?: string | null;
  isFavorite: boolean;
  updatedAt: string;
};

export type ContentNeighbors = {
  folders: ContentFolder[];
  documents: ContentDocument[];
  files: ContentDocument[];
};

export type ContentDocumentSourceImage = { page: number; url: string };

export type ContentDocumentVersion = {
  key: string;
  documentKey: string;
  version: number;
  type?: "enhancement" | "translation";
  label?: string;
  createdAt: string;
  content?: string;
};

export type ContentDocumentAudioVersion = {
  key: string;
  documentKey: string;
  version: number;
  sourceContentHash: string;
  sourceTitle: string;
  sourceDocumentUpdatedAt: string;
  mimeType: "audio/mpeg";
  sizeBytes: number;
  durationMs: number;
  isCurrent: boolean;
  playbackPositionMs: number;
  voice?: string;
  language?: string;
  speakingRate?: number;
  includeTitle: boolean;
  includeCode: boolean;
  createdAt: string;
  current: boolean;
  url: string;
};

export type ContentDocumentSummaryAudio = {
  key: string;
  summaryKey: string;
  mimeType: "audio/mpeg";
  sizeBytes: number;
  durationMs: number;
  voice?: string;
  language?: string;
  createdAt: string;
  url: string;
};

export type ContentDocumentSummary = {
  key: string;
  documentKey: string;
  version: number;
  summary: string;
  topic?: string;
  style: "brief" | "detailed" | "executive" | "bullet-points" | "technical";
  language?: string;
  sourceContentHash: string;
  sourceTitle: string;
  sourceDocumentUpdatedAt: string;
  createdAt: string;
  audio?: ContentDocumentSummaryAudio;
};

export type ContentSearchDocument = {
  documentKey: string;
  name: string;
  extension?: ContentDocument["extension"];
  isFavorite: boolean;
  score: number;
  summary?: string;
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
  usageCount: number;
};

export type ContentDocumentDownload = {
  documentKey: string;
  format: "original" | "html" | "txt";
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
  | { success: false; error: { message: string; code?: string; action?: string } };

type ContentBatchToolResult = {
  success: boolean;
  data?: { document?: ContentDocument; folder?: ContentFolder; folderCount?: number; documentCount?: number };
  error?: { message: string; code?: string; action?: string };
};

export type ContentBatchFailure = ContentSelectionOperation & { tool: string; message: string; code?: string; action?: string };

export type ContentBatchOutcome = {
  folders: ContentFolder[];
  documents: ContentDocument[];
  copiedFolders: { folder: ContentFolder; folderCount: number; documentCount: number }[];
  failures: ContentBatchFailure[];
  requested: number;
  succeeded: number;
  failed: number;
};

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

async function executeContentSelectionPlan(plan: ContentSelectionPlan): Promise<ContentBatchOutcome> {
  const callOutcomes = await Promise.all(plan.calls.map(async (call) => {
    const folders: ContentFolder[] = [];
    const documents: ContentDocument[] = [];
    const copiedFolders: ContentBatchOutcome["copiedFolders"] = [];
    const failures: ContentBatchFailure[] = [];
    try {
      const data = await callContentTool<{ results: ContentBatchToolResult[] }>(call.tool, call.input);
      call.operations.forEach((operation, index) => {
        const result = data.results[index];
        if (!result?.success || !result.data) {
          failures.push({ ...operation, tool: call.tool, message: result?.error?.message ?? "The Archive operation failed.", ...(result?.error?.code ? { code: result.error.code } : {}), ...(result?.error?.action ? { action: result.error.action } : {}) });
          return;
        }
        if (result.data.document) documents.push(result.data.document);
        if (result.data.folder) {
          folders.push(result.data.folder);
          if (call.tool === "folder.copy") copiedFolders.push({ folder: result.data.folder, folderCount: result.data.folderCount ?? 1, documentCount: result.data.documentCount ?? 0 });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The Archive operation failed.";
      const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : undefined;
      const action = typeof (error as { action?: unknown })?.action === "string" ? (error as { action: string }).action : undefined;
      failures.push(...call.operations.map((operation) => ({ ...operation, tool: call.tool, message, ...(code ? { code } : {}), ...(action ? { action } : {}) })));
    }
    return { folders, documents, copiedFolders, failures };
  }));
  const outcome: ContentBatchOutcome = {
    folders: callOutcomes.flatMap(({ folders }) => folders),
    documents: callOutcomes.flatMap(({ documents }) => documents),
    copiedFolders: callOutcomes.flatMap(({ copiedFolders }) => copiedFolders),
    failures: callOutcomes.flatMap(({ failures }) => failures),
    requested: plan.operationCount,
    succeeded: 0,
    failed: 0,
  };
  outcome.failed = outcome.failures.length;
  outcome.succeeded = outcome.requested - outcome.failed;
  return outcome;
}

function singleBatchRecord<T>(outcome: ContentBatchOutcome, records: T[], fallback: string) {
  if (outcome.failures[0]) throw new Error(outcome.failures[0].message);
  const record = records[0];
  if (!record) throw new Error(fallback);
  return record;
}

export function getContentContext(): ContentContext {
  const state = useAuthStore.getState();
  return {
    organizationKey: recordKey(state.organization),
    scopeKey: recordKey(state.scope),
    userKey: state.user?.key ?? "",
  };
}

export function isContentContextConfigured(context: ContentContext) {
  return [context.organizationKey, context.scopeKey].every((value) => value.trim().length > 0);
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
  const filename = name.trim() || "Document";
  if (/\.(?:txt|md|pdf|doc|docx)$/i.test(filename)) return filename;
  const extension = mimeType === "text/plain" ? "txt"
    : mimeType === "text/markdown" ? "md"
      : mimeType === "application/pdf" ? "pdf"
        : mimeType === "application/msword" ? "doc"
          : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx"
            : undefined;
  return extension ? `${filename}.${extension}` : filename;
}

function contentToolError(error: { message: string; code?: string; action?: string }) {
  return Object.assign(new Error(error.message), error.code ? { code: error.code } : {}, error.action ? { action: error.action } : {});
}

async function callContentTool<T>(tool: string, input: Record<string, unknown>, signal?: AbortSignal, requestContext = getContentContext()): Promise<T> {
  const contentContext = requestContext;
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<T>>(`/api/v1/content/tools/${tool}`, {
      organizationKey: contentContext.organizationKey,
      scopeKey: contentContext.scopeKey,
      input,
    }, { signal, timeout: tool === "document.summary.audio.generate" || tool === "document.read" && input.persistAudio === true ? 15 * 60_000 : tool === "document.parse" || tool === "document.scan" ? 5 * 60_000 : tool === "document.summarize" || tool === "document.topics" ? 4 * 60_000 : 60_000 });
    if (!response.data.success) throw contentToolError(response.data.error);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ToolResponse<T> } }).response?.data;
    if (failure && !failure.success) throw contentToolError(failure.error);
    throw error;
  }
}

export async function enhanceContentDocument(documentKey: string, instruction?: string, mode: "preview" | "replace" = "preview") {
  const data = await callContentTool<{
    results: { success: boolean; data?: { text: string; persistedDocumentKey?: string }; error?: { message: string } }[];
  }>("document.enhance", {
    documentKeys: [documentKey],
    instruction,
    mode,
    ...(mode === "replace" ? { idempotencyKey: createContentMutationKey() } : {}),
  });
  const result = data.results[0];
  if (!result?.success || !result.data || mode === "replace" && result.data.persistedDocumentKey !== documentKey) throw new Error(result?.error?.message ?? "The document could not be enhanced.");
  return result.data;
}

export async function askPersonalAssistant(message: string, currentNote: { documentKey?: string; title: string; content: string; selection?: { start: number; end: number } }, folderKey?: string, signal?: AbortSignal) {
  const contentContext = getContentContext();
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  try {
    const response = await apiClient.post<ToolResponse<PersonalAssistantResponse>>("/api/v1/assistant/respond", {
      organizationKey: contentContext.organizationKey,
      scopeKey: contentContext.scopeKey,
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

export async function translateContentDocument(documentKey: string, targetLanguage: string, instruction?: string, mode: "preview" | "replace" = "replace") {
  const data = await callContentTool<{
    results: { success: boolean; data?: { text: string; persistedDocumentKey?: string }; error?: { message: string } }[];
  }>("document.translate", {
    documentKeys: [documentKey],
    targetLanguage,
    instruction,
    preserveFormatting: true,
    mode,
    ...(mode === "replace" ? { idempotencyKey: createContentMutationKey() } : {}),
  });
  const result = data.results[0];
  if (!result?.success || !result.data || mode === "replace" && result.data.persistedDocumentKey !== documentKey) throw new Error(result?.error?.message ?? "The note could not be translated.");
  return result.data;
}

export async function createContentDocumentVersion(documentKey: string, label: string, content?: string, type?: ContentDocumentVersion["type"]) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { version: ContentDocumentVersion }; error?: { message: string } }[];
  }>("document.create-version", { documentKeys: [documentKey], labels: { [documentKey]: label }, ...(content ? { contents: { [documentKey]: content } } : {}), ...(type ? { types: { [documentKey]: type } } : {}), idempotencyKey: createContentMutationKey() });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The document version could not be created.");
  return result.data.version;
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

export async function listContentDocumentAudioVersions(documentKey: string) {
  const versions: ContentDocumentAudioVersion[] = [];
  let cursor: string | undefined;
  do {
    const data = await callContentTool<{
      results: { success: boolean; data?: { audioVersions: ContentDocumentAudioVersion[]; cursor?: string }; error?: { message: string } }[];
    }>("document.list-audio-versions", { documentKeys: [documentKey], cursor, limit: 100 });
    const result = data.results[0];
    if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Audio versions could not be loaded.");
    versions.push(...result.data.audioVersions);
    cursor = result.data.cursor;
  } while (cursor);
  return versions;
}

export async function updateContentDocumentAudioPlayback(audioVersionKey: string, playbackPositionMs: number) {
  return callContentTool<{ audioVersionKey: string; documentKey: string; playbackPositionMs: number }>("document.audio.playback.update", {
    audioVersionKey,
    playbackPositionMs,
    idempotencyKey: createContentMutationKey(),
  });
}

export async function clearContentDocumentAudioPlayback(documentKey: string) {
  return callContentTool<{ documentKey: string }>("document.audio.playback.clear", {
    documentKey,
    idempotencyKey: createContentMutationKey(),
  });
}

export async function listContentDocumentSummaries(documentKey: string) {
  const summaries: ContentDocumentSummary[] = [];
  let cursor: string | undefined;
  do {
    const data = await callContentTool<{
      results: { success: boolean; data?: { summaries: ContentDocumentSummary[]; cursor?: string }; error?: { message: string } }[];
    }>("document.list-summaries", { documentKeys: [documentKey], cursor, limit: 100 });
    const result = data.results[0];
    if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Summary versions could not be loaded.");
    summaries.push(...result.data.summaries);
    cursor = result.data.cursor;
  } while (cursor);
  return summaries;
}

export async function findContentDocumentSummary(summaryKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { summary: ContentDocumentSummary }; error?: { message: string } }[];
  }>("document.find-summary", { summaryKeys: [summaryKey] });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The summary could not be loaded.");
  return result.data.summary;
}

export async function generateContentDocumentAudio(documentKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { audioVersion: Omit<ContentDocumentAudioVersion, "current" | "url"> }; error?: { message: string } }[];
  }>("document.read", { documentKeys: [documentKey], mode: "audio", persistAudio: true, voice: "Matthew", idempotencyKey: createContentMutationKey() });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Document audio could not be generated.");
  return result.data.audioVersion;
}

export async function generateContentDocumentSummaryAudio(summaryKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { audio: ContentDocumentSummaryAudio }; error?: { message: string } }[];
  }>("document.summary.audio.generate", { summaryKeys: [summaryKey], voice: "Matthew", idempotencyKey: createContentMutationKey() });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "Summary audio could not be generated.");
  return result.data.audio;
}

export async function findContentDocumentVersion(versionKey: string) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { version: ContentDocumentVersion }; error?: { message: string } }[];
  }>("document.find-version", { versionKeys: [versionKey], include: ["content"] });
  const result = data.results[0];
  if (!result?.success || !result.data?.version.content) throw new Error(result?.error?.message ?? "The version could not be loaded.");
  return result.data.version;
}

export async function restoreContentDocumentVersion(documentKey: string, versionKey: string, createBackupVersion = true) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument }; error?: { message: string } }[];
  }>("document.restore-version", {
    restores: [{ documentKey, versionKey, createBackupVersion }],
    idempotencyKey: createContentMutationKey(),
  });
  const result = data.results[0];
  if (!result?.success || !result.data) throw new Error(result?.error?.message ?? "The version could not be restored.");
  return result.data.document;
}

export async function listContentFolderTree(signal?: AbortSignal, contentContext = getContentContext()) {
  const folders: ContentFolder[] = [];
  let cursor: string | undefined;
  do {
    const data: { folders: ContentFolder[]; cursor?: string } = await callContentTool("folder.list", {
      scopeKey: contentContext.scopeKey,
      includeDescendants: true,
      cursor,
      limit: 100,
      sort: { field: "name", direction: "asc" },
    }, signal, contentContext);
    folders.push(...data.folders);
    cursor = data.cursor;
  } while (cursor);
  return folders;
}

export async function listContentDocumentsAtLocation(folderKey?: string, signal?: AbortSignal, contentContext = getContentContext()) {
  const documents: ContentDocument[] = [];
  let cursor: string | undefined;
  do {
    const data: { documents: ContentDocument[]; cursor?: string } = await callContentTool("document.list", {
      scopeKey: contentContext.scopeKey,
      ...(folderKey ? { folderKey } : {}),
      cursor,
      limit: 100,
      sort: { field: "updatedAt", direction: "desc" },
    }, signal, contentContext);
    documents.push(...data.documents);
    cursor = data.cursor;
  } while (cursor);
  return documents;
}

export async function listContentLocation(folderKey?: string) {
  const [tree, documents] = await Promise.all([listContentFolderTree(), listContentDocumentsAtLocation(folderKey)]);
  return { folders: tree.filter((folder) => folder.parentFolderKey === folderKey), documents };
}

export async function loadInitialContentLocation() {
  const [tree, rootDocuments] = await Promise.all([listContentFolderTree(), listContentDocumentsAtLocation()]);
  const root = { folders: tree.filter((folder) => !folder.parentFolderKey), documents: rootDocuments };
  const initialFolder = root.folders.find((folder) => folder.name === "My Documents");
  if (!initialFolder) return { root, location: root };
  const documents = await listContentDocumentsAtLocation(initialFolder.key);
  return { root, location: { folders: tree.filter((folder) => folder.parentFolderKey === initialFolder.key), documents }, initialFolder };
}

export async function readContentDocument(documentKey: string, contentContext = getContentContext()) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { document: ContentDocument & { content?: string } }; error?: { message: string } }[];
  }>("document.find", { documentKeys: [documentKey], include: ["content"] }, undefined, contentContext);
  const result = data.results[0];
  const document = result?.data?.document;
  if (!result?.success || !document || document.content === undefined) throw new Error(result?.error?.message ?? "The document could not be opened.");
  return { ...document, content: document.content };
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
    content,
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
  const outcome = await setContentSelectionFavorite({ folderKeys: [], documentKeys: [documentKey] }, isFavorite);
  return singleBatchRecord(outcome, outcome.documents, "The favorite could not be updated.");
}

export async function moveContentDocument(documentKey: string, targetFolderKey?: string) {
  const outcome = await moveContentSelection({ folderKeys: [], documentKeys: [documentKey] }, targetFolderKey);
  return singleBatchRecord(outcome, outcome.documents, "The document could not be moved.");
}

export async function copyContentDocument(documentKey: string, targetFolderKey?: string) {
  const outcome = await copyContentSelection({ folderKeys: [], documentKeys: [documentKey] }, [targetFolderKey]);
  return singleBatchRecord(outcome, outcome.documents, "The document could not be copied.");
}

export async function deleteContentDocument(documentKey: string) {
  const outcome = await hardDeleteContentSelection({ folderKeys: [], documentKeys: [documentKey] });
  return singleBatchRecord(outcome, outcome.documents, "The document could not be deleted.");
}

export async function downloadContentDocument(documentKey: string, format: "original" | "html" | "txt" = "original") {
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
  const outcome = await moveContentSelection({ folderKeys: [folderKey], documentKeys: [] }, targetParentFolderKey);
  return singleBatchRecord(outcome, outcome.folders, "The folder could not be moved.");
}

export function setContentSelectionFavorite(selection: ContentSelection, isFavorite: boolean, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionFavorite(selection, isFavorite, idempotencyKey));
}

export function moveContentSelection(selection: ContentSelection, targetFolderKey?: string, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionMove(selection, getContentContext().scopeKey, targetFolderKey, idempotencyKey));
}

export function copyContentSelection(selection: ContentSelection, destinationFolderKeys: readonly (string | undefined)[], idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionCopy(selection, getContentContext().scopeKey, destinationFolderKeys, idempotencyKey));
}

export function hardDeleteContentSelection(selection: ContentSelection, idempotencyKey = createContentMutationKey()) {
  return executeContentSelectionPlan(planContentSelectionDelete(selection, idempotencyKey));
}

export async function setContentFolderFavorite(folderKey: string, isFavorite: boolean) {
  const outcome = await setContentSelectionFavorite({ folderKeys: [folderKey], documentKeys: [] }, isFavorite);
  return singleBatchRecord(outcome, outcome.folders, "The favorite could not be updated.");
}

export async function copyContentFolder(folderKey: string, targetParentFolderKey?: string) {
  const outcome = await copyContentSelection({ folderKeys: [folderKey], documentKeys: [] }, [targetParentFolderKey]);
  return singleBatchRecord(outcome, outcome.copiedFolders, "The folder could not be copied.");
}

export async function deleteContentFolder(folderKey: string) {
  const outcome = await hardDeleteContentSelection({ folderKeys: [folderKey], documentKeys: [] });
  return singleBatchRecord(outcome, outcome.folders, "The folder could not be deleted.");
}

export async function uploadContentDocument(file: { name: string; type: string; size: number; base64: string }, folderKey?: string, contentContext = getContentContext(), idempotencyKey = createContentMutationKey()) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  const mimeType = documentMimeType(file.name, file.type);
  const filename = documentFilename(file.name, mimeType);
  return callContentTool<{ document: ContentDocument }>("document.parse", {
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
}

export async function scanContentDocument(pages: { name: string; size: number; base64: string }[], folderKey?: string, contentContext = getContentContext(), name = `Scanned document ${new Date().toISOString().slice(0, 10)}`) {
  if (!isContentContextConfigured(contentContext)) throw new Error("Archive is unavailable for this session.");
  const contentDigest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pages.map((page) => page.base64).join("\0"));
  const idempotencyKey = `scan-${contentDigest}-${folderKey ?? "root"}`;
  return callContentTool<{ document: ContentDocument }>("document.scan", {
    scopeKey: contentContext.scopeKey,
    folderKey,
    name,
    pages: pages.map((page) => ({ filename: page.name, mimeType: "image/jpeg", sizeBytes: page.size, encoding: "base64", content: page.base64 })),
    idempotencyKey,
  }, undefined, contentContext);
}

export function searchContent(query: string, folderKey?: string, includeDescendants = false) {
  const contentContext = getContentContext();
  return callContentTool<ContentSearchResponse>("content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    minimumScore: 0.55,
    ...(folderKey ? { folderKey, includeDescendants } : {}),
  });
}

export async function searchContentMatches(query: string, signal?: AbortSignal, folderKey?: string, recordHistory = true) {
  const contentContext = getContentContext();
  return callContentTool<ContentSearchResponse>("content.search", {
    scopeKey: contentContext.scopeKey,
    query,
    includeSummaries: false,
    minimumScore: 0.55,
    ...(!recordHistory ? { recordHistory: false } : {}),
    ...(folderKey ? { folderKey, includeDescendants: true } : {}),
  }, signal);
}

export function findContentNeighbors(source: { folderKey: string } | { documentKey: string }, signal?: AbortSignal) {
  return callContentTool<ContentNeighbors>("content.neighbors", source, signal);
}

export async function getContentDocumentTopics(documentKey: string, signal?: AbortSignal) {
  const data = await callContentTool<{ documentKey: string; topics: string[] }>("document.topics", { documentKey }, signal);
  return data.topics;
}

export async function summarizeContentDocument(documentKey: string, topic: string, signal?: AbortSignal) {
  const data = await callContentTool<{
    results: { success: boolean; data?: { text: string; summary?: ContentDocumentSummary }; error?: { message: string } }[];
  }>("document.summarize", { documentKeys: [documentKey], topic, style: "brief", persist: true, idempotencyKey: createContentMutationKey() }, signal);
  const result = data.results[0];
  if (!result?.success || !result.data?.summary) throw new Error(result?.error?.message ?? "The document summary could not be created.");
  return result.data.summary;
}

export async function listContentSearchHistory(requestContext = getContentContext()) {
  const contentContext = requestContext;
  const data = await callContentTool<{ history: ContentSearchHistoryItem[] }>("content.search-history.list", {
    scopeKey: contentContext.scopeKey,
    allLocations: true,
    limit: 100,
  }, undefined, requestContext);
  return data.history;
}

export async function deleteContentSearchHistory(normalizedQuery: string) {
  const contentContext = getContentContext();
  return callContentTool<{ normalizedQuery: string; deleted: boolean }>("content.search-history.delete", {
    scopeKey: contentContext.scopeKey,
    normalizedQuery,
    allLocations: true,
    idempotencyKey: createContentMutationKey(),
  });
}
