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
mock.module("./books-client", () => ({}));
mock.module("./email-client", () => ({
  normalizeEmailOverviewQuery: (input: { readState?: "read" | "unread"; facets?: string[]; search?: string } = {}) => ({
    readState: input.readState ?? "unread",
    facets: ["urgent", "important", "filtered", "favorite"].filter((facet) => (input.facets ?? ["urgent", "important"]).includes(facet)),
    search: input.search?.trim() ?? "",
  }),
}));

const { contentQueryKeys } = await import("./content-query-cache");
const {
  ascendQueryKeys,
  addCachedBook,
  appendOptimisticCompassTrip,
  addOptimisticCompassPlace,
  compassQueryKeys,
  galleryQueryKeys,
  getGalleryCollections,
  invalidateAssistantChanges,
  patchCachedCompassPlace,
  patchGalleryImage,
  patchCachedBook,
  patchCachedBookMetadata,
  patchCachedBookProgress,
  mergeBookDetailProgress,
  removeCachedBook,
  patchSignalInbox,
  patchSignalThread,
  parseSignalOverviewQuery,
  clearSignalTrashCaches,
  clearSignalThreadTombstones,
  commitSignalTrashCaches,
  filterSignalTombstonedOverview,
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
  signalThreadBelongsToOverview,
  setCachedGalleryCollections,
  setCachedGalleryInvites,
  setCachedGalleryMembers,
  setCachedGalleryShareLinks,
  transferCachedGalleryImages,
  upsertCachedCompassTrip,
  upsertCompassTrip,
  upsertSignalTone,
  upsertSignalSummary,
  upsertSignalTranslationVersion,
  removeSignalReplyContexts,
  reconcileSignalOverviewThreads,
  reconcileSignalSelectedThreads,
  reconcileSignalThreads,
  removeSignalOverviewThreadKeys,
  removeSignalThreadKeys,
  overlayPendingSignalThread,
  restoreSignalDraftIfStillRemoved,
  restoreSignalTrashCaches,
  restoreSignalToneIfStillRemoved,
  removeSignalSummaries,
  removeSignalTranslationVersions,
  restoreMissingSignalSummaries,
  restoreMissingSignalTranslationVersions,
  settleMatchingSignalRepairPendingFields,
  tombstoneSignalThreadKeys,
  reconcileSignalTrashedThread,
  upsertSignalReplyContext,
} = await import("./workspace-query-cache");

test("converges optimistic books through patch and removal", () => {
  const client = new QueryClient();
  const pending = { key: "pending", title: "Pending", subtitle: "Queued", description: "Goal", status: "queued" as const, estimatedMinutes: 25, chapterCount: 0, progressPercent: 0 };
  client.setQueryData(ascendQueryKeys.overview(context), { books: [] });
  addCachedBook(client, context, pending);
  patchCachedBook(client, context, { ...pending, status: "writing", generationProgressPercent: 50 });
  expect(client.getQueryData<{ books: { status: string }[] }>(ascendQueryKeys.overview(context))?.books[0]?.status).toBe("writing");
  removeCachedBook(client, context, pending.key);
  expect(client.getQueryData<{ books: unknown[] }>(ascendQueryKeys.overview(context))?.books).toEqual([]);
});

test("isolates pending book requests from authoritative overview refreshes", () => {
  const client = new QueryClient();
  const pendingKey = ascendQueryKeys.pending(context);
  client.setQueryData(pendingKey, [{ requestKey: "request", book: { key: "pending-request" } }]);
  client.setQueryData(ascendQueryKeys.overview(context), { books: [{ key: "server-book" }] });
  client.setQueryData(ascendQueryKeys.overview(context), { books: [{ key: "server-book-updated" }] });
  expect(client.getQueryData<{ requestKey: string }[]>(pendingKey)).toEqual([{ requestKey: "request", book: { key: "pending-request" } }]);
});

test("progress patches retain active signed media and monotonic completion", () => {
  const client = new QueryClient();
  const book = { key: "book", title: "Book", subtitle: "Subtitle", description: "Description", status: "ready" as const, coverUrl: "https://old/cover", estimatedMinutes: 10, chapterCount: 1, progressPercent: 50 };
  const chapter = { key: "chapter", title: "Chapter", description: "Description", position: 1, audioUrl: "https://old/audio", imageUrl: "https://old/image", progressSeconds: 50, isCompleted: true };
  client.setQueryData(ascendQueryKeys.detail(context, book.key), { book, chapters: [chapter] });
  client.setQueryData(ascendQueryKeys.overview(context), { books: [book] });
  patchCachedBookProgress(client, context, { ...book, coverUrl: "https://new/cover", progressPercent: 0 }, { ...chapter, audioUrl: "https://new/audio", imageUrl: "https://new/image", progressSeconds: 10, isCompleted: false });
  expect(client.getQueryData<{ book: typeof book; chapters: (typeof chapter)[] }>(ascendQueryKeys.detail(context, book.key))).toEqual({ book, chapters: [chapter] });
});

test("extension metadata patches preserve cached chapters", () => {
  const client = new QueryClient();
  const book = { key: "book", title: "Book", subtitle: "Subtitle", description: "Description", status: "ready" as const, estimatedMinutes: 10, chapterCount: 1, progressPercent: 50 };
  const chapter = { key: "chapter", title: "Chapter", description: "Description", position: 1, progressSeconds: 20, isCompleted: false };
  client.setQueryData(ascendQueryKeys.overview(context), { books: [book] });
  client.setQueryData(ascendQueryKeys.detail(context, book.key), { book, chapters: [chapter] });
  patchCachedBookMetadata(client, context, { ...book, status: "queued", chapterCount: 4 });
  expect(client.getQueryData<{ books: (typeof book)[] }>(ascendQueryKeys.overview(context))?.books[0]).toMatchObject({ status: "queued", chapterCount: 4 });
  expect(client.getQueryData<{ book: typeof book; chapters: (typeof chapter)[] }>(ascendQueryKeys.detail(context, book.key))).toEqual({ book: { ...book, status: "queued", chapterCount: 4 }, chapters: [chapter] });
});

test("merges every detail ingress monotonically while accepting refreshed media", () => {
  const book = { key: "book", title: "Book", subtitle: "Subtitle", description: "Description", status: "ready" as const, estimatedMinutes: 10, chapterCount: 1, progressPercent: 60 };
  const chapter = { key: "chapter", title: "Chapter", description: "Description", position: 1, audioUrl: "https://old/audio", progressSeconds: 60, isCompleted: true };
  const merged = mergeBookDetailProgress(
    { book, chapters: [chapter] },
    { book: { ...book, progressPercent: 10 }, chapters: [{ ...chapter, audioUrl: "https://new/audio", progressSeconds: 10, isCompleted: false }] },
  );
  expect(merged.book.progressPercent).toBe(60);
  expect(merged.chapters[0]).toMatchObject({ audioUrl: "https://new/audio", progressSeconds: 60, isCompleted: true });
});

test("pending Signal fields overlay equal-timestamp SSE until authoritative completion", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const pending = new Map([[thread.key, { favorite: true, read: true, trash: true }]]);
  expect(overlayPendingSignalThread({ ...thread }, pending)).toMatchObject({ isFavorite: true, isRead: true, unread: false, labels: ["TRASH"], inInbox: false });
  expect(overlayPendingSignalThread(thread, new Map())).toEqual(thread);
});

for (const source of ["reconnect", "content.changed"] as const) test(`${source} with stale server state retains repair-pending Signal fields`, () => {
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const result = settleMatchingSignalRepairPendingFields(new Map([[thread.key, { favorite: true }]]), new Map([[thread.key, new Set(["favorite" as const])]]), [thread]);
  expect(result.pending.get(thread.key)).toEqual({ favorite: true });
  expect(result.repairPending.get(thread.key)).toEqual(new Set(["favorite"]));
  expect(result.settledThreadKeys).toEqual([]);
});

test("matching authoritative repair refresh clears only converged Signal fields", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: true, isRead: false, unread: true, labels: ["TRASH"], createdAt: at, updatedAt: at };
  const result = settleMatchingSignalRepairPendingFields(new Map([[thread.key, { favorite: true, read: true, trash: true }]]), new Map([[thread.key, new Set(["favorite" as const, "read" as const, "trash" as const])]]), [thread]);
  expect(result.pending.get(thread.key)).toEqual({ read: true });
  expect(result.repairPending.get(thread.key)).toEqual(new Set(["read"]));
  expect(result.settledThreadKeys).toEqual([]);
  const completed = settleMatchingSignalRepairPendingFields(result.pending, result.repairPending, [{ ...thread, isRead: true, unread: false }]);
  expect(completed.pending.has(thread.key)).toBe(false);
  expect(completed.repairPending.has(thread.key)).toBe(false);
  expect(completed.settledThreadKeys).toEqual([thread.key]);
});

test("Signal deletion rollback restores only a still-removed entity", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const tone = { key: "tone", name: "Direct", instruction: "Be direct", isFavorite: false, createdAt: at, updatedAt: at };
  const newerTone = { ...tone, name: "Newer", updatedAt: "2026-08-23T11:00:00.000Z" };
  expect(restoreSignalToneIfStillRemoved([], tone)).toEqual([tone]);
  expect(restoreSignalToneIfStillRemoved([newerTone], tone)).toEqual([newerTone]);
  expect(restoreSignalToneIfStillRemoved([{ ...tone, key: "concurrent" }], tone)?.map(({ key }) => key)).toEqual(["concurrent", "tone"]);
  const draft = { key: "draft", variant: "new" as const, connectorKey: "connector", to: ["one@example.com"], subject: "Draft", generatedContent: "Body", status: "generated" as const, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 0 }, nextCursor: null };
  expect(restoreSignalDraftIfStillRemoved(overview, draft, { drafts: true, unassignedDrafts: false })?.drafts).toEqual([draft]);
  const newerDraft = { ...draft, subject: "Newer", updatedAt: newerTone.updatedAt };
  expect(restoreSignalDraftIfStillRemoved({ ...overview, drafts: [newerDraft] }, draft, { drafts: true, unassignedDrafts: false })?.drafts).toEqual([newerDraft]);
  const concurrentDraft = { ...draft, key: "concurrent" };
  expect(restoreSignalDraftIfStillRemoved({ ...overview, drafts: [concurrentDraft] }, draft, { drafts: true, unassignedDrafts: false })?.drafts).toEqual([concurrentDraft, draft]);
});

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
  expect(signalQueryKeys.overview(context, "connector-a", "all")).not.toEqual(signalQueryKeys.overview(context, "connector-b", "all"));
  expect(signalQueryKeys.overview(context)).toEqual([...signalQueryKeys.overviews(context), null, "root"]);
  const composite = { readState: "unread" as const, facets: ["important" as const, "urgent" as const], search: " client " };
  expect(signalQueryKeys.overviewPage(context, "connector-a", composite, "cursor-a")).not.toEqual(signalQueryKeys.overviewPage(context, "connector-a", composite, "cursor-b"));
  expect(signalQueryKeys.detail(context, "connector-a", "thread-a")).not.toEqual(signalQueryKeys.detail(context, "connector-b", "thread-a"));
  expect(signalQueryKeys.overview(context)).not.toEqual(signalQueryKeys.overview(otherContext));
  expect(signalQueryKeys.replyContexts(context)).toEqual(["signal", "org-a", "scope-a", "reply-contexts"]);
  expect(signalQueryKeys.replyContexts(context)).not.toEqual(signalQueryKeys.replyContexts(otherContext));
  expect(ascendQueryKeys.detail(context, "book-a")).not.toEqual(ascendQueryKeys.detail(otherContext, "book-a"));
});

test("Signal composite keys normalize and parse every facet combination", () => {
  const all = signalQueryKeys.overview(context, "connector", { readState: "read", facets: ["favorite", "filtered", "important", "urgent"], search: "  client  " });
  expect(all).toEqual([...signalQueryKeys.accountOverviews(context, "connector"), "inbox", "read", "urgent,important,filtered,favorite", "client"]);
  expect(parseSignalOverviewQuery(all)).toEqual({ kind: "inbox", query: { readState: "read", facets: ["urgent", "important", "filtered", "favorite"], search: "client" } });
  const empty = signalQueryKeys.overview(context, "connector", { readState: "unread", facets: [], search: "" });
  expect(parseSignalOverviewQuery(empty)).toEqual({ kind: "inbox", query: { readState: "unread", facets: [], search: "" } });
  expect(parseSignalOverviewQuery(signalQueryKeys.overview(context, "connector", "trash"))).toEqual({ kind: "legacy", filter: "trash", search: null });
});

test("Signal favorite membership is optional when off and required when on", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const base = { key: "thread", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  expect(signalThreadBelongsToOverview(base, { readState: "unread", facets: ["urgent", "important"], search: "" })).toBe(true);
  expect(signalThreadBelongsToOverview({ ...base, inboxCategory: "Urgent" }, { readState: "unread", facets: ["urgent", "favorite"], search: "" })).toBe(false);
  expect(signalThreadBelongsToOverview({ ...base, isFavorite: true }, { readState: "unread", facets: ["important", "favorite"], search: "" })).toBe(true);
  expect(signalThreadBelongsToOverview({ ...base, inboxCategory: "Filtered", isFavorite: true }, { readState: "unread", facets: ["favorite"], search: "" })).toBe(true);
  expect(signalThreadBelongsToOverview({ ...base, isRead: true, unread: false }, { readState: "unread", facets: ["important"], search: "" })).toBe(false);
  expect(signalThreadBelongsToOverview(base, { readState: "unread", facets: [], search: "" })).toBe(false);
});

test("Signal reconciliation honors default, all-active, and zero-facet cache membership", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null };
  const filtered = { ...thread, inboxCategory: "Filtered" as const, updatedAt: "2026-08-23T10:01:00.000Z" };
  expect(reconcileSignalOverviewThreads(overview, [filtered], { readState: "unread", facets: ["urgent", "important"], search: "" }).threads).toEqual([]);
  expect(reconcileSignalOverviewThreads(overview, [{ ...filtered, isFavorite: true }], { readState: "unread", facets: ["urgent", "important", "filtered", "favorite"], search: "" }).threads).toEqual([{ ...filtered, isFavorite: true }]);
  expect(reconcileSignalOverviewThreads(overview, [filtered], { readState: "unread", facets: [], search: "" }).threads).toEqual([]);
  expect(reconcileSignalOverviewThreads(overview, [{ ...filtered, isRead: true, unread: false }], { readState: "unread", facets: ["filtered"], search: "" }).threads).toEqual([]);
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
  const signalDetail = signalQueryKeys.detail(context, "connector", "thread");
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
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], counts: { all: 1, important: 0, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), overview);
  client.setQueryData(signalQueryKeys.overview(context, "connector", "favorite"), { ...overview, threads: [] });
  client.setQueryData(signalQueryKeys.detail(context, "connector", thread.key), { thread, messages: [{ key: "message", inboxCategory: "Important", labels: ["INBOX"] }] });
  client.setQueryData(signalQueryKeys.overview(context, "other-connector", "all"), overview);
  client.setQueryData(signalQueryKeys.overview(otherContext), overview);

  patchSignalThread(client, context, "connector", updated);

  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "all"))?.threads[0]?.isFavorite).toBe(true);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "favorite"))?.threads).toEqual([]);
  expect(client.getQueryData<{ thread: typeof updated }>(signalQueryKeys.detail(context, "connector", thread.key))?.thread.isFavorite).toBe(true);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "other-connector", "all"))?.threads[0]?.isFavorite).toBe(false);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(otherContext))?.threads[0]?.isFavorite).toBe(false);
});

test("moves a trashed Signal thread only into Trash and reconciles counts and detail messages", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "important"), overview);
  client.setQueryData(signalQueryKeys.overview(context, "connector", "filtered"), { ...overview, threads: [] });
  client.setQueryData(signalQueryKeys.overview(context, "connector", "trash"), { ...overview, threads: [] });
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), overview);
  client.setQueryData(signalQueryKeys.detail(context, "connector", thread.key), { thread, messages: [{ key: "message", inboxCategory: "Important", labels: ["INBOX"], isRead: false, unread: true }] });
  client.setQueryData(signalQueryKeys.overview(context, "other", "important"), overview);
  const trashed = reconcileSignalTrashedThread(client, context, "connector", { ...thread, labels: ["TRASH"], inInbox: false });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "important"))).toMatchObject({ threads: [], counts: { all: 0, important: 0, needsAction: 0, unread: 0, trash: 1 } });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "filtered"))).toMatchObject({ threads: [], counts: { all: 0, important: 0, trash: 1 } });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "trash"))).toMatchObject({ threads: [{ key: thread.key }], counts: { trash: 1 } });
  expect(client.getQueryData<{ thread: typeof trashed; messages: { labels: string[]; isRead: boolean }[] }>(signalQueryKeys.detail(context, "connector", thread.key))).toMatchObject({ thread: trashed, messages: [{ labels: ["INBOX", "TRASH"], isRead: false }] });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "other", "important"))?.threads).toHaveLength(1);
});

test("functionally merges concurrent Signal translation and summary versions", () => {
  const client = new QueryClient();
  const translation = (key: string, version: number, content = key) => ({ key, version, content }) as Parameters<typeof upsertSignalTranslationVersion>[3];
  const summary = (key: string, version: number, value = key) => ({ key, version, summary: value }) as Parameters<typeof upsertSignalSummary>[3];
  client.setQueryData(signalQueryKeys.translations(context, "message"), { messageKey: "message", versions: [translation("two", 2)] });
  upsertSignalTranslationVersion(client, context, "message", translation("one", 1));
  upsertSignalTranslationVersion(client, context, "message", translation("three", 3));
  upsertSignalTranslationVersion(client, context, "message", translation("two", 2, "updated"));
  expect(client.getQueryData<{ versions: { key: string; content: string }[] }>(signalQueryKeys.translations(context, "message"))?.versions).toEqual([
    expect.objectContaining({ key: "three" }), expect.objectContaining({ key: "two", content: "updated" }), expect.objectContaining({ key: "one" }),
  ]);
  client.setQueryData(signalQueryKeys.summaries(context, "message"), { messageKey: "message", summaries: [summary("two", 2)] });
  upsertSignalSummary(client, context, "message", summary("one", 1));
  upsertSignalSummary(client, context, "message", summary("three", 3));
  expect(client.getQueryData<{ summaries: { key: string }[] }>(signalQueryKeys.summaries(context, "message"))?.summaries.map(({ key }) => key)).toEqual(["three", "two", "one"]);
});

test("generated record deletion and conditional restoration preserve additions, order, idempotency, and context isolation", () => {
  const client = new QueryClient();
  const otherContext = { organizationKey: "other-org", scopeKey: "other-scope" };
  const translation = (key: string, version: number) => ({ key, version, content: key }) as Parameters<typeof upsertSignalTranslationVersion>[3];
  const summary = (key: string, version: number) => ({ key, version, summary: key }) as Parameters<typeof upsertSignalSummary>[3];
  const translations = { messageKey: "message", versions: [translation("three", 3), translation("two", 2), translation("one", 1)] };
  const summaries = { messageKey: "message", summaries: [summary("three", 3), summary("two", 2), summary("one", 1)] };
  client.setQueryData(signalQueryKeys.translations(context, "message"), translations);
  client.setQueryData(signalQueryKeys.translations(otherContext, "message"), translations);
  client.setQueryData(signalQueryKeys.summaries(context, "message"), summaries);
  const removedTranslations = removeSignalTranslationVersions(translations, ["three", "one"]);
  const removedSummaries = removeSignalSummaries(summaries, ["two"]);
  expect(removedTranslations?.versions.map(({ key }) => key)).toEqual(["two"]);
  expect(removeSignalTranslationVersions(removedTranslations, ["three", "one"])).toEqual(removedTranslations);
  expect(removedSummaries?.summaries.map(({ key }) => key)).toEqual(["three", "one"]);
  const withConcurrentTranslation = { ...removedTranslations!, versions: [translation("four", 4), ...removedTranslations!.versions] };
  const withConcurrentSummary = { ...removedSummaries!, summaries: [summary("four", 4), ...removedSummaries!.summaries] };
  const restoredTranslations = restoreMissingSignalTranslationVersions(withConcurrentTranslation, translations.versions, ["one"]);
  const restoredSummaries = restoreMissingSignalSummaries(withConcurrentSummary, summaries.summaries, ["two"]);
  expect(restoredTranslations?.versions.map(({ key }) => key)).toEqual(["four", "two", "one"]);
  expect(restoreMissingSignalTranslationVersions(restoredTranslations, translations.versions, ["one"])).toEqual(restoredTranslations);
  expect(restoredSummaries?.summaries.map(({ key }) => key)).toEqual(["four", "three", "two", "one"]);
  expect(client.getQueryData(signalQueryKeys.translations(otherContext, "message"))).toEqual(translations);
});

test("repeated Trash reconciliation is idempotent", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "low" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], inInbox: false, lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "trash"), overview);
  reconcileSignalTrashedThread(client, context, "connector", thread);
  reconcileSignalTrashedThread(client, context, "connector", thread);
  expect(client.getQueryData(signalQueryKeys.overview(context, "connector", "trash"))).toEqual(overview);
});

test("pure trash reconciliation preserves loaded continuation threads and cursor", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const continuation = { ...thread, key: "continuation", providerThreadId: "continued", subject: "Loaded from page two" };
  const overview = { accounts: [], selectedAccount: null, threads: [thread, continuation], drafts: [], unassignedDrafts: [], counts: { all: 2, important: 2, urgent: 0, needsAction: 2, filtered: 0, unread: 0, favorite: 0, trash: 0 }, nextCursor: "page-three" };
  const reconciled = reconcileSignalOverviewThreads(overview, [{ ...thread, labels: ["TRASH"], inInbox: false }], "important", null);
  expect(reconciled).toMatchObject({ threads: [{ key: continuation.key }], nextCursor: "page-three", counts: { all: 1, important: 1, filtered: 0, needsAction: 1, trash: 1 } });
});

test("reconciles read state into hidden counts, unread membership, and detail messages", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), overview);
  client.setQueryData(signalQueryKeys.overview(context, "connector", "unread"), overview);
  client.setQueryData(signalQueryKeys.overview(context, "connector", "filtered"), { ...overview, threads: [] });
  client.setQueryData(signalQueryKeys.detail(context, "connector", thread.key), { thread, messages: [{ key: "message", isRead: false, unread: true }] });
  reconcileSignalThreads(client, context, "connector", [{ ...thread, isRead: true, unread: false }]);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "unread"))).toMatchObject({ threads: [], counts: { unread: 0 } });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "filtered"))).toMatchObject({ threads: [], counts: { unread: 0 } });
  expect(client.getQueryData(signalQueryKeys.detail(context, "connector", thread.key))).toMatchObject({ messages: [{ isRead: true, unread: false }] });
});

test("SSE-first read and favorite state make repeated API reconciliation a no-op", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), overview);
  const authoritative = { ...thread, isRead: true, unread: false, isFavorite: true, updatedAt: "2026-08-23T10:01:00.000Z" };
  reconcileSignalThreads(client, context, "connector", [authoritative]);
  const afterSse = client.getQueryData(signalQueryKeys.overview(context, "connector", "all"));
  client.setQueryData(signalQueryKeys.detail(context, "connector", thread.key), { thread, messages: [] });
  reconcileSignalThreads(client, context, "connector", [{ ...thread, updatedAt: "2026-08-23T10:00:30.000Z" }]);
  expect(client.getQueryData(signalQueryKeys.overview(context, "connector", "all"))).toEqual(afterSse);
  expect(afterSse).toMatchObject({ counts: { unread: 0, favorite: 1 }, threads: [{ isRead: true, isFavorite: true }] });
});

test("SSE-first reconciliation uses each differently aged overview as its count baseline", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const oldUnread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const sseRead = { ...oldUnread, isRead: true, unread: false, updatedAt: "2026-08-23T10:02:00.000Z" };
  const counts = { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0, trash: 0 };
  const base = { accounts: [], selectedAccount: null, drafts: [], unassignedDrafts: [], nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), { ...base, threads: [sseRead], counts });
  client.setQueryData(signalQueryKeys.overview(context, "connector", "unread"), { ...base, threads: [oldUnread], counts: { ...counts, unread: 1 } });

  reconcileSignalThreads(client, context, "connector", [{ ...oldUnread, updatedAt: "2026-08-23T10:01:00.000Z" }]);

  expect(client.getQueryData<{ threads: (typeof oldUnread)[]; counts: typeof counts }>(signalQueryKeys.overview(context, "connector", "all"))).toMatchObject({ threads: [{ isRead: true }], counts: { unread: 0 } });
  expect(client.getQueryData<{ threads: (typeof oldUnread)[]; counts: typeof counts }>(signalQueryKeys.overview(context, "connector", "unread"))).toMatchObject({ threads: [], counts: { unread: 0 } });
});

test("stale excluded Signal overview refetches instead of applying a false zero count delta", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const oldExcluded = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const newerIncluded = { ...oldExcluded, isFavorite: true, updatedAt: "2026-08-23T10:02:00.000Z" };
  const counts = { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0, trash: 0 };
  const staleKey = signalQueryKeys.overview(context, "connector", "favorite");
  client.setQueryData(staleKey, { accounts: [], selectedAccount: null, threads: [], drafts: [], unassignedDrafts: [], counts, nextCursor: null });
  client.setQueryData(signalQueryKeys.overview(context, "connector", "all"), { accounts: [], selectedAccount: null, threads: [newerIncluded], drafts: [], unassignedDrafts: [], counts: { ...counts, favorite: 1 }, nextCursor: null });

  reconcileSignalThreads(client, context, "connector", [{ ...oldExcluded, updatedAt: "2026-08-23T10:01:00.000Z" }]);

  expect(client.getQueryState(staleKey)?.isInvalidated).toBe(true);
  expect(client.getQueryData<{ counts: typeof counts }>(staleKey)?.counts.favorite).toBe(0);
});

test("authoritative external changes update hidden selected thread metadata without dropping records", () => {
  const at = "2026-08-23T10:00:00.000Z";
  const hidden = { key: "hidden", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider-hidden", subject: "Hidden", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, createdAt: at, updatedAt: at };
  const visible = { ...hidden, key: "visible", providerThreadId: "provider-visible", subject: "Visible" };
  const updated = { ...hidden, isFavorite: true, isRead: true, labels: ["STARRED"], updatedAt: "2026-08-23T10:01:00.000Z" };
  expect(reconcileSignalSelectedThreads([hidden, visible], [updated])).toEqual([updated, visible]);
});

test("provider-deleted Signal keys leave every connector overview and detail cache without crossing boundaries", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const deleted = { key: "deleted", subject: "Gone", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: true, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const retained = { ...deleted, key: "retained", subject: "Retained", isFavorite: false };
  const counts = { all: 2, important: 2, urgent: 0, needsAction: 2, filtered: 0, unread: 2, favorite: 1, trash: 0 };
  const overview = { accounts: [], selectedAccount: null, threads: [deleted, retained], drafts: [], unassignedDrafts: [], counts, nextCursor: "next" };
  const hiddenKey = signalQueryKeys.overview(context, "connector", "filtered");
  const visibleKey = signalQueryKeys.overview(context, "connector", "all");
  const pageKey = signalQueryKeys.overviewPage(context, "connector", "all", "cursor");
  const detailKey = signalQueryKeys.detail(context, "connector", deleted.key);
  const otherDetailKey = signalQueryKeys.detail(context, "other", deleted.key);
  client.setQueryData(visibleKey, overview);
  client.setQueryData(hiddenKey, { ...overview, threads: [] });
  client.setQueryData(pageKey, { ...overview, threads: [deleted] });
  client.setQueryData(detailKey, { thread: deleted, messages: [{ key: "message" }] });
  client.setQueryData(otherDetailKey, { thread: deleted, messages: [] });

  removeSignalThreadKeys(client, context, "connector", [deleted.key], [deleted, retained]);

  for (const key of [visibleKey, hiddenKey, pageKey]) expect(client.getQueryData<typeof overview>(key)).toMatchObject({ counts: { all: 1, important: 1, needsAction: 1, unread: 1, favorite: 0 }, nextCursor: expect.anything() });
  expect(client.getQueryData<typeof overview>(visibleKey)?.threads.map(({ key }) => key)).toEqual([retained.key]);
  expect(client.getQueryData<typeof overview>(hiddenKey)?.threads).toEqual([]);
  expect(client.getQueryData(detailKey)).toBeUndefined();
  expect(client.getQueryData(otherDetailKey)).toBeDefined();
  expect(removeSignalOverviewThreadKeys(overview, [deleted.key], [deleted, retained]).threads).toEqual([retained]);
});

test("provider-deleted Signal tombstones filter stale fetches and reconciliation without crossing context or connector", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const deleted = { key: "deleted", subject: "Gone", summary: "Summary", intent: "Review", priority: "normal" as const, state: "needs_action" as const, inboxCategory: "Important" as const, lastMessageAt: at, isFavorite: false, isRead: false, unread: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [deleted], drafts: [], unassignedDrafts: [], counts: { all: 1, important: 1, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null };
  const key = signalQueryKeys.overview(context, "connector", "all");
  tombstoneSignalThreadKeys(context, "connector", [deleted.key]);
  expect(filterSignalTombstonedOverview(context, "connector", overview)).toMatchObject({ threads: [], counts: { all: 0, important: 0, unread: 0 } });
  expect(filterSignalTombstonedOverview(context, "other", overview).threads).toEqual([deleted]);
  expect(filterSignalTombstonedOverview(otherContext, "connector", overview).threads).toEqual([deleted]);
  client.setQueryData(key, filterSignalTombstonedOverview(context, "connector", overview));
  reconcileSignalThreads(client, context, "connector", [deleted]);
  expect(client.getQueryData<typeof overview>(key)?.threads).toEqual([]);
  clearSignalThreadTombstones(context, "connector");
  expect(filterSignalTombstonedOverview(context, "connector", overview).threads).toEqual([deleted]);
});

test("provider deletion wins over an optimistic Clear Trash rollback", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const deleted = { key: "deleted", subject: "Gone", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const key = signalQueryKeys.overview(context, "connector", "trash");
  client.setQueryData(key, { accounts: [], selectedAccount: null, threads: [deleted], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 }, nextCursor: null });
  const removal = clearSignalTrashCaches(client, context, "connector");
  tombstoneSignalThreadKeys(context, "connector", [deleted.key]);
  expect(restoreSignalTrashCaches(client, removal)).toBe(true);
  expect(client.getQueryData<{ threads: unknown[] }>(key)?.threads).toEqual([]);
  clearSignalThreadTombstones(context, "connector");
});

test("optimistically clears Trash overviews without crossing connectors", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const thread = { key: "thread", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Subject", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const overview = { accounts: [], selectedAccount: null, threads: [thread], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context, "connector", "trash"), overview);
  client.setQueryData(signalQueryKeys.detail(context, "connector", thread.key), { thread, messages: [] });
  client.setQueryData(signalQueryKeys.overview(context, "other", "trash"), overview);
  clearSignalTrashCaches(client, context, "connector");
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "connector", "trash"))).toMatchObject({ threads: [], counts: { trash: 0 } });
  expect(client.getQueryData(signalQueryKeys.detail(context, "connector", thread.key))).toEqual({ thread, messages: [] });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, "other", "trash"))?.threads).toHaveLength(1);
});

test("failed Clear Trash immediately restores its unchanged optimistic caches", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const removed = { key: "removed", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Removed", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const counts = { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 };
  const overviewKey = signalQueryKeys.overview(context, "connector", "trash");
  const detailKey = signalQueryKeys.detail(context, "connector", removed.key);
  client.setQueryData(overviewKey, { accounts: [], selectedAccount: null, threads: [removed], drafts: [], unassignedDrafts: [], counts, nextCursor: null });
  client.setQueryData(detailKey, { thread: removed, messages: [{ key: "old" }] });
  const removal = clearSignalTrashCaches(client, context, "connector");

  expect(restoreSignalTrashCaches(client, removal)).toBe(true);

  expect(client.getQueryData<{ threads: (typeof removed)[]; counts: typeof counts }>(overviewKey)).toMatchObject({ threads: [{ key: "removed" }], counts: { trash: 1 } });
  expect(client.getQueryData(detailKey)).toEqual({ thread: removed, messages: [{ key: "old" }] });
});

test("failed Clear Trash preserves newer authoritative counts and deletions", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const removed = { key: "removed", scopeKey: context.scopeKey, accountKey: "account", providerThreadId: "provider", subject: "Removed", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const counts = { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 };
  const overviewKey = signalQueryKeys.overview(context, "connector", "trash");
  const detailKey = signalQueryKeys.detail(context, "connector", removed.key);
  client.setQueryData(overviewKey, { accounts: [], selectedAccount: null, threads: [removed], drafts: [], unassignedDrafts: [], counts, nextCursor: null });
  client.setQueryData(detailKey, { thread: removed, messages: [] });
  const removal = clearSignalTrashCaches(client, context, "connector");
  client.setQueryData(overviewKey, { accounts: [], selectedAccount: null, threads: [], drafts: [], unassignedDrafts: [], counts: { ...counts, trash: 0 }, nextCursor: null });
  client.removeQueries({ queryKey: detailKey, exact: true });

  expect(restoreSignalTrashCaches(client, removal)).toBe(false);
  expect(client.getQueryData<{ threads: unknown[]; counts: typeof counts }>(overviewKey)).toMatchObject({ threads: [], counts: { trash: 0 } });
  expect(client.getQueryData(detailKey)).toBeUndefined();
});

test("successful Clear Trash removes only unchanged detail snapshots", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const removed = { key: "removed", subject: "Removed", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, createdAt: at, updatedAt: at };
  const detailKey = signalQueryKeys.detail(context, "connector", removed.key);
  client.setQueryData(detailKey, { thread: removed, messages: [] });
  const removal = clearSignalTrashCaches(client, context, "connector");
  commitSignalTrashCaches(client, removal);
  expect(client.getQueryData(detailKey)).toBeUndefined();
});

test("successful Clear Trash tombstones loaded group threads absent from caches", () => {
  const client = new QueryClient();
  const at = "2026-08-23T10:00:00.000Z";
  const uncached = { key: "uncached-trash", subject: "Uncached", summary: "Summary", intent: "Review", priority: "normal" as const, state: "filtered" as const, inboxCategory: "Filtered" as const, labels: ["TRASH"], lastMessageAt: at, isFavorite: false, isRead: true, unread: false, createdAt: at, updatedAt: at };
  const removal = clearSignalTrashCaches(client, context, "connector");
  commitSignalTrashCaches(client, removal, [uncached.key]);
  const stale = { accounts: [], selectedAccount: null, threads: [uncached], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 1 }, nextCursor: null };
  expect(filterSignalTombstonedOverview(context, "connector", stale)).toMatchObject({ threads: [], counts: { trash: 0 } });
  clearSignalThreadTombstones(context, "connector");
});

test("patches folder-like Signal inboxes and tones without crossing contexts", () => {
  const client = new QueryClient();
  const inbox = { key: "inbox", connectorKey: "connector", email: "team@example.com", name: "Team", isFavorite: false, status: "active" as const, syncEnabled: true, initialSyncCompleted: true, syncStatus: "idle" as const };
  const updatedInbox = { ...inbox, name: "Priority team", isFavorite: true };
  const first = { key: "tone", name: "Warm", instruction: "Write warmly.", isFavorite: false };
  const overview = { accounts: [inbox], tones: [first], selectedAccount: inbox, threads: [], drafts: [], unassignedDrafts: [], counts: { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0 }, nextCursor: null };
  client.setQueryData(signalQueryKeys.overview(context), overview);
  client.setQueryData(signalQueryKeys.overview(context, inbox.connectorKey), overview);
  client.setQueryData(signalQueryKeys.overview(otherContext), overview);

  patchSignalInbox(client, context, updatedInbox);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context))?.accounts).toEqual([updatedInbox]);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context, inbox.connectorKey))?.selectedAccount).toEqual(updatedInbox);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(otherContext))?.accounts).toEqual([inbox]);

  const updatedTone = { ...first, name: "Human", isFavorite: true };
  upsertSignalTone(client, context, updatedTone);
  upsertSignalTone(client, context, { ...first, key: "second" });
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(context))?.tones).toEqual([updatedTone, { ...first, key: "second" }]);
  expect(client.getQueryData<typeof overview>(signalQueryKeys.overview(otherContext))?.tones).toEqual([first]);
});

test("atomically upserts and removes Signal reply context in one exact workspace", () => {
  const client = new QueryClient();
  const first = { key: "one", name: "One", text: "First note", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
  const second = { ...first, key: "two", name: "Two" };
  client.setQueryData(signalQueryKeys.replyContexts(context), [first]);
  client.setQueryData(signalQueryKeys.replyContexts(otherContext), [first]);
  upsertSignalReplyContext(client, context, { ...first, text: "Updated" });
  upsertSignalReplyContext(client, context, second);
  removeSignalReplyContexts(client, context, [first.key]);
  expect(client.getQueryData(signalQueryKeys.replyContexts(context))).toEqual([second]);
  expect(client.getQueryData(signalQueryKeys.replyContexts(otherContext))).toEqual([first]);
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
