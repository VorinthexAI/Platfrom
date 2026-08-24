import { z } from "zod";

import { apiClient } from "@/lib/api-client";
import { appSearchResults, searchApp } from "@/lib/app-search-client";
import type { AssistantChange } from "@/lib/assistant-changes";
import { normalizeCollection, type CollectionRole } from "@/lib/collection-access";
import { useAuthStore } from "@/state/auth";

export type GalleryCollection = {
  key: string;
  name: string;
  description: string | null;
  purpose: "place-media" | null;
  mutationPolicy: "user" | "system-only";
  isFavorite: boolean;
  count: number;
  coverUrl: string | null;
  memberKey: string;
  isOwned?: boolean;
  role: GalleryCollectionRole;
  access: { canRead: boolean; canContribute: boolean; canManage: boolean };
  createdAt: string;
  updatedAt: string;
};

export type GalleryCollectionRole = CollectionRole;

export type GalleryCollectionMember = {
  key: string;
  memberKey: string;
  name: string;
  email: string | null;
  role: GalleryCollectionRole;
  joinedAt: string;
};

export type GalleryCollectionInvite = {
  key: string;
  recipient: string;
  role: Exclude<GalleryCollectionRole, "owner">;
  createdAt: string;
  collection: { key: string; name: string };
  inviterDisplayName: string;
  email?: string;
  inviteeKey?: string;
};

export type GalleryCollectionShareLink = {
  key: string;
  url: string;
  role: Exclude<GalleryCollectionRole, "owner">;
  active: boolean;
  createdAt: string;
};

export function filterGalleryShareLinks(links: GalleryCollectionShareLink[], active: boolean) {
  return links.filter((link) => link.active === active);
}

export type GalleryImage = {
  key: string;
  filename: string;
  caption: string;
  imageCaptionKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  locationSource: "exif" | "supplied" | "place" | null;
  mutationPolicy: "user" | "system-only";
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  url: string;
  score?: number;
  createdByKey?: string | null;
};

export type GalleryOverview = {
  collections: GalleryCollection[];
  images: GalleryImage[];
  nextCursor: string | null;
  canCreateCollections: boolean;
};

const galleryCollectionRoleSchema = z.enum(["owner", "collaborator", "viewer"]);
const galleryCollectionAccessSchema = z.strictObject({ canRead: z.boolean(), canContribute: z.boolean(), canManage: z.boolean() });
export const galleryCollectionSchema = z.strictObject({
  key: z.string().min(1), name: z.string().min(1), description: z.string().nullable(), purpose: z.enum(["place-media"]).nullable(), mutationPolicy: z.enum(["user", "system-only"]),
  isFavorite: z.boolean(), count: z.number().int().nonnegative(), coverUrl: z.string().min(1).nullable(), memberKey: z.string().min(1), isOwned: z.boolean().optional(),
  role: galleryCollectionRoleSchema, access: galleryCollectionAccessSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
});
export const galleryImageSchema = z.strictObject({
  key: z.string().min(1), filename: z.string().min(1), caption: z.string().min(1), imageCaptionKey: z.string().min(1).nullable(), mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(), city: z.string().min(1).nullable(), country: z.string().min(1).nullable(),
  countryCode: z.string().length(2).nullable(), latitude: z.number().finite().min(-90).max(90).nullable(), longitude: z.number().finite().min(-180).max(180).nullable(),
  locationSource: z.enum(["exif", "supplied", "place"]).nullable(), mutationPolicy: z.enum(["user", "system-only"]), isFavorite: z.boolean(),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), url: z.string().min(1), score: z.number().optional(), createdByKey: z.string().min(1).nullable(),
});
const galleryOverviewSchema = z.strictObject({ collections: z.array(galleryCollectionSchema), images: z.array(galleryImageSchema), nextCursor: z.string().nullable(), canCreateCollections: z.boolean() });

export type GalleryHighlight = {
  key: string;
  collectionKey: string;
  imageKeys: string[];
  images: GalleryImage[];
  createdByKey: string;
  title: string;
  slideCount: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type GalleryHighlightProjection = Omit<GalleryHighlight, "title" | "slideCount" | "coverUrl">;
export type GalleryHighlightSlide = { key: string; imageKey: string; url: string };
export type GalleryHighlightDetail = GalleryHighlight;

export type GalleryMemory = {
  key: string;
  imageKey: string;
  text: string;
  image: { key: string; url: string };
  createdByKey: string;
  createdAt: string;
  updatedAt: string;
};

export type GalleryMemoryDetail = GalleryMemory;

export function normalizeGalleryMemory(memory: GalleryMemory): GalleryMemory {
  return { ...memory, image: { ...memory.image } };
}

const galleryHighlightDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

function normalizeGalleryHighlight(highlight: GalleryHighlightProjection): GalleryHighlight {
  return {
    ...highlight,
    title: `Highlight ${galleryHighlightDateFormatter.format(new Date(highlight.createdAt))}`,
    slideCount: highlight.imageKeys.length,
    coverUrl: highlight.images[0]?.url ?? null,
  };
}

export function resolveGalleryHighlightSlides(highlight: GalleryHighlightDetail) {
  const images = new Map(highlight.images.map((image) => [image.key, image]));
  return highlight.imageKeys.flatMap((imageKey, index) => {
    const image = images.get(imageKey);
    return image ? [{ key: `${highlight.key}:${index}`, imageKey, url: image.url }] : [];
  });
}

export function isGalleryCollectionOwned(collection: Pick<GalleryCollection, "isOwned" | "role">) {
  return collection.isOwned ?? (collection.role === "owner");
}

export function isManagedGalleryCollection(collection: Pick<GalleryCollection, "purpose" | "mutationPolicy"> | undefined) {
  return collection?.purpose === "place-media" || collection?.mutationPolicy === "system-only";
}

export function isManagedGalleryImage(image: Pick<GalleryImage, "mutationPolicy"> | undefined) {
  return image?.mutationPolicy === "system-only";
}

export function mergeMediaItems(primary: GalleryImage[], secondary: GalleryImage[]) {
  const unique = new Map(primary.map((item) => [item.key, item]));
  for (const item of secondary) if (!unique.has(item.key)) unique.set(item.key, item);
  return [...unique.values()];
}

const galleryDateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

export function groupGalleryImagesByCreatedDate<T extends { createdAt: string }>(images: T[]) {
  const groups = new Map<string, T[]>();
  for (const image of images) {
    const label = galleryDateFormatter.format(new Date(image.createdAt));
    const group = groups.get(label);
    if (group) group.push(image);
    else groups.set(label, [image]);
  }
  return [...groups].map(([label, groupedImages]) => ({ label, images: groupedImages }));
}

export type GallerySubject = {
  key: string;
  name: string;
  description: string;
  referenceImageKey: string;
  referenceUrl: string;
  imageCount: number;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

export class GalleryClientError extends Error {
  code?: string;
  status?: number;

  constructor(message: string, code?: string, status?: number) {
    super(message);
    this.name = "GalleryClientError";
    this.code = code;
    this.status = status;
  }
}

export function isGalleryClientErrorCode(error: unknown, code: string) {
  return error instanceof GalleryClientError && error.code === code;
}

function galleryClientError(error: unknown, status?: number) {
  const value = error && typeof error === "object" ? error as { message?: unknown; code?: unknown } : undefined;
  const message = typeof value?.message === "string" && value.message.trim() ? value.message : "Gallery request failed.";
  return new GalleryClientError(message, typeof value?.code === "string" ? value.code : undefined, status);
}

export function isGalleryMemoryExhaustion(error: unknown) {
  return error instanceof GalleryClientError && (error.status === 409 || error.code?.includes("EXHAUST") === true);
}

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

export function getGalleryMemberKey() {
  const organization = useAuthStore.getState().organization;
  const value = organization?.membership_key ?? organization?.membershipKey;
  return typeof value === "string" ? value : "";
}

async function postGallery<T>(path: string, input: Record<string, unknown>, timeout = 60_000, signal?: AbortSignal) {
  try {
    const response = await apiClient.post<ApiResponse<T>>(path, { ...getGalleryContext(), ...input }, { signal, timeout });
    const payload = response.data as ApiResponse<T> | undefined;
    if (!payload || typeof payload !== "object" || payload.success !== true) throw galleryClientError(payload && "error" in payload ? payload.error : undefined);
    if (!("data" in payload)) throw galleryClientError(undefined);
    return payload.data;
  } catch (error) {
    const failure = (error as { response?: { data?: unknown } }).response?.data;
    if (failure && typeof failure === "object" && "success" in failure && failure.success === false) throw galleryClientError("error" in failure ? failure.error : undefined, (error as { response?: { status?: number } }).response?.status);
    throw error;
  }
}

export const GALLERY_COLLECTION_SHARING_ENDPOINTS = {
  members: "/gallery/collections/members",
  updateMember: "/gallery/collections/members/role",
  removeMember: "/gallery/collections/members/remove",
  invites: "/gallery/invites/pending",
  acceptInvite: "/gallery/invites/accept",
  rejectInvite: "/gallery/invites/reject",
  shareLinks: "/gallery/collections/shares/list",
  createShareLink: "/gallery/collections/shares",
  updateShareLink: "/gallery/collections/shares/update",
  leave: "/gallery/collections/leave",
  activateShare: "/gallery/shares/activate",
} as const;

export const GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS = {
  create: "/gallery/highlights",
  list: "/gallery/highlights",
  detail: "/gallery/highlights/read",
  delete: "/gallery/highlights/delete",
} as const;

export const GALLERY_COLLECTION_MEMORY_ENDPOINTS = {
  create: "/gallery/memories",
  list: "/gallery/memories",
  detail: "/gallery/memories/read",
  delete: "/gallery/memories/delete",
} as const;

export function createGalleryCollectionHighlight(collectionKey: string) {
  return postGallery<{ highlight: GalleryHighlightProjection }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.create, { collectionKey })
    .then(({ highlight }) => ({ highlight: normalizeGalleryHighlight(highlight) }));
}

export function listGalleryCollectionHighlights(collectionKey: string) {
  return apiClient.get<ApiResponse<{ highlights: GalleryHighlightProjection[] }>>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.list, { params: { ...getGalleryContext(), collectionKey }, timeout: 60_000 })
    .then(({ data }) => {
      if (!data || data.success !== true || !("data" in data)) throw galleryClientError(data && "error" in data ? data.error : undefined);
      return data.data;
    })
    .then(({ highlights }) => ({ highlights: highlights.map(normalizeGalleryHighlight) }));
}

export function fetchGalleryCollectionHighlight(highlightKey: string) {
  return postGallery<{ highlight: GalleryHighlightProjection }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.detail, { highlightKey })
    .then(({ highlight }) => ({ highlight: normalizeGalleryHighlight(highlight) }));
}

export function deleteGalleryCollectionHighlight(highlightKey: string) {
  return postGallery<{ highlightKey: string }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.delete, { highlightKey });
}

export function createGalleryCollectionMemory(collectionKey: string) {
  return postGallery<{ memory: GalleryMemory }>(GALLERY_COLLECTION_MEMORY_ENDPOINTS.create, { collectionKey })
    .then(({ memory }) => ({ memory: normalizeGalleryMemory(memory) }));
}

export function listGalleryCollectionMemories(collectionKey: string) {
  return apiClient.get<ApiResponse<{ memories: GalleryMemory[] }>>(GALLERY_COLLECTION_MEMORY_ENDPOINTS.list, { params: { ...getGalleryContext(), collectionKey }, timeout: 60_000 })
    .then(({ data }) => {
      if (!data || data.success !== true || !("data" in data)) throw galleryClientError(data && "error" in data ? data.error : undefined);
      return { memories: data.data.memories.map(normalizeGalleryMemory) };
    });
}

export function fetchGalleryCollectionMemory(memoryKey: string) {
  return postGallery<{ memory: GalleryMemory }>(GALLERY_COLLECTION_MEMORY_ENDPOINTS.detail, { memoryKey })
    .then(({ memory }) => ({ memory: normalizeGalleryMemory(memory) }));
}

export function deleteGalleryCollectionMemory(memoryKey: string, collectionKey: string) {
  return postGallery<{ memoryKey: string }>(GALLERY_COLLECTION_MEMORY_ENDPOINTS.delete, { memoryKey, collectionKey });
}

export function listGalleryCollectionMembers(collectionKey: string) {
  type ProjectedMember = Omit<GalleryCollectionMember, "name" | "email"> & { displayName: string };
  return postGallery<{ owners: ProjectedMember[]; collaborators: ProjectedMember[]; viewers: ProjectedMember[] }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.members, { collectionKey }).then(({ owners, collaborators, viewers }) => ({ members: [...owners, ...collaborators, ...viewers].map(({ displayName, ...member }) => ({ ...member, name: displayName, email: null })) }));
}

export function updateGalleryCollectionMember(collectionKey: string, memberKey: string, role: Exclude<GalleryCollectionRole, "owner">) {
  return postGallery<{ memberKey: string; role: Exclude<GalleryCollectionRole, "owner">; joinedAt: string }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.updateMember, { collectionKey, memberKey, role });
}

export function removeGalleryCollectionMember(collectionKey: string, memberKey: string) {
  return postGallery<{ memberKey: string }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.removeMember, { collectionKey, memberKey });
}

export function listGalleryCollectionInvites(memberKeys: string[] = []) {
  type PendingInvite = Omit<GalleryCollectionInvite, "recipient"> & { email?: string; inviteeKey?: string };
  const email = useAuthStore.getState().user?.email?.trim().toLocaleLowerCase();
  const memberships = new Set([getGalleryMemberKey(), ...memberKeys].filter(Boolean));
  return postGallery<{ invites: PendingInvite[] }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.invites, {}).then(({ invites }) => ({ invites: invites
    .filter((invite) => Boolean(email && invite.email?.toLocaleLowerCase() === email) || Boolean(invite.inviteeKey && memberships.has(invite.inviteeKey)))
    .map((invite) => ({ ...invite, recipient: invite.email ?? invite.inviteeKey ?? "Pending recipient" })) }));
}

export function respondToGalleryCollectionInvite(inviteKey: string, response: "accept" | "reject") {
  return postGallery<{ inviteKey: string }>(response === "accept" ? GALLERY_COLLECTION_SHARING_ENDPOINTS.acceptInvite : GALLERY_COLLECTION_SHARING_ENDPOINTS.rejectInvite, { inviteKey });
}

export function listGalleryCollectionShareLinks(collectionKey: string) {
  return postGallery<{ shares: GalleryCollectionShareLink[] }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.shareLinks, { collectionKey }).then(({ shares }) => ({ links: shares }));
}

export function createGalleryCollectionShareLink(collectionKey: string, role: Exclude<GalleryCollectionRole, "owner">, active: boolean) {
  return postGallery<{ share: GalleryCollectionShareLink; token?: string }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.createShareLink, { collectionKey, role, active }).then(({ share, token }) => ({ link: share, token }));
}

export function updateGalleryCollectionShareLink(collectionKey: string, shareKey: string, active: boolean) {
  return postGallery<{ share: GalleryCollectionShareLink }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.updateShareLink, { collectionKey, shareKey, active }).then(({ share }) => ({ link: share }));
}

export function leaveGalleryCollection(collectionKey: string) {
  return postGallery<{ collectionKey: string }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.leave, { collectionKey });
}

export function activateGalleryShare(token: string) {
  return postGallery<{ scopeKey: string; collectionKey: string; role: GalleryCollectionRole }>(GALLERY_COLLECTION_SHARING_ENDPOINTS.activateShare, { token });
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

export function fetchGalleryOverview(collectionKey?: string, cursor?: string, limit = 100, maxCaptionScore?: number, signal?: AbortSignal) {
  return postGallery<unknown>("/gallery/overview", { ...(collectionKey ? { collectionKey } : {}), ...(cursor ? { cursor } : {}), limit, ...(maxCaptionScore !== undefined ? { maxCaptionScore } : {}) }, 60_000, signal)
    .then((overview) => galleryOverviewSchema.parse(overview))
    .then((overview) => ({ ...overview, collections: overview.collections.map(normalizeCollection) }));
}

export function createGalleryCollection(name: string, isFavorite: boolean) {
  return postGallery<unknown>("/gallery/collections", { name, isFavorite }).then((collection) => normalizeCollection(galleryCollectionSchema.parse(collection)));
}

export function updateGalleryCollection(collectionKey: string, name: string, isFavorite: boolean, coverImageKey?: string | null) {
  return postGallery<unknown>("/gallery/collections/update", { collectionKey, name, isFavorite, ...(coverImageKey !== undefined ? { coverImageKey } : {}) })
    .then((value) => z.strictObject({ collection: galleryCollectionSchema }).parse(value))
    .then(({ collection }) => ({ collection: normalizeCollection(collection) }));
}

export function deleteGalleryCollection(collectionKey: string) {
  return postGallery<{ collectionKey: string }>("/gallery/collections/delete", { collectionKey });
}

export type PreparedGalleryUpload = {
  clientKey: string;
  filename: string;
  uri: string;
  sizeBytes: number;
  latitude?: number;
  longitude?: number;
  processingMode?: "library" | "cover";
};

export async function uploadGalleryImages(files: PreparedGalleryUpload[], collectionKey?: string) {
  const reservation = await postGallery<{
    uploads: { clientKey: string; uploadKey: string; imageKey: string; url: string; headers: Record<string, string> }[];
  }>("/gallery/uploads/presign", {
    collectionKey: collectionKey ?? null,
    files: files.map(({ clientKey, filename, sizeBytes, processingMode, latitude, longitude }) => ({ clientKey, filename, sizeBytes, ...(processingMode ? { processingMode } : {}), ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}) })),
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

export function searchGalleryImages(input: { query?: string; imageKey?: string; identityKey?: string; duplicates?: true; collectionKey?: string; recordHistory?: boolean; limit?: number }, signal?: AbortSignal) {
  if (input.query !== undefined) {
    return searchApp({ query: input.query, collectionSlugs: ["images"], recordHistory: input.recordHistory ?? true, limit: Math.min(input.limit ?? 10, 50), ...(input.collectionKey ? { filters: { collectionKey: input.collectionKey } } : {}) }, signal)
      .then((output) => ({ images: appSearchResults(output, "images", galleryImageSchema) }));
  }
  return postGallery<unknown>("/gallery/images/search", input, 4 * 60_000, signal).then((value) => z.strictObject({ images: z.array(galleryImageSchema) }).parse(value));
}

export function setGalleryImageFavorite(imageKey: string, isFavorite: boolean) {
  return postGallery<unknown>("/gallery/images/favorite", { imageKey, isFavorite }).then((value) => z.strictObject({ image: galleryImageSchema }).parse(value));
}

export function updateGalleryImage(imageKey: string, name: string, isFavorite: boolean) {
  return postGallery<unknown>("/gallery/images/update", { imageKey, name, isFavorite }).then((value) => z.strictObject({ image: galleryImageSchema }).parse(value));
}

export type GalleryImageDeleteResult = { deletedImageKeys: string[]; favoriteImageKeys: string[] };
export type GalleryDuplicateDeleteResult = { removedImageKeys: string[]; deletedImageKeys: string[]; favoriteImageKeys: string[] };

export function partitionFavoriteGalleryImages(images: GalleryImage[]) {
  return {
    favoriteImages: images.filter(({ isFavorite }) => isFavorite),
    eligibleImages: images.filter(({ isFavorite }) => !isFavorite),
  };
}

export function reconcileGalleryImageDeletion(images: GalleryImage[], result: GalleryImageDeleteResult) {
  const requestedKeys = new Set(images.map(({ key }) => key));
  const favoriteKeys = new Set(result.favoriteImageKeys.filter((key) => requestedKeys.has(key)));
  const deletedKeys = new Set(result.deletedImageKeys.filter((key) => requestedKeys.has(key) && !favoriteKeys.has(key)));
  return {
    deletedImages: images.filter(({ key }) => deletedKeys.has(key)),
    favoriteImages: images.filter(({ key }) => favoriteKeys.has(key)).map((image) => ({ ...image, isFavorite: true })),
    unknownImages: images.filter(({ key }) => !deletedKeys.has(key) && !favoriteKeys.has(key)),
  };
}

export function reconcileGalleryDuplicateDeletion(images: GalleryImage[], result: GalleryDuplicateDeleteResult) {
  const requestedKeys = new Set(images.map(({ key }) => key));
  const favoriteKeys = new Set(result.favoriteImageKeys.filter((key) => requestedKeys.has(key)));
  const removedKeys = new Set(result.removedImageKeys.filter((key) => requestedKeys.has(key) && !favoriteKeys.has(key)));
  return {
    removedImages: images.filter(({ key }) => removedKeys.has(key)),
    favoriteImages: images.filter(({ key }) => favoriteKeys.has(key)).map((image) => ({ ...image, isFavorite: true })),
    unknownImages: images.filter(({ key }) => !removedKeys.has(key) && !favoriteKeys.has(key)),
  };
}

export function deleteGalleryImages(imageKeys: string[]) {
  return postGallery<GalleryImageDeleteResult>("/gallery/images/delete", { imageKeys });
}

export function findGalleryCollectionDuplicates(collectionKey: string) {
  return searchGalleryImages({ duplicates: true, collectionKey });
}

export function deleteGalleryCollectionDuplicates(collectionKey: string, imageKeys: string[]) {
  return postGallery<GalleryDuplicateDeleteResult>("/gallery/collections/duplicates/delete", { collectionKey, imageKeys });
}

export function transferGalleryCollectionImages(input: { sourceCollectionKey: string; destinationCollectionKeys: string[]; imageKeys: string[]; mode: "copy" | "move" }) {
  return postGallery<{ mode: "copy" | "move"; imageKeys: string[]; destinationCollectionKeys: string[]; createdRelationCount: number }>("/gallery/collections/images/transfer", input);
}

export function listGallerySubjects() {
  return postGallery<{ subjects: GallerySubject[] }>("/gallery/subjects/list", {});
}

export function createGallerySubject(name: string, imageKeys: string[]) {
  return postGallery<{ subject: GallerySubject }>("/gallery/subjects", { name, imageKeys }, 4 * 60_000);
}

export function listGallerySubjectImages(identityKey: string) {
  return postGallery<{ images: GalleryImage[] }>("/gallery/subjects/images", { identityKey });
}

export function deleteGallerySubject(identityKey: string) {
  return postGallery<{ identityKey: string }>("/gallery/subjects/delete", { identityKey });
}

export async function askGalleryAssistant(message: string) {
  const { organizationKey, scopeKey } = getGalleryContext();
  const response = await apiClient.post<ApiResponse<{ type: "answer" | "note" | "unsupported"; message: string; changes?: AssistantChange[] }>>(
    "/assistant/respond",
    { organizationKey, scopeKey, input: { surface: "media-workspace", message, currentNote: { title: "", content: "" } } },
    { timeout: 4 * 60_000 },
  );
  if (!response.data.success) throw new Error(response.data.error.message);
  return response.data.data;
}
