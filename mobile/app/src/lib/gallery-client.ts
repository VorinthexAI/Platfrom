import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/state/auth";

export type GalleryCollection = {
  key: string;
  name: string;
  description: string | null;
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

export function fetchGalleryOverview(collectionKey?: string) {
  return postGallery<GalleryOverview>("/gallery/overview", collectionKey ? { collectionKey } : {});
}

export function createGalleryCollection(name: string) {
  return postGallery<GalleryCollection>("/gallery/collections", { name });
}

export type PreparedGalleryUpload = {
  clientKey: string;
  filename: string;
  uri: string;
  sizeBytes: number;
};

export async function uploadGalleryImages(files: PreparedGalleryUpload[], collectionKey?: string) {
  const reservation = await postGallery<{
    uploads: { clientKey: string; uploadKey: string; imageKey: string; url: string; headers: Record<string, string> }[];
  }>("/gallery/uploads/presign", {
    collectionKey: collectionKey ?? null,
    files: files.map(({ clientKey, filename, sizeBytes }) => ({ clientKey, filename, sizeBytes })),
  });

  for (let index = 0; index < reservation.uploads.length; index += 3) {
    await Promise.all(reservation.uploads.slice(index, index + 3).map(async (upload) => {
      const file = files.find((candidate) => candidate.clientKey === upload.clientKey);
      if (!file) throw new Error("An upload reservation could not be matched.");
      const blob = await (await fetch(file.uri)).blob();
      const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: blob });
      if (!response.ok) throw new Error(`Image upload failed (${response.status}).`);
    }));
  }

  return postGallery<{ jobs: { key: string; imageKey: string; status: string }[] }>(
    "/gallery/uploads/complete",
    { uploadKeys: reservation.uploads.map(({ uploadKey }) => uploadKey) },
  );
}

export function fetchGalleryUploadStatus(uploadKeys: string[]) {
  return postGallery<{ jobs: { key: string; imageKey: string; status: string; errorCode: string | null }[] }>(
    "/gallery/uploads/status",
    { uploadKeys },
  );
}

export function searchGalleryImages(input: { query?: string; imageKey?: string; limit?: number }) {
  return postGallery<{ images: GalleryImage[] }>("/gallery/images/search", input, 4 * 60_000);
}

export async function askGalleryAssistant(message: string) {
  const state = useAuthStore.getState();
  const context = getGalleryContext();
  const agentKey = state.contentExecution?.agentKey ?? "";
  if (!agentKey) throw new Error("Your personal assistant is unavailable for this session.");
  const response = await apiClient.post<ApiResponse<{ type: "answer" | "note"; message: string }>>(
    "/assistant/respond",
    { ...context, agentKey, input: { surface: "media-workspace", message, currentNote: { title: "", content: "" } } },
    { timeout: 4 * 60_000 },
  );
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}
