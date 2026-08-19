import { expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";

import type { ContentContext } from "./content-client";
import type { GalleryCollection, GalleryImage, GalleryOverview } from "./gallery-client";

mock.module("./content-client", () => ({
  getContentDocumentTopics: () => undefined,
  listContentDocumentAudioVersions: () => undefined,
  listContentDocumentSummaries: () => undefined,
  listContentDocumentsAtLocation: () => undefined,
  listContentFolderTree: () => undefined,
  listContentSearchHistory: () => undefined,
  readContentDocument: () => undefined,
}));

const { contentQueryKeys } = await import("./content-query-cache");
const {
  ascendQueryKeys,
  compassQueryKeys,
  galleryQueryKeys,
  getGalleryCollections,
  invalidateAssistantChanges,
  patchGalleryImage,
  patchGalleryUserHiddens,
  removeCachedGalleryImages,
  restoreGalleryOverviews,
  snapshotGalleryOverviews,
  signalQueryKeys,
  setCachedGalleryCollections,
  setCachedGalleryInvites,
  setCachedGalleryMembers,
  setCachedGalleryShareLinks,
  transferCachedGalleryImages,
} = await import("./workspace-query-cache");

const context: ContentContext = { organizationKey: "org-a", scopeKey: "scope-a" };
const otherContext: ContentContext = { organizationKey: "org-b", scopeKey: "scope-b" };

test("isolates every routed workspace key by context and resource", () => {
  expect(galleryQueryKeys.overview(context, "collection")).not.toEqual(galleryQueryKeys.overview(otherContext, "collection"));
  expect(galleryQueryKeys.cleanup(context, "collection", 25)).not.toEqual(galleryQueryKeys.cleanup(context, "collection", 50));
  expect(galleryQueryKeys.cleanup(context, "collection", 25)).not.toEqual(galleryQueryKeys.cleanup(context, "other", 25));
  expect(galleryQueryKeys.highlight(context, "collection", "one")).not.toEqual(galleryQueryKeys.highlight(context, "collection", "two"));
  expect(galleryQueryKeys.memories(context, "collection")).toEqual(["gallery", "org-a", "scope-a", "memories", "collection"]);
  expect(galleryQueryKeys.memory(context, "collection", "one")).toEqual(["gallery", "org-a", "scope-a", "memories", "collection", "one"]);
  expect(galleryQueryKeys.memory(context, "collection", "one")).not.toEqual(galleryQueryKeys.memory(context, "collection", "two"));
  expect(galleryQueryKeys.userHiddens(context)).not.toEqual(galleryQueryKeys.userHiddens(otherContext));
  expect(compassQueryKeys.overview(context)).not.toEqual(compassQueryKeys.overview(otherContext));
  expect(signalQueryKeys.overview(context, "all")).not.toEqual(signalQueryKeys.overview(context, "favorite"));
  expect(signalQueryKeys.detail(context, "thread-a")).not.toEqual(signalQueryKeys.detail(context, "thread-b"));
  expect(ascendQueryKeys.detail(context, "book-a")).not.toEqual(ascendQueryKeys.detail(otherContext, "book-a"));
});

test("optimistically patches and snapshots Gallery hidden overlays", () => {
  const client = new QueryClient();
  const hidden = { key: "hidden", userKey: "user", source: "image" as const, sourceKey: "image", createdAt: "2026-08-18T00:00:00.000Z" };
  expect(patchGalleryUserHiddens(client, context, (current) => [...current, hidden])).toEqual([]);
  expect(client.getQueryData(galleryQueryKeys.userHiddens(context))).toEqual([hidden]);
  expect(patchGalleryUserHiddens(client, context, () => [])).toEqual([hidden]);
});

test("invalidates a collection highlight list and every cached detail together", async () => {
  const client = new QueryClient();
  const list = galleryQueryKeys.highlights(context, "collection");
  const first = galleryQueryKeys.highlight(context, "collection", "first");
  const second = galleryQueryKeys.highlight(context, "collection", "second");
  const other = galleryQueryKeys.highlight(context, "other", "first");
  for (const key of [list, first, second, other]) client.setQueryData(key, {});
  await client.invalidateQueries({ queryKey: list, refetchType: "none" });
  expect(client.getQueryState(list)?.isInvalidated).toBe(true);
  expect(client.getQueryState(first)?.isInvalidated).toBe(true);
  expect(client.getQueryState(second)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

test("invalidates every cached cleanup threshold for one collection", async () => {
  const client = new QueryClient();
  const first = galleryQueryKeys.cleanup(context, "collection", 25);
  const second = galleryQueryKeys.cleanup(context, "collection", 50);
  const other = galleryQueryKeys.cleanup(context, "other", 25);
  for (const key of [first, second, other]) client.setQueryData(key, {});

  await client.invalidateQueries({ queryKey: galleryQueryKeys.cleanups(context, "collection"), refetchType: "none" });

  expect(client.getQueryState(first)?.isInvalidated).toBe(true);
  expect(client.getQueryState(second)?.isInvalidated).toBe(true);
  expect(client.getQueryState(other)?.isInvalidated).toBe(false);
});

test("loads Gallery collections once per context and permits explicit singleton updates", async () => {
  const client = new QueryClient();
  const collections: GalleryCollection[] = [{ key: "collection", name: "Collection", description: null, isFavorite: false, count: 1, coverUrl: null, memberKey: "membership", role: "owner", access: { canRead: true, canContribute: true, canManage: true } }];
  let loads = 0;
  const load = () => { loads += 1; return Promise.resolve(collections); };

  expect(await getGalleryCollections(client, context, load)).toEqual(collections);
  expect(await getGalleryCollections(client, context, load)).toEqual(collections);
  expect(loads).toBe(1);

  const updated = [{ ...collections[0]!, count: 2 }];
  setCachedGalleryCollections(client, context, updated);
  expect(client.getQueryData(galleryQueryKeys.collections(context))).toEqual(updated);
});

test("repairs legacy Gallery collections already retained in the singleton cache", async () => {
  const client = new QueryClient();
  const legacy = { key: "legacy", name: "Legacy", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership", role: "viewer" };
  client.setQueryData(galleryQueryKeys.collections(context), [legacy]);

  const collections = await getGalleryCollections(client, context, async () => { throw new Error("stale cache should be used"); });

  expect(collections[0]).toMatchObject({ role: "viewer", access: { canRead: true, canContribute: false, canManage: false } });
  expect(client.getQueryData(galleryQueryKeys.collections(context))).toEqual(collections);
});

test("assistant changes invalidate exact workspace prefixes without crossing contexts", async () => {
  const client = new QueryClient();
  const galleryOverview = galleryQueryKeys.overview(context);
  const galleryDetail = galleryQueryKeys.overview(context, "collection");
  const otherGallery = galleryQueryKeys.overview(otherContext);
  const signalOverview = signalQueryKeys.overview(context);
  const signalDetail = signalQueryKeys.detail(context, "thread");
  const ascendOverview = ascendQueryKeys.overview(context);
  const archiveLocation = contentQueryKeys.location(context);
  for (const key of [galleryOverview, galleryDetail, otherGallery, signalOverview, signalDetail, ascendOverview, archiveLocation]) client.setQueryData(key, {});

  await invalidateAssistantChanges(client, context, [{ workspace: "gallery" }, { workspace: "gallery" }, { workspace: "archive" }, { workspace: "signal" }, { workspace: "ascend" }]);

  expect(client.getQueryState(galleryOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(galleryDetail)?.isInvalidated).toBe(true);
  expect(client.getQueryState(archiveLocation)?.isInvalidated).toBe(true);
  expect(client.getQueryState(otherGallery)?.isInvalidated).toBe(false);
  expect(client.getQueryState(signalOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(signalDetail)?.isInvalidated).toBe(true);
  expect(client.getQueryState(ascendOverview)?.isInvalidated).toBe(true);
});

test("isolates and updates collection sharing caches", () => {
  const client = new QueryClient();
  const members = [{ key: "membership", memberKey: "user", name: "Ada", email: null, role: "viewer" as const, joinedAt: "2026-08-18T00:00:00.000Z" }];
  const invites = [{ key: "invite", recipient: "ada@example.com", role: "collaborator" as const, createdAt: "2026-08-18T00:00:00.000Z", collection: { key: "collection", name: "Collection" }, inviterDisplayName: "Owner" }];
  const links = [{ key: "link", url: "https://vorinthex.com/share/link", role: "viewer" as const, active: true, createdAt: "2026-08-18T00:00:00.000Z" }];
  setCachedGalleryMembers(client, context, "collection", members);
  setCachedGalleryInvites(client, context, "collection", invites);
  setCachedGalleryShareLinks(client, context, "collection", links);
  expect(client.getQueryData(galleryQueryKeys.members(context, "collection"))).toEqual(members);
  expect(client.getQueryData(galleryQueryKeys.invites(context, "collection"))).toEqual(invites);
  expect(client.getQueryData(galleryQueryKeys.shareLinks(context, "collection"))).toEqual(links);
  expect(galleryQueryKeys.members(context, "collection")).not.toEqual(galleryQueryKeys.members(context, "other"));
});

const image = (key: string, isFavorite = false): GalleryImage => ({ key, filename: `${key}.jpg`, caption: key, imageCaptionKey: null, mimeType: "image/jpeg", sizeBytes: 100, width: 10, height: 10, isFavorite, createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z", url: `https://images.example/${key}` });

test("optimistically patches favorites across every Gallery overview", () => {
  const client = new QueryClient();
  const original = image("image");
  const overview: GalleryOverview = { collections: [], images: [original], nextCursor: null, canCreateCollections: true };
  client.setQueryData(galleryQueryKeys.overview(context), overview);
  client.setQueryData(galleryQueryKeys.overview(context, "collection"), overview);

  patchGalleryImage(client, context, { ...original, isFavorite: true });

  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context))?.images[0]?.isFavorite).toBe(true);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "collection"))?.images[0]?.isFavorite).toBe(true);
});

test("optimistically copies and moves many images to many collection caches", () => {
  const client = new QueryClient();
  const first = image("first"), second = image("second");
  const collections = [
    { key: "source", name: "Source", description: null, isFavorite: false, count: 2, coverUrl: first.url, memberKey: "membership", role: "owner" as const, access: { canRead: true, canContribute: true, canManage: true } },
    { key: "one", name: "One", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership", role: "owner" as const, access: { canRead: true, canContribute: true, canManage: true } },
    { key: "two", name: "Two", description: null, isFavorite: false, count: 0, coverUrl: null, memberKey: "membership", role: "owner" as const, access: { canRead: true, canContribute: true, canManage: true } },
  ];
  client.setQueryData(galleryQueryKeys.overview(context), { collections, images: [first, second], nextCursor: null, canCreateCollections: true });
  client.setQueryData(galleryQueryKeys.overview(context, "source"), { collections, images: [first, second], nextCursor: null, canCreateCollections: true });
  client.setQueryData(galleryQueryKeys.overview(context, "one"), { collections, images: [], nextCursor: null, canCreateCollections: true });
  client.setQueryData(galleryQueryKeys.overview(context, "two"), { collections, images: [], nextCursor: null, canCreateCollections: true });

  transferCachedGalleryImages(client, context, { sourceCollectionKey: "source", destinationCollectionKeys: ["one", "two"], images: [first, second], mode: "move" });

  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "source"))?.images).toEqual([]);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "one"))?.images).toEqual([first, second]);
  expect(client.getQueryData<GalleryOverview>(galleryQueryKeys.overview(context, "two"))?.images).toEqual([first, second]);
});

test("removes deleted images everywhere and restores exact optimistic snapshots", () => {
  const client = new QueryClient();
  const deleted = image("deleted"), retained = image("retained");
  const key = galleryQueryKeys.overview(context, "collection");
  client.setQueryData(key, { collections: [{ key: "collection", name: "Collection", description: null, isFavorite: false, count: 2, coverUrl: deleted.url, memberKey: "membership", role: "owner", access: { canRead: true, canContribute: true, canManage: true } }], images: [deleted, retained], nextCursor: null, canCreateCollections: true });
  const snapshot = snapshotGalleryOverviews(client, context);

  removeCachedGalleryImages(client, context, [deleted]);
  expect(client.getQueryData<GalleryOverview>(key)).toMatchObject({ collections: [{ count: 1 }], images: [retained] });
  restoreGalleryOverviews(client, snapshot);
  expect(client.getQueryData<GalleryOverview>(key)?.images).toEqual([deleted, retained]);
});
