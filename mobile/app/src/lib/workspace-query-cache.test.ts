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
  appendOptimisticCompassTrip,
  addOptimisticCompassPlace,
  compassQueryKeys,
  galleryQueryKeys,
  getGalleryCollections,
  invalidateAssistantChanges,
  patchCachedCompassPlace,
  patchGalleryImage,
  patchSignalThread,
  patchGalleryUserHiddens,
  reconcileOptimisticCompassPlace,
  reconcileOptimisticCompassTrip,
  removeCachedCompassPlace,
  removeCachedCompassTrip,
  removeOptimisticCompassPlace,
  removeOptimisticCompassTrip,
  removeCachedGalleryImages,
  restoreGalleryOverviews,
  snapshotGalleryOverviews,
  signalQueryKeys,
  setCachedGalleryCollections,
  setCachedGalleryInvites,
  setCachedGalleryMembers,
  setCachedGalleryShareLinks,
  transferCachedGalleryImages,
  upsertCachedCompassTrip,
  upsertCompassTrip,
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
  expect(compassQueryKeys.trips(context)).toEqual(["compass", "org-a", "scope-a", "trips"]);
  expect(compassQueryKeys.placeReferences(context, "place-a", "brief")).toEqual(["compass", "org-a", "scope-a", "places", "place-a", "references", "brief"]);
  expect(compassQueryKeys.placeReferences(context, "place-a", "brief")).not.toEqual(compassQueryKeys.placeReferences(context, "place-a", "activities"));
  expect(compassQueryKeys.tripGuides(context, "trip-a")).toEqual(["compass", "org-a", "scope-a", "trips", "trip-a", "guides"]);
  expect(compassQueryKeys.tripGuides(context, "trip-a")).not.toEqual(compassQueryKeys.tripGuides(context, "trip-b"));
  expect(compassQueryKeys.tripGuides(context, "trip-a")).not.toEqual(compassQueryKeys.tripGuides(otherContext, "trip-a"));
  expect(compassQueryKeys.countryDetail(context, "IS")).toEqual(["compass", "org-a", "scope-a", "country-details", "IS"]);
  expect(compassQueryKeys.countryDetail(context, "IS")).not.toEqual(compassQueryKeys.countryDetail(otherContext, "IS"));
  expect(compassQueryKeys.countryImage(context, "token-a")).not.toEqual(compassQueryKeys.countryImage(context, "token-b"));
  expect(compassQueryKeys.cityDetail(context, "ES", "Valencia")).not.toEqual(compassQueryKeys.cityDetail(context, "VE", "Valencia"));
  expect(compassQueryKeys.cityImage(context, "ES", "Valencia", "token-a")).not.toEqual(compassQueryKeys.cityImage(context, "ES", "Valencia", "token-b"));
  expect(signalQueryKeys.overview(context, "all")).not.toEqual(signalQueryKeys.overview(context, "favorite"));
  expect(signalQueryKeys.overviewPage(context, "all", undefined, "cursor-a")).not.toEqual(signalQueryKeys.overviewPage(context, "all", undefined, "cursor-b"));
  expect(signalQueryKeys.detail(context, "thread-a")).not.toEqual(signalQueryKeys.detail(context, "thread-b"));
  expect(signalQueryKeys.tones(context)).not.toEqual(signalQueryKeys.tones(otherContext));
  expect(ascendQueryKeys.detail(context, "book-a")).not.toEqual(ascendQueryKeys.detail(otherContext, "book-a"));
});

test("appends and independently reconciles overlapping optimistic Compass trips", () => {
  const place = { key: "place", kind: "place" as const, name: "Lisbon", summary: "City", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: "2026-08-20T00:00:00.000Z" };
  const first = { key: "optimistic-first", name: "First", status: "planned" as const, createdAt: place.createdAt, places: [place] };
  const second = { key: "optimistic-second", name: "Second", status: "planned" as const, createdAt: place.createdAt, places: [place] };
  const both = appendOptimisticCompassTrip(appendOptimisticCompassTrip([], first), second);
  expect(both.map(({ key }) => key)).toEqual([first.key, second.key]);

  const reconciled = reconcileOptimisticCompassTrip(both, second.key, { ...second, key: "saved-second" });
  expect(reconciled.map(({ key }) => key)).toEqual([first.key, "saved-second"]);
  expect(removeOptimisticCompassTrip(reconciled, first.key).map(({ key }) => key)).toEqual(["saved-second"]);
  expect(removeOptimisticCompassTrip(reconciled, "missing")).toEqual(reconciled);
});

test("upserts Compass trips in place and appends new trips", () => {
  const at = "2026-08-20T00:00:00.000Z";
  const place = { key: "place", kind: "place" as const, name: "Lisbon", summary: "City", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: at };
  const first = { key: "first", name: "First", status: "planned" as const, createdAt: at, places: [place] };
  const second = { key: "second", name: "Second", status: "planned" as const, createdAt: at, places: [place] };
  const updated = { ...first, name: "Updated" };

  expect(upsertCompassTrip([first, second], updated)).toEqual([updated, second]);
  expect(upsertCompassTrip([first, second], { ...second, key: "third" }).map(({ key }) => key)).toEqual(["first", "second", "third"]);
});

test("upserts and removes Compass trips only in the exact context cache", () => {
  const client = new QueryClient();
  const at = "2026-08-20T00:00:00.000Z";
  const place = { key: "place", kind: "place" as const, name: "Lisbon", summary: "City", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: at };
  const first = { key: "first", name: "First", status: "planned" as const, createdAt: at, places: [place] };
  const second = { key: "second", name: "Second", status: "planned" as const, createdAt: at, places: [place] };
  const exactKey = compassQueryKeys.trips(context);
  const otherKey = compassQueryKeys.trips(otherContext);
  const overviewKey = compassQueryKeys.overview(context);
  client.setQueryData(exactKey, [first, second]);
  client.setQueryData(otherKey, [first]);
  client.setQueryData(overviewKey, { sentinel: true });
  client.setQueryData(compassQueryKeys.tripGuides(context, first.key), [{ key: "guide" }]);

  upsertCachedCompassTrip(client, context, { ...first, name: "Updated" });
  expect(client.getQueryData(exactKey)).toEqual([{ ...first, name: "Updated" }, second]);
  removeCachedCompassTrip(client, context, first.key);
  expect(client.getQueryData(exactKey)).toEqual([second]);
  expect(client.getQueryData(otherKey)).toEqual([first]);
  expect(client.getQueryData(overviewKey)).toEqual({ sentinel: true });
  expect(client.getQueryState(compassQueryKeys.tripGuides(context, first.key))).toBeUndefined();
});

test("reconciles overlapping Compass saves by optimistic key without erasing siblings", () => {
  const at = "2026-08-20T00:00:00.000Z";
  const first = { key: "optimistic-first", kind: "place" as const, name: "Lisbon", summary: "First", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: at, coverUrl: "https://signed.test/lisbon.png" };
  const second = { key: "optimistic-second", kind: "place" as const, name: "Porto", summary: "Second", countryCode: "PT", latitude: 41.15, longitude: -8.61, status: "wishlist" as const, isFavorite: false, createdAt: at, coverUrl: "https://signed.test/porto.png" };
  const recent = { key: "recent-lisbon", kind: "place" as const, name: "Lisbon", summary: "Recent", countryCode: "PT", latitude: 38.72, longitude: -9.14, openedAt: at };
  const both = addOptimisticCompassPlace(addOptimisticCompassPlace({ places: [], recentPlaces: [recent] }, first), second);
  const failedFirst = removeOptimisticCompassPlace(both, first.key);
  expect(failedFirst.places).toEqual([second]);
  expect(failedFirst.recentPlaces).toEqual([recent]);
  const savedSecond = { ...second, key: "saved-second" };
  const reconciled = reconcileOptimisticCompassPlace(both, second.key, savedSecond);
  expect(reconciled.places.map(({ key }) => key).sort()).toEqual([first.key, savedSecond.key].sort());
  expect(reconciled.places.find(({ key }) => key === savedSecond.key)).toMatchObject({ kind: "place", coverUrl: second.coverUrl });
  expect(reconciled.recentPlaces).toEqual([recent]);
});

test("patches one Compass place across overview, trip, and semantic search caches", () => {
  const client = new QueryClient();
  const at = "2026-08-20T00:00:00.000Z";
  const place = { key: "place", kind: "place" as const, name: "Lisbon", summary: "City", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: at };
  const updated = { ...place, status: "visited" as const, isFavorite: true };
  client.setQueryData(compassQueryKeys.overview(context), { places: [place], recentPlaces: [] });
  client.setQueryData(compassQueryKeys.trips(context), [{ key: "trip", name: "Portugal", status: "planned", createdAt: at, places: [place] }]);
  client.setQueryData(compassQueryKeys.placeSearch(context, "coast"), [place]);
  client.setQueryData(compassQueryKeys.tripSearch(context, "coast"), [{ key: "trip", name: "Portugal", status: "planned", createdAt: at, places: [place] }]);
  client.setQueryData(compassQueryKeys.overview(otherContext), { places: [place], recentPlaces: [] });

  patchCachedCompassPlace(client, context, updated);

  expect(client.getQueryData<{ places: (typeof updated)[] }>(compassQueryKeys.overview(context))?.places).toEqual([updated]);
  expect(client.getQueryData<{ places: (typeof updated)[] }[]>(compassQueryKeys.trips(context))?.[0]?.places).toEqual([updated]);
  expect(client.getQueryData(compassQueryKeys.placeSearch(context, "coast"))).toEqual([updated]);
  expect(client.getQueryData<{ places: (typeof updated)[] }[]>(compassQueryKeys.tripSearch(context, "coast"))?.[0]?.places).toEqual([updated]);
  expect(client.getQueryData<{ places: (typeof place)[] }>(compassQueryKeys.overview(otherContext))?.places).toEqual([place]);
});

test("hard-removes one Compass place and every reference kind from relevant caches", () => {
  const client = new QueryClient();
  const at = "2026-08-20T00:00:00.000Z";
  const removed = { key: "removed", kind: "place" as const, name: "Lisbon", summary: "City", countryCode: "PT", latitude: 38.72, longitude: -9.14, status: "wishlist" as const, isFavorite: false, createdAt: at };
  const retained = { ...removed, key: "retained", name: "Porto" };
  const trip = { key: "trip", name: "Portugal", status: "planned" as const, createdAt: at, places: [removed, retained] };
  client.setQueryData(compassQueryKeys.overview(context), { places: [removed, retained], recentPlaces: [] });
  client.setQueryData(compassQueryKeys.placeSearch(context, "coast"), [removed, retained]);
  client.setQueryData(compassQueryKeys.trips(context), [trip]);
  client.setQueryData(compassQueryKeys.tripSearch(context, "coast"), [trip]);
  client.setQueryData(compassQueryKeys.placeReferences(context, removed.key, "brief"), [{ key: "brief" }]);
  client.setQueryData(compassQueryKeys.placeReferences(context, removed.key, "activities"), [{ key: "activities" }]);

  removeCachedCompassPlace(client, context, removed.key);

  expect(client.getQueryData<{ places: (typeof retained)[] }>(compassQueryKeys.overview(context))?.places).toEqual([retained]);
  expect(client.getQueryData(compassQueryKeys.placeSearch(context, "coast"))).toEqual([retained]);
  expect(client.getQueryData<(typeof trip)[]>(compassQueryKeys.trips(context))?.[0]?.places).toEqual([retained]);
  expect(client.getQueryData<(typeof trip)[]>(compassQueryKeys.tripSearch(context, "coast"))?.[0]?.places).toEqual([retained]);
  expect(client.getQueryState(compassQueryKeys.placeReferences(context, removed.key, "brief"))).toBeUndefined();
  expect(client.getQueryState(compassQueryKeys.placeReferences(context, removed.key, "activities"))).toBeUndefined();
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
  const compassOverview = compassQueryKeys.overview(context);
  const archiveLocation = contentQueryKeys.location(context);
  for (const key of [galleryOverview, galleryDetail, otherGallery, signalOverview, signalDetail, ascendOverview, compassOverview, archiveLocation]) client.setQueryData(key, {});

  await invalidateAssistantChanges(client, context, [{ workspace: "gallery" }, { workspace: "gallery" }, { workspace: "archive" }, { workspace: "signal" }, { workspace: "compass" }, { workspace: "ascend" }]);

  expect(client.getQueryState(galleryOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(galleryDetail)?.isInvalidated).toBe(true);
  expect(client.getQueryState(archiveLocation)?.isInvalidated).toBe(true);
  expect(client.getQueryState(otherGallery)?.isInvalidated).toBe(false);
  expect(client.getQueryState(signalOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(signalDetail)?.isInvalidated).toBe(true);
  expect(client.getQueryState(compassOverview)?.isInvalidated).toBe(true);
  expect(client.getQueryState(ascendOverview)?.isInvalidated).toBe(true);
});

test("patches Signal favorites across filtered overviews and the exact detail cache", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, lastMessageAt: at, isFavorite: false, createdAt: at, updatedAt: at };
  const updated = { ...thread, isFavorite: true };
  const overview = { account: null, connector: null, threads: [thread], drafts: [], counts: { all: 1, important: 0, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0 } };
  client.setQueryData(signalQueryKeys.overview(context), overview);
  client.setQueryData(signalQueryKeys.overview(context, "favorite"), { ...overview, threads: [] });
  client.setQueryData(signalQueryKeys.detail(context, thread.key), { thread, messages: [] });
  client.setQueryData(signalQueryKeys.overview(otherContext), overview);

  patchSignalThread(client, context, updated);

  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context))?.threads[0]?.isFavorite).toBe(true);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "favorite"))?.threads).toEqual([]);
  expect(client.getQueryData<{ thread: typeof updated }>(signalQueryKeys.detail(context, thread.key))?.thread.isFavorite).toBe(true);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(otherContext))?.threads[0]?.isFavorite).toBe(false);
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
