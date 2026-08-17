import { beforeEach, expect, mock, test } from "bun:test";

const calls: Array<{ path: string; body: Record<string, unknown>; timeout?: number }> = [];

mock.module("@/state/auth", () => ({
  useAuthStore: { getState: () => ({ organization: { key: "organization" }, scope: { key: "scope" } }) },
}));
mock.module("./api-client", () => ({
  apiClient: { post: async (path: string, body: Record<string, unknown>, options?: { timeout?: number }) => {
    calls.push({ path, body, timeout: options?.timeout });
    if (path === "/gallery/uploads/presign") return { data: { success: true, data: { uploads: [{ clientKey: "local-image", uploadKey: "upload", imageKey: "image", url: "https://uploads.example/image", headers: { "Content-Type": "image/jpeg" } }] } } };
    if (path === "/gallery/uploads/complete") return { data: { success: true, data: { jobs: [{ key: "upload", imageKey: "image", status: "queued" }] } } };
    return { data: { success: true, data: { images: [] } } };
  } },
}));

const { deleteGalleryCollection, deleteGalleryImages, fetchGalleryOverview, filterCollections, filterMediaItems, findGalleryCollectionDuplicates, mergeMediaItems, searchGalleryImages, setGalleryImageFavorite, transferGalleryCollectionImages, updateGalleryCollection, updateGalleryImage, uploadGalleryImages } = await import("./gallery-client");

beforeEach(() => calls.splice(0));

const collection = (name: string, key: string) => ({
  key,
  name,
  description: null,
  isFavorite: false,
  count: 0,
  coverUrl: null,
});

test("filters collections by name without changing their hierarchy", () => {
  const collections = [collection("Alpine Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "alpine")).toEqual([collections[0]]);
});

test("returns every collection for an empty search", () => {
  const collections = [collection("Trips", "trips"), collection("My Images", "default")];

  expect(filterCollections(collections, "  ")).toEqual(collections);
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
});

test("sends similarity and duplicate discovery through image search", async () => {
  await searchGalleryImages({ imageKey: "source-image", limit: 15 });
  await findGalleryCollectionDuplicates("collection");

  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/gallery/images/search", body: { organizationKey: "organization", scopeKey: "scope", imageKey: "source-image", limit: 15 } },
    { path: "/gallery/images/search", body: { organizationKey: "organization", scopeKey: "scope", duplicates: true, collectionKey: "collection" } },
  ]);
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

test("maps accepted upload jobs back to optimistic client images", async () => {
  const originalFetch = globalThis.fetch;
  const uploads: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "file://image") return new Response(new Blob(["jpeg"]), { status: 200 });
    uploads.push({ url, method: init?.method });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  try {
    const result = await uploadGalleryImages([{ clientKey: "local-image", filename: "image.jpg", uri: "file://image", sizeBytes: 4 }], "collection");

    expect(result.jobs).toEqual([{ key: "upload", imageKey: "image", status: "queued", clientKey: "local-image" }]);
    expect(uploads).toEqual([{ url: "https://uploads.example/image", method: "PUT" }]);
    expect(calls.map(({ path }) => path)).toEqual(["/gallery/uploads/presign", "/gallery/uploads/complete"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
