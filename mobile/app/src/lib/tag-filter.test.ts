import { beforeEach, expect, mock, test } from "bun:test";

const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
const runtime = globalThis as typeof globalThis & { __tagPost?: (url: string, body: Record<string, unknown>) => Promise<unknown>; __tagUUID?: string };

mock.module("@/lib/api-client", () => ({ apiClient: { post: (url: string, body: Record<string, unknown>) => runtime.__tagPost?.(url, body) } }));
mock.module("expo-crypto", () => ({ randomUUID: () => runtime.__tagUUID ?? "12345678-1234-4123-8123-123456789abc" }));

const scopeKey = "cmrnlzf640001qc7kazsr96k5";
const firstTagKey = "cmrnlzf650002qc7k4p5zem0w";
const secondTagKey = "cmrnlzf650002qc7k4p5zem1x";
const context = { userKey: "user", organizationKey: "organization", scopeKey };

beforeEach(() => { calls.length = 0; runtime.__tagUUID = "12345678-1234-4123-8123-123456789abc"; });

test("creates a final resource tag key and sends the strict create payload", async () => {
  runtime.__tagPost = async (url, body) => {
    calls.push({ url, body });
    return { data: { success: true, data: { key: body.key, name: body.name, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" } } };
  };
  const { createResourceTagKey, createScopeTag } = await import("./tag-client");
  const key = createResourceTagKey();
  expect(key).toBe("c12345678123441238123123456789abc");
  await expect(createScopeTag(context, { key, name: "Work" })).resolves.toMatchObject({ key, name: "Work" });
  expect(calls).toEqual([{ url: "/tags", body: { organizationKey: "organization", scopeKey, key, name: "Work" } }]);
});

test("rejects malformed create envelopes", async () => {
  runtime.__tagPost = async () => ({ data: { success: true, data: { key: "c12345678123441238123123456789abc", name: "Work", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z", private: true } } });
  const { createScopeTag } = await import("./tag-client");
  await expect(createScopeTag(context, { key: "c12345678123441238123123456789abc", name: "Work" })).rejects.toThrow();
});

test("retries an ambiguous tag create timeout with the same final key", async () => {
  let attempts = 0;
  runtime.__tagPost = async (_url, body) => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("timeout"), { code: "ECONNABORTED" });
    return { data: { success: true, data: { key: body.key, name: body.name, createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" } } };
  };
  const { createScopeTag } = await import("./tag-client");
  const key = "c12345678123441238123123456789abc";
  await expect(createScopeTag(context, { key, name: "Work" })).resolves.toMatchObject({ key, name: "Work" });
  expect(attempts).toBe(2);
});

test("loads every private scope tag page with strict context", async () => {
  runtime.__tagPost = async (url, body) => {
    calls.push({ url, body });
    const cursor = body.cursor;
    return { data: { success: true, data: { items: [{ key: cursor ? secondTagKey : firstTagKey, name: cursor ? "Priority" : "Work", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" }], nextCursor: cursor ? null : "next" } } };
  };
  const { listScopeTags, tagFilterContextKey } = await import("./tag-client");
  await expect(listScopeTags(context)).resolves.toMatchObject([{ key: firstTagKey, name: "Work" }, { key: secondTagKey, name: "Priority" }]);
  expect(calls).toEqual([
    { url: "/tags/list", body: { organizationKey: "organization", scopeKey, limit: 100 } },
    { url: "/tags/list", body: { organizationKey: "organization", scopeKey, limit: 100, cursor: "next" } },
  ]);
  expect(tagFilterContextKey(context)).toBe(`user:organization:${scopeKey}`);
});

test("keeps selected filters in session memory and isolates contexts", async () => {
  const { useUiStore } = await import("@/state/ui");
  useUiStore.getState().setSelectedTags("first", [{ key: "tag-1", name: "Work" }, { key: "tag-2", name: "Priority" }]);
  useUiStore.getState().setSelectedTags("second", [{ key: "tag-3", name: "Travel" }]);
  useUiStore.getState().removeSelectedTag("first", "tag-1");
  expect(useUiStore.getState().selectedTagsByContext).toMatchObject({ first: [{ key: "tag-2", name: "Priority" }], second: [{ key: "tag-3", name: "Travel" }] });
  useUiStore.getState().setSelectedTags("first", []);
  useUiStore.getState().setSelectedTags("second", []);
});

test("uses the full-screen refreshed tag sheet and removable horizontal lane", async () => {
  const sheet = await Bun.file(new URL("../components/TagFilterSheet.tsx", import.meta.url)).text();
  const lane = await Bun.file(new URL("../components/TagFilterLane.tsx", import.meta.url)).text();
  expect(sheet).toContain("refreshScopeTags(queryClient,");
  expect(sheet).not.toContain("}, [context, open");
  expect(sheet).toContain('height="full" onOpenChange');
  expect(sheet).not.toContain("hideCloseButton");
  expect(sheet).toContain("Array.from({ length: 3 }");
  expect(sheet).toContain('variant="primary">Filter</Button>');
  expect(sheet).toContain('variant="secondary">Close</Button>');
  expect(lane).toContain("horizontal");
  expect(lane).toContain("removeSelectedTag(contextKey, tag.key)");
});

test("validates and normalizes every canonical resource tag target", async () => {
  const { normalizeResourceTagTargets, resourceTagTargetSchema } = await import("./tag-client");
  const types = ["folder", "document", "image-collection", "image", "image-highlight", "image-memory", "place", "trip", "email-inbox", "email-tone", "email-thread", "email-message", "email-draft", "book"];
  for (const type of types) expect(resourceTagTargetSchema.parse({ type, key: "clzzzzzzzzzzzzzzzzzzzzzzz" })).toEqual({ type, key: "clzzzzzzzzzzzzzzzzzzzzzzz" });
  expect(() => resourceTagTargetSchema.parse({ type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzzz", extra: true })).toThrow();
  expect(normalizeResourceTagTargets([
    { type: "image", key: "clzzzzzzzzzzzzzzzzzzzzzz2" },
    { type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzz1" },
    { type: "image", key: "clzzzzzzzzzzzzzzzzzzzzzz2" },
  ])).toEqual([
    { type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzz1" },
    { type: "image", key: "clzzzzzzzzzzzzzzzzzzzzzz2" },
  ]);
});

test("loads assignment slices for every tag page and combines complete target state", async () => {
  runtime.__tagPost = async (url, body) => {
    calls.push({ url, body });
    const second = Boolean(body.cursor);
    return { data: { success: true, data: {
      items: [{ key: second ? "clzzzzzzzzzzzzzzzzzzzzzt2" : "clzzzzzzzzzzzzzzzzzzzzzt1", name: second ? "Later" : "First", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" }],
      nextCursor: second ? null : "next",
      targetAssignments: [{ target: { type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzd1" }, tagKeys: [second ? "clzzzzzzzzzzzzzzzzzzzzzt2" : "clzzzzzzzzzzzzzzzzzzzzzt1"] }],
    } } };
  };
  const { listResourceTagAssignments } = await import("./tag-client");
  await expect(listResourceTagAssignments(context, [{ type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzd1" }])).resolves.toMatchObject({
    tags: [{ key: "clzzzzzzzzzzzzzzzzzzzzzt1" }, { key: "clzzzzzzzzzzzzzzzzzzzzzt2" }],
    tagKeysByTarget: { "document:clzzzzzzzzzzzzzzzzzzzzzd1": ["clzzzzzzzzzzzzzzzzzzzzzt1", "clzzzzzzzzzzzzzzzzzzzzzt2"] },
  });
  expect(calls[0]?.body).toMatchObject({ organizationKey: "organization", scopeKey, targets: [{ type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzd1" }] });
});

test("rejects assignment responses that omit the requested target overlay", async () => {
  runtime.__tagPost = async () => ({ data: { success: true, data: { items: [], nextCursor: null } } });
  const { listResourceTagAssignments } = await import("./tag-client");
  await expect(listResourceTagAssignments(context, [{ type: "document", key: "clzzzzzzzzzzzzzzzzzzzzzd1" }])).rejects.toThrow("Tag assignments could not be loaded.");
});

test("groups assignment payloads below 100 tuples and keeps actions separate", async () => {
  const { groupResourceTagAssignmentRequests } = await import("./tag-client");
  const targets = Array.from({ length: 51 }, (_, index) => ({ type: "document" as const, key: `cl${String(index).padStart(23, "0")}` }));
  const requests = groupResourceTagAssignmentRequests(targets, { clzzzzzzzzzzzzzzzzzzzzzt1: "tag", clzzzzzzzzzzzzzzzzzzzzzt2: "tag", clzzzzzzzzzzzzzzzzzzzzzt3: "untag" });
  expect(requests.every(({ targets: chunkTargets, tagKeys }) => chunkTargets.length * tagKeys.length <= 100)).toBe(true);
  expect(requests.filter(({ action }) => action === "tag").length).toBe(2);
  expect(requests.filter(({ action }) => action === "untag").length).toBe(1);
});

test("uses a stable exact batch key and persists canonical assignment payloads", async () => {
  runtime.__tagPost = async (url, body) => { calls.push({ url, body }); return { data: { success: true, data: {} } }; };
  const { persistResourceTagAssignments } = await import("./tag-client");
  const { resourceTagAssignmentsQueryKey } = await import("./tag-query-cache");
  const first = { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd1" };
  const second = { type: "image" as const, key: "clzzzzzzzzzzzzzzzzzzzzzi1" };
  expect(resourceTagAssignmentsQueryKey(context, [second, first, second])).toEqual(resourceTagAssignmentsQueryKey(context, [first, second]));
  expect(resourceTagAssignmentsQueryKey(context, [first])).toEqual(["resource-tag-assignments", "user", "organization", scopeKey, [`document:${first.key}`]]);
  await persistResourceTagAssignments(context, [{ action: "tag", targets: [first], tagKeys: ["clzzzzzzzzzzzzzzzzzzzzzt1"] }]);
  expect(calls).toEqual([{ url: "/tags/assignments?action=tag", body: { organizationKey: "organization", scopeKey, targets: [first], tagKeys: ["clzzzzzzzzzzzzzzzzzzzzzt1"] } }]);
});

test("waits for every assignment chunk before reporting a partial failure", async () => {
  let release: (() => void) | undefined;
  runtime.__tagPost = async (url) => {
    if (url.endsWith("=tag")) throw new Error("tag failed");
    await new Promise<void>((resolve) => { release = resolve; });
    return { data: { success: true, data: {} } };
  };
  const { persistResourceTagAssignments } = await import("./tag-client");
  const target = { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd1" };
  let settled = false;
  const pending = persistResourceTagAssignments(context, [
    { action: "tag", targets: [target], tagKeys: ["clzzzzzzzzzzzzzzzzzzzzzt1"] },
    { action: "untag", targets: [target], tagKeys: ["clzzzzzzzzzzzzzzzzzzzzzt2"] },
  ]).finally(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  release?.();
  await expect(pending).rejects.toThrow("tag failed");
});

test("tri-state draft operations preserve untouched mixed assignments", async () => {
  const { applyResourceTagDraft, resourceTagState, toggleResourceTagDraft } = await import("./tag-query-cache");
  const targets = [{ type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd1" }, { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd2" }];
  const state = { tags: [], tagKeysByTarget: { [`document:${targets[0].key}`]: ["tag-1", "untouched"], [`document:${targets[1].key}`]: ["untouched"] } };
  expect(resourceTagState(state, targets, "tag-1")).toBe("some");
  expect(applyResourceTagDraft(state, targets, {})).toEqual(state);
  const add = toggleResourceTagDraft({}, state, targets, "tag-1");
  expect(add).toEqual({ "tag-1": "tag" });
  expect(resourceTagState(state, targets, "tag-1", add)).toBe("all");
  expect(toggleResourceTagDraft(add, state, targets, "tag-1")).toEqual({ "tag-1": "untag" });
});

test("applies one Archive tag operation to mixed folder, document, and file selections", async () => {
  const { groupResourceTagAssignmentRequests } = await import("./tag-client");
  const { applyResourceTagDraft, resourceTagState, toggleResourceTagDraft } = await import("./tag-query-cache");
  const folder = { type: "folder" as const, key: "clzzzzzzzzzzzzzzzzzzzzzf1" };
  const authoredDocument = { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd1" };
  const uploadedFile = { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd2" };
  const targets = [folder, authoredDocument, uploadedFile];
  const state = { tags: [], tagKeysByTarget: {
    [`folder:${folder.key}`]: ["clzzzzzzzzzzzzzzzzzzzzzt1"],
    [`document:${authoredDocument.key}`]: [],
    [`document:${uploadedFile.key}`]: ["clzzzzzzzzzzzzzzzzzzzzzt1"],
  } };
  const draft = toggleResourceTagDraft({}, state, targets, "clzzzzzzzzzzzzzzzzzzzzzt1");
  expect(resourceTagState(state, targets, "clzzzzzzzzzzzzzzzzzzzzzt1", draft)).toBe("all");
  expect(Object.values(applyResourceTagDraft(state, targets, draft).tagKeysByTarget).every((tagKeys) => tagKeys.includes("clzzzzzzzzzzzzzzzzzzzzzt1"))).toBe(true);
  expect(groupResourceTagAssignmentRequests(targets, draft)).toEqual([{ action: "tag", targets: [authoredDocument, uploadedFile, folder], tagKeys: ["clzzzzzzzzzzzzzzzzzzzzzt1"] }]);
});

test("applies multiple tag changes across heterogeneous targets without changing untouched mixed tags", async () => {
  const { groupResourceTagAssignmentRequests, resourceTagTargetIdentity } = await import("./tag-client");
  const { applyResourceTagDraft, resourceTagState } = await import("./tag-query-cache");
  const folder = { type: "folder" as const, key: "clzzzzzzzzzzzzzzzzzzzzzf1" };
  const document = { type: "document" as const, key: "clzzzzzzzzzzzzzzzzzzzzzd1" };
  const image = { type: "image" as const, key: "clzzzzzzzzzzzzzzzzzzzzzi1" };
  const targets = [folder, document, image];
  const addKey = "clzzzzzzzzzzzzzzzzzzzzzt1", removeKey = "clzzzzzzzzzzzzzzzzzzzzzt2", untouchedKey = "clzzzzzzzzzzzzzzzzzzzzzt3";
  const state = { tags: [], tagKeysByTarget: {
    [resourceTagTargetIdentity(folder)]: [addKey, removeKey, untouchedKey],
    [resourceTagTargetIdentity(document)]: [removeKey],
    [resourceTagTargetIdentity(image)]: [removeKey, untouchedKey],
  } };
  expect(resourceTagState(state, targets, addKey)).toBe("some");
  expect(resourceTagState(state, targets, removeKey)).toBe("all");
  expect(resourceTagState(state, targets, untouchedKey)).toBe("some");
  const draft = { [addKey]: "tag" as const, [removeKey]: "untag" as const };
  expect(applyResourceTagDraft(state, targets, draft).tagKeysByTarget).toEqual({
    [resourceTagTargetIdentity(folder)]: [addKey, untouchedKey],
    [resourceTagTargetIdentity(document)]: [addKey],
    [resourceTagTargetIdentity(image)]: [addKey, untouchedKey],
  });
  expect(groupResourceTagAssignmentRequests(targets, draft)).toEqual([
    { action: "tag", targets: [document, folder, image], tagKeys: [addKey] },
    { action: "untag", targets: [document, folder, image], tagKeys: [removeKey] },
  ]);
});

test("resource tags sheet has optimistic close and tri-state UI contracts", async () => {
  const sheet = await Bun.file(new URL("../components/ResourceTagsSheet.tsx", import.meta.url)).text();
  expect(sheet).toContain("queryClient.setQueryData(queryKey, optimistic);\n    onClose();");
  expect(sheet.indexOf("onClose();")).toBeLessThan(sheet.indexOf("await persistResourceTagAssignments"));
  expect(sheet).toContain("let baseline = resolved.failedKeys.reduce(removeResourceTag, previous);");
  expect(sheet).toContain('height="full" onOpenChange');
  expect(sheet).not.toContain("hideCloseButton");
  expect(sheet).toContain("Array.from({ length: 3 }");
  expect(sheet).toContain('mixed={tagState === "some"}');
  expect(sheet).toContain(">No tags yet.</Text>");
  expect(sheet).toContain('onPress={draftChanged ? apply : openCreate} size="md" variant="primary">{draftChanged ? "Apply" : "Create tag"}</Button>');
  expect(sheet).toContain('open={open && createOpen} title="Create tag"');
  expect(sheet).toContain('autoFocusInBottomSheet={false}');
  expect(sheet).toContain('setTimeout(() => createInputRef.current?.focus(), 300)');
  expect(sheet).toContain('placeholder="Tag name"');
  expect(sheet).toContain('closeCreate();\n    setState((current) => current ? appendResourceTag(current, optimisticTag) : current);');
  expect(sheet.indexOf("await resolvePendingResourceTagDraft")).toBeLessThan(sheet.indexOf("persistResourceTagAssignments(context, requests)"));
  expect(sheet).not.toContain("isPending");
  expect(sheet).not.toContain("loading={");
});

test("pending creates settle before assignment drafts and failed tags are removed cleanly", async () => {
  const { appendResourceTag, removeResourceTag, replaceResourceTag, resolvePendingResourceTagDraft } = await import("./tag-client");
  let release: ((succeeded: boolean) => void) | undefined;
  const creation = new Promise<boolean>((resolve) => { release = resolve; });
  let settled = false;
  const resolving = resolvePendingResourceTagDraft({ existing: "tag", pending: "tag" }, new Map([["pending", creation]])).then((result) => { settled = true; return result; });
  await Promise.resolve();
  expect(settled).toBe(false);
  release?.(false);
  await expect(resolving).resolves.toEqual({ draft: { existing: "tag" }, failedKeys: ["pending"] });

  await expect(resolvePendingResourceTagDraft({ existing: "tag" }, new Map([["unrelated", Promise.resolve(false)]]))).resolves.toEqual({ draft: { existing: "tag" }, failedKeys: [] });

  const optimistic = appendResourceTag({ tags: [], tagKeysByTarget: { target: ["pending", "existing"] } }, { key: "pending", name: "New", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z" });
  expect(removeResourceTag(optimistic, "pending")).toEqual({ tags: [], tagKeysByTarget: { target: ["existing"] } });
  expect(replaceResourceTag({ tags: [], tagKeysByTarget: {} }, optimistic.tags[0]!).tags).toEqual(optimistic.tags);
});
