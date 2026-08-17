import { apiClient } from "@/lib/api-client";
import type { AssistantChange } from "@/lib/assistant-changes";
import { useAuthStore } from "@/state/auth";

export type GalleryCollection = {
  key: string;
  name: string;
  description: string | null;
  isFavorite: boolean;
  count: number;
  coverUrl: string | null;
};

export type GalleryImage = {
  key: string;
  filename: string;
  caption: string;
  imageCaptionKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  score?: number;
};

export type GalleryOverview = {
  collections: GalleryCollection[];
  images: GalleryImage[];
  nextCursor: string | null;
};

export function filterCollections(collections: GalleryCollection[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return collections;
  return collections.filter(({ name, description }) => `${name}\n${description ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function filterMediaItems(items: GalleryImage[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter(({ caption, filename }) => {
    const searchable = `${caption}\n${filename}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function mergeMediaItems(primary: GalleryImage[], secondary: GalleryImage[]) {
  const unique = new Map(primary.map((item) => [item.key, item]));
  for (const item of secondary) if (!unique.has(item.key)) unique.set(item.key, item);
  return [...unique.values()];
}

export type GallerySubject = {
  key: string;
  name: string;
  description: string;
  referenceImageKey: string;
  referenceUrl: string;
  imageCount: number;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string } };

type GalleryContext = { organizationKey: string; scopeKey: string };

function recordKey(value: Record<string, unknown> | null) {
  return typeof value?.key === "string" ? value.key : "";
}

export function getGalleryContext(): GalleryContext {
  const state = useAuthStore.getState();
  const context = {
    organizationKey: recordKey(state.organization),
    scopeKey: recordKey(state.scope),
  };
  if (!context.organizationKey || !context.scopeKey) throw new Error("Gallery is unavailable for this session.");
  return context;
}

async function postGallery<T>(path: string, input: Record<string, unknown>, timeout = 60_000) {
  try {
    const response = await apiClient.post<ApiResponse<T>>(path, { ...getGalleryContext(), ...input }, { timeout });
    if (!response.data.success) throw new Error(response.data.error.message);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ApiResponse<T> } }).response?.data;
    if (failure && !failure.success) throw new Error(failure.error.message);
    throw error;
  }
}

async function fetchWithTimeout(input: string, init: RequestInit | undefined, timeout: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function fetchGalleryOverview(collectionKey?: string, cursor?: string, limit = 100) {
  return postGallery<GalleryOverview>("/gallery/overview", { ...(collectionKey ? { collectionKey } : {}), ...(cursor ? { cursor } : {}), limit });
}

export function createGalleryCollection(name: string, isFavorite: boolean) {
  return postGallery<GalleryCollection>("/gallery/collections", { name, isFavorite });
}

export function updateGalleryCollection(collectionKey: string, name: string, isFavorite: boolean) {
  return postGallery<{ collection: GalleryCollection }>("/gallery/collections/update", { collectionKey, name, isFavorite });
}

export function deleteGalleryCollection(collectionKey: string) {
  return postGallery<{ collectionKey: string }>("/gallery/collections/delete", { collectionKey });
}

export type PreparedGalleryUpload = {
  clientKey: string;
  filename: string;
  uri: string;
  sizeBytes: number;
  processingMode?: "library" | "cover";
};

export async function uploadGalleryImages(files: PreparedGalleryUpload[], collectionKey?: string) {
  const reservation = await postGallery<{
    uploads: { clientKey: string; uploadKey: string; imageKey: string; url: string; headers: Record<string, string> }[];
  }>("/gallery/uploads/presign", {
    collectionKey: collectionKey ?? null,
    files: files.map(({ clientKey, filename, sizeBytes, processingMode }) => ({ clientKey, filename, sizeBytes, ...(processingMode ? { processingMode } : {}) })),
  });

  for (let index = 0; index < reservation.uploads.length; index += 3) {
    await Promise.all(reservation.uploads.slice(index, index + 3).map(async (upload) => {
      const file = files.find((candidate) => candidate.clientKey === upload.clientKey);
      if (!file) throw new Error("An upload reservation could not be matched.");
      const bytes = await (await fetchWithTimeout(file.uri, undefined, 30_000)).arrayBuffer();
      const response = await fetchWithTimeout(upload.url, { method: "PUT", headers: upload.headers, body: bytes }, 2 * 60_000);
      if (!response.ok) throw new Error(`Image upload failed (${response.status}).`);
    }));
  }

  const completed = await postGallery<{ jobs: { key: string; imageKey: string; status: string }[] }>(
    "/gallery/uploads/complete",
    { uploadKeys: reservation.uploads.map(({ uploadKey }) => uploadKey) },
  );
  return {
    jobs: completed.jobs.map((job) => {
      const upload = reservation.uploads.find(({ uploadKey }) => uploadKey === job.key);
      if (!upload) throw new Error("A completed image upload could not be matched.");
      return { ...job, clientKey: upload.clientKey };
    }),
  };
}

export function fetchGalleryUploadStatus(uploadKeys: string[], timeout = 60_000) {
  return postGallery<{ jobs: { key: string; imageKey: string; status: string; errorCode: string | null }[] }>(
    "/gallery/uploads/status",
    { uploadKeys },
    timeout,
  );
}

export function searchGalleryImages(input: { query?: string; imageKey?: string; identityKey?: string; duplicates?: true; collectionKey?: string; recordHistory?: boolean; limit?: number }) {
  return postGallery<{ images: GalleryImage[] }>("/gallery/images/search", input, 4 * 60_000);
}

export function setGalleryImageFavorite(imageKey: string, isFavorite: boolean) {
  return postGallery<{ image: GalleryImage }>("/gallery/images/favorite", { imageKey, isFavorite });
}

export function updateGalleryImage(imageKey: string, name: string, isFavorite: boolean) {
  return postGallery<{ image: GalleryImage }>("/gallery/images/update", { imageKey, name, isFavorite });
}

export function deleteGalleryImages(imageKeys: string[]) {
  return postGallery<{ deletedImageKeys: string[] }>("/gallery/images/delete", { imageKeys });
}

export function findGalleryCollectionDuplicates(collectionKey: string) {
  return searchGalleryImages({ duplicates: true, collectionKey });
}

export function deleteGalleryCollectionDuplicates(collectionKey: string, imageKeys: string[]) {
  return postGallery<{ removedImageKeys: string[]; deletedImageKeys: string[] }>("/gallery/collections/duplicates/delete", { collectionKey, imageKeys });
}

export function transferGalleryCollectionImages(input: { sourceCollectionKey: string; destinationCollectionKeys: string[]; imageKeys: string[]; mode: "copy" | "move" }) {
  return postGallery<{ mode: "copy" | "move"; imageKeys: string[]; destinationCollectionKeys: string[]; createdRelationCount: number }>("/gallery/collections/images/transfer", input);
}

export function listGallerySubjects(includeDeleted = false) {
  return postGallery<{ subjects: GallerySubject[] }>("/gallery/subjects/list", { includeDeleted });
}

export function createGallerySubject(name: string, imageKeys: string[]) {
  return postGallery<{ subject: GallerySubject }>("/gallery/subjects", { name, imageKeys }, 4 * 60_000);
}

export function listGallerySubjectImages(identityKey: string) {
  return postGallery<{ images: GalleryImage[] }>("/gallery/subjects/images", { identityKey });
}

export function deleteGallerySubject(identityKey: string) {
  return postGallery<{ subject: GallerySubject }>("/gallery/subjects/delete", { identityKey });
}

export function restoreGallerySubject(identityKey: string) {
  return postGallery<{ subject: GallerySubject }>("/gallery/subjects/restore", { identityKey });
}

export async function askGalleryAssistant(message: string) {
  const state = useAuthStore.getState();
  const { organizationKey } = getGalleryContext();
  const agentKey = state.contentExecution?.agentKey ?? "";
  if (!agentKey) throw new Error("Your personal assistant is unavailable for this session.");
  const response = await apiClient.post<ApiResponse<{ type: "answer" | "note" | "unsupported"; message: string; changes?: AssistantChange[] }>>(
    "/assistant/respond",
    { organizationKey, agentKey, input: { surface: "media-workspace", message, currentNote: { title: "", content: "" } } },
    { timeout: 4 * 60_000 },
  );
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}
