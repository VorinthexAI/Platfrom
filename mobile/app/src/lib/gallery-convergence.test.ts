import { expect, test } from "bun:test";
import { GalleryRefreshCoalescer, galleryRefreshPlan, isCurrentContextGeneration, mergeGalleryRefreshPlans, reconcileDestination, reconcileGalleryPermissions, reconcileGalleryState, reconcileKeys, reconcileOptimisticUploads, reconcilePaginatedKeys, reconcilePaginatedSelected, reconcileSelected, reconcileUploadJobRegistry, recoverAssistantSearchMode, recoverContextualSearchFailure, replayPaginatedWindow } from "./gallery-convergence";

test("maps audited slugs to precise cache and mode families", () => {
  expect([...galleryRefreshPlan("collection.invites.changed")]).toEqual(["collectionInvites", "incomingInvites"]);
  expect([...galleryRefreshPlan("collection.shares.changed")]).toEqual(["shares"]);
  expect([...galleryRefreshPlan("subject.changed")]).toEqual(["subjects", "search"]);
  expect(galleryRefreshPlan("image.changed")).toEqual(new Set(["current", "search", "duplicates", "subjects", "upload"]));
  expect(galleryRefreshPlan("upload.changed")).toEqual(new Set(["current", "search", "duplicates", "upload", "subjects"]));
});

test("gates network families precisely by slug", () => {
  expect([...galleryRefreshPlan("collection.index.changed")]).toEqual(["root", "access"]);
  expect([...galleryRefreshPlan("collection.content.changed")]).toEqual(["current", "search", "duplicates"]);
  expect([...galleryRefreshPlan("collection.access.changed")]).toEqual(["root", "access", "members"]);
  expect([...galleryRefreshPlan("collection.invites.changed")]).not.toContain("root");
  expect([...galleryRefreshPlan("collection.shares.changed")]).not.toContain("current");
});

test("reconnect is a complete recovery plan", () => {
  const recovery = galleryRefreshPlan("reconnect");
  for (const family of ["root", "current", "access", "members", "collectionInvites", "incomingInvites", "shares", "subjects", "search", "duplicates", "upload"] as const) expect(recovery.has(family)).toBe(true);
});

test("coalesces bursts and keeps one deferred refresh while busy", () => {
  const coordinator = new GalleryRefreshCoalescer();
  coordinator.add(galleryRefreshPlan("image.changed"));
  coordinator.add(galleryRefreshPlan("collection.shares.changed"));
  expect(coordinator.takeIfReady(true)).toBeUndefined();
  expect(coordinator.hasPending).toBe(true);
  expect(coordinator.takeIfReady(false)).toEqual(mergeGalleryRefreshPlans(galleryRefreshPlan("image.changed"), galleryRefreshPlan("collection.shares.changed")));
  expect(coordinator.hasPending).toBe(false);
});

test("reconciles selected images, detail records, and writable destinations", () => {
  expect(reconcileKeys(["gone", "kept"], ["kept", "other"])).toEqual(["kept"]);
  expect(reconcileSelected({ key: "kept", value: 1 }, [{ key: "kept", value: 2 }])).toEqual({ key: "kept", value: 2 });
  expect(reconcileSelected({ key: "gone" }, [{ key: "kept" }])).toBeUndefined();
  const collections = [{ key: "source", role: "owner", access: { canContribute: true } }, { key: "viewer", role: "viewer", access: { canContribute: true } }, { key: "target", role: "collaborator", access: { canContribute: true } }];
  expect(reconcileDestination("source", collections, "source")).toBeUndefined();
  expect(reconcileDestination("viewer", collections)).toBeUndefined();
  expect(reconcileDestination("target", collections)).toBe("target");
});

test("rejects stale destination arrays whose capabilities are missing", () => {
  expect(reconcileDestination("stale", [{ key: "stale", role: "collaborator" }])).toBeUndefined();
  expect(reconcileDestination("viewer", [{ key: "viewer", role: "viewer", access: { canContribute: true } }])).toBeUndefined();
});

test("preserves contextual mode while reconciling authoritative collection state", () => {
  const collections = [{ key: "active", role: "owner", access: { canRead: true, canContribute: true } }, { key: "target", role: "collaborator", access: { canRead: true, canContribute: true } }];
  expect(reconcileGalleryState({ mode: { kind: "similar", sourceKey: "source" }, activeCollectionKey: "active", selectedImageKeys: ["kept", "gone"], destinationCollectionKey: "target" }, collections, ["kept"])).toEqual({
    mode: { kind: "similar", sourceKey: "source" }, activeCollection: collections[0], accessLost: false, selectedImageKeys: ["kept"], destinationCollectionKey: "target",
  });
});

test("reports access loss and clears invalid state immediately", () => {
  const collections = [{ key: "viewer", role: "viewer", access: { canRead: true, canContribute: false } }];
  expect(reconcileGalleryState({ mode: "duplicates", activeCollectionKey: "removed", selectedImageKeys: ["gone"], destinationCollectionKey: "viewer" }, collections, [])).toEqual({
    mode: "duplicates", activeCollection: undefined, accessLost: true, selectedImageKeys: [], destinationCollectionKey: undefined,
  });
});

test("does not crash while reconciling an active legacy collection without access", () => {
  const legacy = { key: "active", role: "owner" };
  expect(reconcileGalleryState({ mode: "collection", activeCollectionKey: "active", selectedImageKeys: [], destinationCollectionKey: "active" }, [legacy], [])).toEqual({
    mode: "collection", activeCollection: undefined, accessLost: true, selectedImageKeys: [], destinationCollectionKey: undefined,
  });
});

test("ignores responses from an obsolete context generation", () => {
  expect(isCurrentContextGeneration(4, 4)).toBe(true);
  expect(isCurrentContextGeneration(4, 5)).toBe(false);
});

test("preserves off-page selections and detail until pagination is complete", () => {
  expect(reconcilePaginatedKeys(["first", "off-page"], ["first"], false)).toEqual(["first", "off-page"]);
  expect(reconcilePaginatedKeys(["first", "gone"], ["first"], true)).toEqual(["first"]);
  const selected = { key: "off-page", filename: "kept.jpg" };
  expect(reconcilePaginatedSelected(selected, [{ key: "first", filename: "first.jpg" }], false)).toBe(selected);
  expect(reconcilePaginatedSelected(selected, [{ key: "first", filename: "first.jpg" }], true)).toBeUndefined();
});

test("cleans restricted state after owner and contributor downgrades", () => {
  expect(reconcileGalleryPermissions({ role: "collaborator", activeSheet: "duplicates", selectedImageKeys: ["own", "other"], mutableImageKeys: ["own"], destinationCollectionKey: "target" })).toMatchObject({ activeSheet: undefined, selectedImageKeys: ["own"], closeSheet: true });
  expect(reconcileGalleryPermissions({ role: "viewer", activeSheet: "transferDestination", selectedImageKeys: ["image"], mutableImageKeys: [], destinationCollectionKey: "target" })).toEqual({ activeSheet: undefined, selectedImageKeys: [], destinationCollectionKey: undefined, closeSheet: true });
  expect(reconcileGalleryPermissions({ role: "collaborator", canContribute: false, activeSheet: "actions", selectedImageKeys: [], mutableImageKeys: [] })).toEqual({ activeSheet: undefined, selectedImageKeys: [], destinationCollectionKey: undefined, closeSheet: true });
});

test("describes clean recovery for deleted identity and similar sources", () => {
  expect(recoverContextualSearchFailure("identity")).toEqual({ mode: "identity", clearSimilar: false, clearIdentity: true, loadNormalView: true });
  expect(recoverContextualSearchFailure("similar")).toEqual({ mode: "similar", clearSimilar: true, clearIdentity: false, loadNormalView: true });
});

test("replays the loaded pagination window from page one", async () => {
  const cursors: Array<string | undefined> = [];
  const pages = new Map<string | undefined, { items: Array<{ key: string }>; nextCursor: string | null }>([
    [undefined, { items: [{ key: "a" }, { key: "b" }], nextCursor: "two" }],
    ["two", { items: [{ key: "c" }, { key: "d" }], nextCursor: "three" }],
    ["three", { items: [{ key: "e" }], nextCursor: null }],
  ]);
  const replay = await replayPaginatedWindow({ targetCount: 4, getKey: ({ key }) => key, isCurrent: () => true, fetchPage: async (cursor) => { cursors.push(cursor); const page = pages.get(cursor)!; return { page, ...page }; } });
  expect(cursors).toEqual([undefined, "two"]);
  expect(replay.items.map(({ key }) => key)).toEqual(["a", "b", "c", "d"]);
  expect(replay).toMatchObject({ cancelled: false, nextCursor: "three", reachedEnd: false });
});

test("cancels paginated replay before publishing an obsolete context", async () => {
  let current = true;
  const replay = await replayPaginatedWindow({ targetCount: 2, getKey: ({ key }: { key: string }) => key, isCurrent: () => current, fetchPage: async () => { current = false; return { page: {}, items: [{ key: "old" }], nextCursor: null }; } });
  expect(replay).toEqual({ cancelled: true, items: [], nextCursor: null, reachedEnd: false });
});

test("does not treat a covered replay window as end-of-list proof", async () => {
  const replay = await replayPaginatedWindow({ targetCount: 2, getKey: ({ key }: { key: string }) => key, isCurrent: () => true, fetchPage: async () => ({ page: {}, items: [{ key: "a" }, { key: "b" }], nextCursor: "more" }) });
  expect(replay).toMatchObject({ cancelled: false, nextCursor: "more", reachedEnd: false });
  expect(reconcilePaginatedKeys(["a", "unknown-off-page"], replay.items.map(({ key }) => key), replay.reachedEnd)).toEqual(["a", "unknown-off-page"]);
  expect(reconcilePaginatedSelected({ key: "unknown-off-page" }, replay.items, replay.reachedEnd)).toEqual({ key: "unknown-off-page" });
});

test("promotes authoritative images and retains unresolved upload placeholders", () => {
  const optimistic = [{ clientKey: "ready-client", imageKey: "ready", uri: "file://ready" }, { clientKey: "pending-client", imageKey: "pending", uri: "file://pending" }];
  const ready = { key: "ready", url: "https://images.example/ready" };
  expect(reconcileOptimisticUploads(optimistic, [ready])).toEqual({ remaining: [optimistic[1]], promoted: [{ item: optimistic[0], image: ready }] });
});

test("settles upload jobs once and retains only unresolved identities", () => {
  const jobs = [{ uploadKey: "complete", clientKey: "a" }, { uploadKey: "failed", clientKey: "b" }, { uploadKey: "working", clientKey: "c" }];
  const first = reconcileUploadJobRegistry(jobs, [{ key: "complete", status: "completed" }, { key: "failed", status: "failed" }, { key: "working", status: "processing" }]);
  expect(first.unresolved).toEqual([jobs[2]]);
  expect(first.completed.map(({ job }) => job.clientKey)).toEqual(["a"]);
  expect(first.failed.map(({ job }) => job.clientKey)).toEqual(["b"]);
  expect(reconcileUploadJobRegistry(first.unresolved, [{ key: "failed", status: "failed" }])).toEqual({ unresolved: [jobs[2]], completed: [], failed: [] });
});

test("reruns sourced assistant searches and exits unsourced legacy results", () => {
  expect(recoverAssistantSearchMode(" rainy streets ")).toEqual({ action: "rerun", query: "rainy streets" });
  expect(recoverAssistantSearchMode(undefined)).toEqual({ action: "exit" });
});
