import { beforeEach, expect, mock, test } from "bun:test";

const calls: { path: string; body: Record<string, unknown>; timeout?: number }[] = [];
const responses = new Map<string, unknown>();
const failures = new Map<string, { message: string; code?: string; transport?: boolean }>();

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => ({ user: { email: "recipient@example.com" }, organization: { key: "organization", membership_key: "membership" }, scope: { key: "scope" } }) },
}));
mock.module("./api-client", () => ({
  apiClient: { post: async (path: string, body: Record<string, unknown>, options?: { timeout?: number }) => {
    calls.push({ path, body, timeout: options?.timeout });
    const failure = failures.get(path);
    if (failure?.transport) throw { response: { data: { success: false, error: { message: failure.message, code: failure.code } } } };
    if (failure) return { data: { success: false, error: { message: failure.message, code: failure.code } } };
    if (responses.has(path)) return { data: { success: true, data: responses.get(path) } };
    if (path === "/gallery/uploads/presign") return { data: { success: true, data: { uploads: [{ clientKey: "local-image", uploadKey: "upload", imageKey: "image", url: "https://uploads.example/image", headers: { "Content-Type": "image/jpeg" } }] } } };
    if (path === "/gallery/uploads/complete") return { data: { success: true, data: { jobs: [{ key: "upload", imageKey: "image", status: "queued" }] } } };
    if (path === "/gallery/collections/members") return { data: { success: true, data: { owners: [], collaborators: [], viewers: [] } } };
    if (path === "/gallery/invites/pending") return { data: { success: true, data: { invites: [
      { key: "incoming", inviteeKey: "membership", role: "viewer", createdAt: "2026-08-18T00:00:00.000Z", collection: { key: "shared", name: "Shared" }, inviterDisplayName: "Ada" },
      { key: "sent", email: "someone@example.com", role: "viewer", createdAt: "2026-08-18T00:00:00.000Z", collection: { key: "owned", name: "Owned" }, inviterDisplayName: "You" },
    ] } } };
    if (path === "/gallery/collections/shares/list") return { data: { success: true, data: { shares: [{ key: "listed", url: "https://vorinthex.com/share/secure-listed-token", role: "viewer", active: true, createdAt: "2026-08-18T00:00:00.000Z" }] } } };
    if (path === "/gallery/collections/shares") return { data: { success: true, data: { share: { key: "link", url: "https://vorinthex.com/share/secure-created-token", role: "viewer", active: true, createdAt: "2026-08-18T00:00:00.000Z" } } } };
    if (path === "/gallery/collections/shares/update") return { data: { success: true, data: { share: { key: "link", url: "https://vorinthex.com/share/secure-created-token", role: "viewer", active: false, createdAt: "2026-08-18T00:00:00.000Z" } } } };
    if (path === "/gallery/shares/activate") return { data: { success: true, data: { scopeKey: "scope", collectionKey: "shared", role: "viewer" } } };
    const collection = { key: "collection", name: "Collection", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership" };
    if (path === "/gallery/overview") return { data: { success: true, data: { collections: [], images: [], nextCursor: null, canCreateCollections: true } } };
    if (path === "/gallery/collections") return { data: { success: true, data: collection } };
    if (path === "/gallery/collections/update") return { data: { success: true, data: { collection } } };
    return { data: { success: true, data: { images: [] } } };
  } },
}));

const { activateGalleryShare, createGalleryCollection, createGalleryCollectionShareLink, deleteGalleryCollection, deleteGalleryCollectionDuplicates, deleteGalleryImages, deleteGallerySubject, fetchGalleryOverview, filterCollections, filterGalleryShareLinks, filterMediaItems, findGalleryCollectionDuplicates, groupGalleryImagesByCreatedDate, isGalleryClientErrorCode, isGalleryCollectionOwned, leaveGalleryCollection, listGalleryCollectionInvites, listGalleryCollectionMembers, listGalleryCollectionShareLinks, mergeMediaItems, partitionFavoriteGalleryImages, reconcileGalleryDuplicateDeletion, reconcileGalleryImageDeletion, removeGalleryCollectionMember, respondToGalleryCollectionInvite, searchGalleryImages, setGalleryImageFavorite, transferGalleryCollectionImages, updateGalleryCollection, updateGalleryCollectionMember, updateGalleryCollectionShareLink, updateGalleryImage, uploadGalleryImages } = await import("./gallery-client");

beforeEach(() => { calls.splice(0); responses.clear(); failures.clear(); });

const collection = (name: string, key: string) => ({
  key,
  name,
  description: null,
  isFavorite: false,
  count: 0,
  coverUrl: null,
  memberKey: "membership",
  role: "owner" as const,
  access: { canRead: true, canContribute: true, canManage: true },
});

test("filters collections by name without changing their hierarchy", () => {
  const collections = [collection("Alpine Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "alpine")).toEqual([collections[0]]);
});

test("returns every collection for an empty search", () => {
  const collections = [collection("Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "  ")).toEqual(collections);
});

test("uses authoritative ownership with a legacy role fallback", () => {
  expect(isGalleryCollectionOwned({ isOwned: false, role: "owner" })).toBe(false);
  expect(isGalleryCollectionOwned({ isOwned: true, role: "collaborator" })).toBe(true);
  expect(isGalleryCollectionOwned({ role: "owner" })).toBe(true);
  expect(isGalleryCollectionOwned({ role: "viewer" })).toBe(false);
});

const image = (key: string, filename: string, caption: string) => ({
  key,
  filename,
  caption,
  imageCaptionKey: null,
  mimeType: "image/jpeg",
  sizeBytes: 100,
  width: 10,
  height: 10,
  isFavorite: false,
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T00:00:00.000Z",
  url: `https://images.example/${key}`,
});

test("matches collection images immediately by caption regardless of case", () => {
  const items = [image("rain", "one.jpg", "City reflections after rain"), image("coast", "two.jpg", "Open coastal water")];

  expect(filterMediaItems(items, "RAIN")).toEqual([items[0]]);
});

test("matches collection images by filename", () => {
  const items = [image("rain", "night-walk.jpg", "City reflections"), image("coast", "shore.jpg", "Open water")];

  expect(filterMediaItems(items, "night-walk")).toEqual([items[0]]);
});

test("requires every search term to match the same image", () => {
  const items = [image("rain", "night.jpg", "City reflections after rain"), image("day", "daylight.jpg", "City daylight")];

  expect(filterMediaItems(items, "city rain")).toEqual([items[0]]);
});

test("returns the full image set for an empty collection search", () => {
  const items = [image("rain", "night.jpg", "Rain")];

  expect(filterMediaItems(items, "  ")).toBe(items);
});

test("merges immediate and semantic matches without changing immediate order", () => {
  const exact = image("exact", "exact.jpg", "Exact match");
  const semantic = image("semantic", "semantic.jpg", "Related match");

  expect(mergeMediaItems([exact], [exact, semantic])).toEqual([exact, semantic]);
});

test("groups collection images by created date without changing image order", () => {
  const first = { ...image("first", "first.jpg", "First"), createdAt: "2025-01-12T12:00:00.000Z" };
  const second = { ...image("second", "second.jpg", "Second"), createdAt: "2025-01-12T15:00:00.000Z" };
  const third = { ...image("third", "third.jpg", "Third"), createdAt: "2025-01-11T12:00:00.000Z" };

  expect(groupGalleryImagesByCreatedDate([first, second, third])).toEqual([
    { label: "12 Jan 2025", images: [first, second] },
    { label: "11 Jan 2025", images: [third] },
  ]);
});

test("sends collection-scoped semantic searches through the canonical endpoint", async () => {
  await searchGalleryImages({ query: "rain", collectionKey: "collection", recordHistory: false, limit: 50 });

  expect(calls).toEqual([{
    path: "/gallery/images/search",
    body: { organizationKey: "organization", scopeKey: "scope", query: "rain", collectionKey: "collection", recordHistory: false, limit: 50 },
    timeout: 240_000,
  }]);
});

test("requests cursor pages of one hundred collection images", async () => {
  await fetchGalleryOverview("collection", "next-page");
  expect(calls[0]).toMatchObject({ path: "/gallery/overview", body: { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", cursor: "next-page", limit: 100 } });
  expect(calls[0]?.body).not.toHaveProperty("maxCaptionScore");
});

test("sends an inclusive caption score threshold on initial and cursor overview calls", async () => {
  await fetchGalleryOverview("collection", undefined, 100, 50);
  await fetchGalleryOverview("collection", "next-page", 100, 50);

  expect(calls.map(({ body }) => body)).toEqual([
    { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", limit: 100, maxCaptionScore: 50 },
    { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", cursor: "next-page", limit: 100, maxCaptionScore: 50 },
  ]);
});

test("normalizes legacy overview collection roles and capabilities without granting viewer writes", async () => {
  const base = { key: "legacy", name: "Legacy", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership" };
  responses.set("/gallery/overview", { collections: [base, { ...base, key: "viewer", role: "viewer" }, { ...base, key: "collaborator", role: "collaborator" }], images: [], nextCursor: null, canCreateCollections: true });

  const overview = await fetchGalleryOverview();

  expect(overview.collections.map(({ role, access }) => ({ role, access }))).toEqual([
    { role: "owner", access: { canRead: true, canContribute: true, canManage: true } },
    { role: "viewer", access: { canRead: true, canContribute: false, canManage: false } },
    { role: "collaborator", access: { canRead: true, canContribute: true, canManage: false } },
  ]);
});

test("normalizes create and update responses while preserving authoritative false capabilities", async () => {
  const base = { key: "collection", name: "Collection", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership" };
  responses.set("/gallery/collections", base);
  responses.set("/gallery/collections/update", { collection: { ...base, role: "owner", access: { canRead: true, canContribute: false, canManage: false } } });

  expect(await createGalleryCollection("Collection", false)).toMatchObject({ role: "owner", access: { canRead: true, canContribute: true, canManage: true } });
  expect((await updateGalleryCollection("collection", "Collection", false)).collection.access).toEqual({ canRead: true, canContribute: false, canManage: false });
});

test("sends similarity and duplicate discovery through image search", async () => {
  await searchGalleryImages({ imageKey: "source-image", limit: 15 });
  await findGalleryCollectionDuplicates("collection");

  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/gallery/images/search", body: { organizationKey: "organization", scopeKey: "scope", imageKey: "source-image", limit: 15 } },
    { path: "/gallery/images/search", body: { organizationKey: "organization", scopeKey: "scope", duplicates: true, collectionKey: "collection" } },
  ]);
});

test("sends visual identity search without a threshold or caller limit", async () => {
  await searchGalleryImages({ identityKey: "identity", collectionKey: "collection" });
  expect(calls[0]).toMatchObject({ path: "/gallery/images/search", body: { organizationKey: "organization", scopeKey: "scope", identityKey: "identity", collectionKey: "collection" } });
  expect(calls[0]?.body).not.toHaveProperty("threshold");
  expect(calls[0]?.body).not.toHaveProperty("limit");
});

test("sends favorite, delete, and many-to-many transfer through canonical mutations", async () => {
  await setGalleryImageFavorite("image", true);
  await deleteGalleryImages(["image-a", "image-b"]);
  await transferGalleryCollectionImages({ sourceCollectionKey: "source", destinationCollectionKeys: ["one"], imageKeys: ["image-a", "image-b"], mode: "copy" });

  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/gallery/images/favorite", body: { organizationKey: "organization", scopeKey: "scope", imageKey: "image", isFavorite: true } },
    { path: "/gallery/images/delete", body: { organizationKey: "organization", scopeKey: "scope", imageKeys: ["image-a", "image-b"] } },
    { path: "/gallery/collections/images/transfer", body: { organizationKey: "organization", scopeKey: "scope", sourceCollectionKey: "source", destinationCollectionKeys: ["one"], imageKeys: ["image-a", "image-b"], mode: "copy" } },
  ]);
});

test("preserves Gallery server error codes for direct and transport failures", async () => {
  failures.set("/gallery/collections/delete", { message: "raw server message", code: "GALLERY_COLLECTION_FAVORITE" });
  const direct = await deleteGalleryCollection("collection").catch((error: unknown) => error);
  expect(isGalleryClientErrorCode(direct, "GALLERY_COLLECTION_FAVORITE")).toBe(true);
  expect((direct as Error).message).toBe("raw server message");

  failures.set("/gallery/collections/delete", { message: "transport message", code: "GALLERY_COLLECTION_FAVORITE", transport: true });
  const transport = await deleteGalleryCollection("collection").catch((error: unknown) => error);
  expect(isGalleryClientErrorCode(transport, "GALLERY_COLLECTION_FAVORITE")).toBe(true);
});

test("returns authoritative favorite keys from image and duplicate deletion", async () => {
  responses.set("/gallery/images/delete", { deletedImageKeys: ["deleted"], favoriteImageKeys: ["favorite"] });
  responses.set("/gallery/collections/duplicates/delete", { removedImageKeys: ["removed"], deletedImageKeys: ["removed"], favoriteImageKeys: ["favorite"] });

  expect(await deleteGalleryImages(["deleted", "favorite"])).toEqual({ deletedImageKeys: ["deleted"], favoriteImageKeys: ["favorite"] });
  expect(await deleteGalleryCollectionDuplicates("collection", ["removed", "favorite"])).toEqual({ removedImageKeys: ["removed"], deletedImageKeys: ["removed"], favoriteImageKeys: ["favorite"] });
});

test("partitions local favorites and reconciles deleted, stale-favorite, and unknown image keys", () => {
  const favorite = { ...image("favorite", "favorite.jpg", "Favorite"), isFavorite: true };
  const deleted = image("deleted", "deleted.jpg", "Deleted");
  const staleFavorite = image("stale", "stale.jpg", "Stale favorite");
  const unknown = image("unknown", "unknown.jpg", "Unknown");

  expect(partitionFavoriteGalleryImages([favorite, deleted, staleFavorite, unknown])).toEqual({
    favoriteImages: [favorite],
    eligibleImages: [deleted, staleFavorite, unknown],
  });
  expect(reconcileGalleryImageDeletion([deleted, staleFavorite, unknown], { deletedImageKeys: ["deleted", "outside"], favoriteImageKeys: ["stale"] })).toEqual({
    deletedImages: [deleted],
    favoriteImages: [{ ...staleFavorite, isFavorite: true }],
    unknownImages: [unknown],
  });
});

test("reconciles duplicate removal independently from trash deletion semantics", () => {
  const removed = image("removed", "removed.jpg", "Removed");
  const staleFavorite = image("stale", "stale.jpg", "Stale favorite");
  const unknown = image("unknown", "unknown.jpg", "Unknown");

  expect(reconcileGalleryDuplicateDeletion([removed, staleFavorite, unknown], {
    removedImageKeys: ["removed"],
    deletedImageKeys: [],
    favoriteImageKeys: ["stale"],
  })).toEqual({ removedImages: [removed], favoriteImages: [{ ...staleFavorite, isFavorite: true }], unknownImages: [unknown] });
});

test("sends image and collection edits and collection deletion through canonical mutations", async () => {
  await updateGalleryImage("image", "portrait.jpg", true);
  await updateGalleryCollection("collection", "Portraits", true);
  await deleteGalleryCollection("collection");
  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/gallery/images/update", body: { organizationKey: "organization", scopeKey: "scope", imageKey: "image", name: "portrait.jpg", isFavorite: true } },
    { path: "/gallery/collections/update", body: { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", name: "Portraits", isFavorite: true } },
    { path: "/gallery/collections/delete", body: { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection" } },
  ]);
});

test("distinguishes selected, cleared, and omitted collection covers", async () => {
  await updateGalleryCollection("collection", "Selected", false, "image-key");
  await updateGalleryCollection("collection", "Cleared", false, null);
  await updateGalleryCollection("collection", "Untouched", false);
  expect(calls.map(({ body }) => body)).toEqual([
    { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", name: "Selected", isFavorite: false, coverImageKey: "image-key" },
    { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", name: "Cleared", isFavorite: false, coverImageKey: null },
    { organizationKey: "organization", scopeKey: "scope", collectionKey: "collection", name: "Untouched", isFavorite: false },
  ]);
});

test("filters share links into active and inactive tabs", () => {
  const links = [
    { key: "active", url: "https://vorinthex.com/share/active", role: "viewer" as const, active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    { key: "inactive", url: "https://vorinthex.com/share/inactive", role: "collaborator" as const, active: false, createdAt: "2026-01-02T00:00:00.000Z" },
  ];
  expect(filterGalleryShareLinks(links, true).map(({ key }) => key)).toEqual(["active"]);
  expect(filterGalleryShareLinks(links, false).map(({ key }) => key)).toEqual(["inactive"]);
});

test("creates collections with only a name and favorite state", async () => {
  await createGalleryCollection("Portraits", true);
  expect(calls[0]).toMatchObject({ path: "/gallery/collections", body: { organizationKey: "organization", scopeKey: "scope", name: "Portraits", isFavorite: true } });
  expect(calls[0]?.body).not.toHaveProperty("description");
});

test("uses explicit strict POST contracts for collection sharing", async () => {
  await listGalleryCollectionMembers("collection");
  await updateGalleryCollectionMember("collection", "member", "collaborator");
  await removeGalleryCollectionMember("collection", "member");
  const pending = await listGalleryCollectionInvites();
  await respondToGalleryCollectionInvite("invite", "accept");
  await respondToGalleryCollectionInvite("invite", "reject");
  const listed = await listGalleryCollectionShareLinks("collection");
  const created = await createGalleryCollectionShareLink("collection", "viewer", true);
  const updated = await updateGalleryCollectionShareLink("collection", "link", false);
  await leaveGalleryCollection("collection");
  expect(calls.map(({ path }) => path)).toEqual([
    "/gallery/collections/members", "/gallery/collections/members/role", "/gallery/collections/members/remove",
    "/gallery/invites/pending", "/gallery/invites/accept", "/gallery/invites/reject",
    "/gallery/collections/shares/list", "/gallery/collections/shares", "/gallery/collections/shares/update", "/gallery/collections/leave",
  ]);
  expect(calls.every(({ body }) => body.organizationKey === "organization" && body.scopeKey === "scope")).toBe(true);
  expect(calls[3]?.body).toEqual({ organizationKey: "organization", scopeKey: "scope" });
  expect(calls[4]?.body).not.toHaveProperty("collectionKey");
  expect(pending.invites.map(({ key }) => key)).toEqual(["incoming"]);
  expect(listed.links[0]?.url).toBe("https://vorinthex.com/share/secure-listed-token");
  expect(created.link.url).toBe("https://vorinthex.com/share/secure-created-token");
  expect(updated.link.url).toBe("https://vorinthex.com/share/secure-created-token");
  expect(calls[8]?.body).toMatchObject({ shareKey: "link", active: false });
  expect(calls[8]?.body).not.toHaveProperty("role");
  expect(calls[7]?.body).toMatchObject({ role: "viewer", active: true });
});

test("activates a secure collection share token with returned scope context", async () => {
  expect(await activateGalleryShare("secure-token")).toEqual({ scopeKey: "scope", collectionKey: "shared", role: "viewer" });
  expect(calls).toEqual([{ path: "/gallery/shares/activate", body: { organizationKey: "organization", scopeKey: "scope", token: "secure-token" }, timeout: 60_000 }]);
});

test("deletes visual identities through the canonical Gallery mutation", async () => {
  await deleteGallerySubject("identity");
  expect(calls[0]).toMatchObject({ path: "/gallery/subjects/delete", body: { organizationKey: "organization", scopeKey: "scope", identityKey: "identity" } });
});

test("maps accepted upload jobs back to optimistic client images", async () => {
  const originalFetch = globalThis.fetch;
  const uploads: { url: string; method?: string }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "file://image") return new Response(new Blob(["jpeg"]), { status: 200 });
    uploads.push({ url, method: init?.method });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await uploadGalleryImages([{ clientKey: "local-image", filename: "image.jpg", uri: "file://image", sizeBytes: 4, latitude: 59.3293, longitude: 18.0686 }], "collection");

    expect(result.jobs).toEqual([{ key: "upload", imageKey: "image", status: "queued", clientKey: "local-image" }]);
    expect(uploads).toEqual([{ url: "https://uploads.example/image", method: "PUT" }]);
    expect(calls.map(({ path }) => path)).toEqual(["/gallery/uploads/presign", "/gallery/uploads/complete"]);
    expect(calls[0]?.body).toMatchObject({ files: [{ clientKey: "local-image", filename: "image.jpg", sizeBytes: 4, latitude: 59.3293, longitude: 18.0686 }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
