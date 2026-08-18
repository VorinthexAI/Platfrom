import { apiClient } from "@/lib/api-client";
import type { AssistantChange } from "@/lib/assistant-changes";
import { normalizeCollection, type CollectionRole } from "@/lib/collection-access";
import { useAuthStore } from "@/state/auth";

export type GalleryCollection = {
  key: string;
  name: string;
  description: string | null;
  isFavorite: boolean;
  count: number;
  coverUrl: string | null;
  memberKey: string;
  isOwned?: boolean;
  role: GalleryCollectionRole;
  access: { canRead: boolean; canContribute: boolean; canManage: boolean };
};

export type GalleryCollectionRole = CollectionRole;

type GalleryCollectionAccess = GalleryCollection["access"];
type GalleryCollectionProjection = Omit<GalleryCollection, "role" | "access"> & {
  role?: GalleryCollectionRole;
  access?: Partial<GalleryCollectionAccess>;
};

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
  city?: string | null;
  country?: string | null;
  countryCode?: string | null;
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

export function filterCollections(collections: GalleryCollection[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return collections;
  return collections.filter(({ name, description }) => `${name}\n${description ?? ""}`.toLocaleLowerCase().includes(normalized));
}

export function isGalleryCollectionOwned(collection: Pick<GalleryCollection, "isOwned" | "role">) {
  return collection.isOwned ?? (collection.role === "owner");
}

export function filterMediaItems(items: GalleryImage[], query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return items;
  return items.filter(({ caption, filename, city, country, countryCode }) => {
    const searchable = `${caption}\n${filename}\n${city ?? ""}\n${country ?? ""}\n${countryCode ?? ""}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
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
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { message: string; code?: string } };

export class GalleryClientError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "GalleryClientError";
    this.code = code;
  }
}

export function isGalleryClientErrorCode(error: unknown, code: string) {
  return error instanceof GalleryClientError && error.code === code;
}

function galleryClientError(error: { message: string; code?: string }) {
  return new GalleryClientError(error.message, error.code);
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

async function postGallery<T>(path: string, input: Record<string, unknown>, timeout = 60_000) {
  try {
    const response = await apiClient.post<ApiResponse<T>>(path, { ...getGalleryContext(), ...input }, { timeout });
    if (!response.data.success) throw galleryClientError(response.data.error);
    return response.data.data;
  } catch (error) {
    const failure = (error as { response?: { data?: ApiResponse<T> } }).response?.data;
    if (failure && !failure.success) throw galleryClientError(failure.error);
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
  list: "/gallery/highlights/list",
  detail: "/gallery/highlights/read",
} as const;

export function createGalleryCollectionHighlight(collectionKey: string) {
  return postGallery<{ highlight: GalleryHighlightProjection }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.create, { collectionKey })
    .then(({ highlight }) => ({ highlight: normalizeGalleryHighlight(highlight) }));
}

export function listGalleryCollectionHighlights(collectionKey: string) {
  return postGallery<{ highlights: GalleryHighlightProjection[] }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.list, { collectionKey })
    .then(({ highlights }) => ({ highlights: highlights.map(normalizeGalleryHighlight) }));
}

export function fetchGalleryCollectionHighlight(highlightKey: string) {
  return postGallery<{ highlight: GalleryHighlightProjection }>(GALLERY_COLLECTION_HIGHLIGHT_ENDPOINTS.detail, { highlightKey })
    .then(({ highlight }) => ({ highlight: normalizeGalleryHighlight(highlight) }));
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

export function fetchGalleryOverview(collectionKey?: string, cursor?: string, limit = 100, maxCaptionScore?: number) {
  return postGallery<Omit<GalleryOverview, "collections"> & { collections: GalleryCollectionProjection[] }>("/gallery/overview", { ...(collectionKey ? { collectionKey } : {}), ...(cursor ? { cursor } : {}), limit, ...(maxCaptionScore !== undefined ? { maxCaptionScore } : {}) })
    .then((overview) => ({ ...overview, collections: overview.collections.map(normalizeCollection) }));
}

export function createGalleryCollection(name: string, isFavorite: boolean) {
  return postGallery<GalleryCollectionProjection>("/gallery/collections", { name, isFavorite }).then(normalizeCollection);
}

export function updateGalleryCollection(collectionKey: string, name: string, isFavorite: boolean, coverImageKey?: string | null) {
  return postGallery<{ collection: GalleryCollectionProjection }>("/gallery/collections/update", { collectionKey, name, isFavorite, ...(coverImageKey !== undefined ? { coverImageKey } : {}) })
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

export function searchGalleryImages(input: { query?: string; imageKey?: string; identityKey?: string; duplicates?: true; collectionKey?: string; recordHistory?: boolean; limit?: number }) {
  return postGallery<{ images: GalleryImage[] }>("/gallery/images/search", input, 4 * 60_000);
}

export function setGalleryImageFavorite(imageKey: string, isFavorite: boolean) {
  return postGallery<{ image: GalleryImage }>("/gallery/images/favorite", { imageKey, isFavorite });
}

export function updateGalleryImage(imageKey: string, name: string, isFavorite: boolean) {
  return postGallery<{ image: GalleryImage }>("/gallery/images/update", { imageKey, name, isFavorite });
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
