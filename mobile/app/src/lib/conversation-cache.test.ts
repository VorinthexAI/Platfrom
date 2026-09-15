import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";

import {
  conversationAttachmentDisplayKey,
  conversationAttachmentsForRender,
  addConversationToUnfilteredLists,
  compareConversations,
  conversationListMembershipKeys,
  conversationListFilterFromKey,
  conversationMatchesFilter,
  conversationMessages,
  conversationQueryKeys,
  createLocalConversationAttachments,
  invalidateConversationSearches,
  mergeConversationMessages,
  removeConversationFromLists,
  removeConversationMessages,
  replaceConversationInMatchingLists,
  replaceTurnMessages,
  restoreConversationMessages,
  restoreConversationToLists,
  settlePendingAttachmentOverlays,
} from "./conversation-cache";

const at = "2026-09-01T10:00:00.000Z";
const context = { userKey: "user", teamKey: "team", scopeKey: "scope" };
const conversation = (key: string, input: Partial<{ name: string; isFavorite: boolean; updatedAt: string }> = {}) => ({ key, name: input.name ?? key, isFavorite: input.isFavorite ?? false, createdAt: at, updatedAt: input.updatedAt ?? at });
const infinite = (pages: ReturnType<typeof conversation>[][]) => ({ pages: pages.map((conversations, index) => ({ conversations, cursor: index < pages.length - 1 ? `cursor-${index}` : undefined })), pageParams: pages.map((_, index) => index ? `cursor-${index - 1}` : undefined) });

test("keys include full identity, normalized query, and favoriteOnly", () => {
  const key = conversationQueryKeys.list(context, { query: " Plan ", favoriteOnly: true });
  expect(key).toEqual(["conversations", "user", "team", "scope", "lists", "list", { query: "plan", favoriteOnly: true }]);
  expect(conversationListFilterFromKey(key)).toEqual({ query: "plan", favoriteOnly: true });
  expect(conversationQueryKeys.list({ ...context, userKey: "other" }, { query: " Plan ", favoriteOnly: true })).not.toEqual(key);
});

test("matches server list membership and favorite-first updatedAt ordering", () => {
  const favorite = conversation("favorite", { name: "Plan", isFavorite: true, updatedAt: "2026-09-01T09:00:00.000Z" });
  const recent = conversation("recent", { name: "Plan", updatedAt: "2026-09-01T11:00:00.000Z" });
  expect(conversationMatchesFilter(favorite, { query: "plan", favoriteOnly: true })).toBe(true);
  expect(conversationMatchesFilter(recent, { query: "plan", favoriteOnly: true })).toBe(false);
  expect([recent, favorite].sort(compareConversations).map(({ key }) => key)).toEqual(["favorite", "recent"]);
});

test("flattens multipage messages into chronological display order", () => {
  const message = (key: string) => ({ key, conversationKey: "one", turnKey: key, kind: "text" as const, role: "assistant" as const, status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: key, attachments: [], retrievals: [], createdAt: at });
  expect(conversationMessages({ pages: [{ messages: [message("latest")] }, { messages: [message("older")] }], pageParams: [undefined, "older"] }).map(({ key }) => key)).toEqual(["older", "latest"]);
});

test("optimistic create enters only eligible unfiltered lists and never search caches", () => {
  const queryClient = new QueryClient();
  const all = conversationQueryKeys.list(context, { query: "", favoriteOnly: false });
  const favorites = conversationQueryKeys.list(context, { query: "", favoriteOnly: true });
  const search = conversationQueryKeys.list(context, { query: "new", favoriteOnly: false });
  queryClient.setQueryData(all, infinite([[conversation("one")]]));
  queryClient.setQueryData(favorites, infinite([[conversation("favorite", { isFavorite: true })]]));
  queryClient.setQueryData(search, infinite([[conversation("match", { name: "New match" })]]));
  addConversationToUnfilteredLists(queryClient, context, conversation("new", { name: "New chat" }));
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(all)?.pages[0]?.conversations.map(({ key }) => key)).toEqual(["new", "one"]);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(favorites)?.pages[0]?.conversations.map(({ key }) => key)).toEqual(["favorite"]);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(search)?.pages[0]?.conversations.map(({ key }) => key)).toEqual(["match"]);
});

test("replacement preserves multipage favorite ordering without injecting absent searches", () => {
  const queryClient = new QueryClient();
  const all = conversationQueryKeys.list(context, { query: "", favoriteOnly: false });
  const search = conversationQueryKeys.list(context, { query: "plan", favoriteOnly: false });
  queryClient.setQueryData(all, infinite([[conversation("a"), conversation("b")], [conversation("c"), conversation("d")]]));
  queryClient.setQueryData(search, infinite([[conversation("a", { name: "Plan A" })]]));
  replaceConversationInMatchingLists(queryClient, context, conversation("c", { name: "Plan C", isFavorite: true, updatedAt: "2026-09-01T12:00:00.000Z" }));
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(all)?.pages.flatMap(({ conversations }) => conversations).map(({ key }) => key)).toEqual(["c", "a", "b", "d"]);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(search)?.pages[0]?.conversations.map(({ key }) => key)).toEqual(["a"]);
  replaceConversationInMatchingLists(queryClient, context, conversation("a", { name: "Renamed" }));
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(search)?.pages[0]?.conversations).toEqual([]);
});

test("remove touches only matching identity caches and clears every page", () => {
  const queryClient = new QueryClient();
  const key = conversationQueryKeys.list(context, { query: "", favoriteOnly: false });
  const other = conversationQueryKeys.list({ ...context, scopeKey: "other" }, { query: "", favoriteOnly: false });
  queryClient.setQueryData(key, infinite([[conversation("a")], [conversation("b")]]));
  queryClient.setQueryData(other, infinite([[conversation("a")]]));
  removeConversationFromLists(queryClient, context, "a");
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(key)?.pages.flatMap(({ conversations }) => conversations).map(({ key }) => key)).toEqual(["b"]);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(other)?.pages[0]?.conversations.map(({ key }) => key)).toEqual(["a"]);
});

test("restores an optimistically removed conversation only to its prior cached lists", () => {
  const queryClient = new QueryClient();
  const all = conversationQueryKeys.list(context, { query: "", favoriteOnly: false });
  const matchingSearch = conversationQueryKeys.list(context, { query: "plan", favoriteOnly: false });
  const otherSearch = conversationQueryKeys.list(context, { query: "other", favoriteOnly: false });
  const target = conversation("plan", { name: "Project plan" });
  queryClient.setQueryData(all, infinite([[target, conversation("other")]]));
  queryClient.setQueryData(matchingSearch, infinite([[target]]));
  queryClient.setQueryData(otherSearch, infinite([[conversation("other")]]));
  const memberships = conversationListMembershipKeys(queryClient, context, target.key);
  removeConversationFromLists(queryClient, context, target.key);
  restoreConversationToLists(queryClient, target, memberships);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(all)?.pages.flatMap(({ conversations }) => conversations).map(({ key }) => key)).toContain(target.key);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(matchingSearch)?.pages.flatMap(({ conversations }) => conversations).map(({ key }) => key)).toEqual([target.key]);
  expect(queryClient.getQueryData<ReturnType<typeof infinite>>(otherSearch)?.pages.flatMap(({ conversations }) => conversations).map(({ key }) => key)).toEqual(["other"]);
});

test("invalidates search caches without invalidating unfiltered lists or other identities", async () => {
  const queryClient = new QueryClient();
  const all = conversationQueryKeys.list(context, { query: "", favoriteOnly: false });
  const search = conversationQueryKeys.list(context, { query: "plan", favoriteOnly: false });
  const other = conversationQueryKeys.list({ ...context, userKey: "other" }, { query: "plan", favoriteOnly: false });
  queryClient.setQueryData(all, infinite([[conversation("a")]]));
  queryClient.setQueryData(search, infinite([[conversation("a")]]));
  queryClient.setQueryData(other, infinite([[conversation("a")]]));
  await invalidateConversationSearches(queryClient, context);
  expect(queryClient.getQueryState(all)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(search)?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
});

test("reconciles optimistic turn pairs with retained statuses and no duplicate server keys", () => {
  const optimistic = [
    { key: "optimistic-user", conversationKey: "one", turnKey: "turn", kind: "image" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: "Q", attachments: [], retrievals: [], createdAt: at, optimistic: true as const },
    { key: "optimistic-assistant", conversationKey: "one", turnKey: "turn", kind: "image" as const, role: "assistant" as const, status: "PENDING" as const, attachmentStatus: "NONE" as const, content: "Generating image...", attachments: [], retrievals: [], createdAt: at, optimistic: true as const },
  ];
  const user = { ...optimistic[0], key: "user", optimistic: undefined };
  const assistant = { ...optimistic[1], key: "assistant", status: "COMPLETED" as const, content: "A", optimistic: undefined };
  const result = replaceTurnMessages(optimistic, user, assistant, optimistic.map(({ key }) => key));
  expect(result.map(({ key, status }) => [key, status])).toEqual([["user", "COMPLETED"], ["assistant", "COMPLETED"]]);
});

test("keeps local pending turn roles through query races and does not duplicate canonical keys", () => {
  const [localAttachment] = createLocalConversationAttachments([{ clientKey: "transient-upload-key", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 42, uri: "file:///photo.png" }]);
  expect(localAttachment).toEqual({ local: true, clientKey: "transient-upload-key", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 42, uri: "file:///photo.png" });
  expect(localAttachment).not.toHaveProperty("key");
  const pending = [
    { key: "optimistic-user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "PENDING" as const, content: "Q", attachments: [localAttachment], retrievals: [], createdAt: at, optimistic: true as const },
    { key: "optimistic-assistant", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "assistant" as const, status: "PENDING" as const, attachmentStatus: "NONE" as const, content: "", attachments: [], retrievals: [], createdAt: at, optimistic: true as const },
  ];
  const raced = [
    { ...pending[0], key: "server-user", attachments: [], completedAt: at, optimistic: undefined },
    { ...pending[1], key: "server-assistant", optimistic: undefined },
  ];
  const merged = mergeConversationMessages(raced, pending);
  expect(merged.map(({ key }) => key)).toEqual(["optimistic-user", "optimistic-assistant"]);
  expect(merged[0]?.attachments).toEqual([localAttachment]);
});

test("replaces query-raced messages by turn and role with non-optimistic authoritative messages", () => {
  const raced = [
    { key: "raced-user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: "Q", attachments: [], retrievals: [], createdAt: at, optimistic: true as const },
    { key: "raced-assistant", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "assistant" as const, status: "PENDING" as const, attachmentStatus: "NONE" as const, content: "", attachments: [], retrievals: [], createdAt: at, optimistic: true as const },
  ];
  const user = { ...raced[0], key: "server-user", optimistic: undefined };
  const assistant = { ...raced[1], key: "server-assistant", status: "COMPLETED" as const, content: "A", optimistic: undefined };
  const replaced = replaceTurnMessages(raced, user, assistant, []);
  expect(replaced).toEqual([user, assistant]);
  expect(replaced.every((message) => message.optimistic === undefined)).toBe(true);
});

test("does not replace a terminal attachment version with a stale pending turn snapshot", () => {
  const attachments = [
    { key: "first", kind: "document" as const, filename: "first.pdf", mimeType: "application/pdf", sizeBytes: 10 },
    { key: "second", kind: "document" as const, filename: "second.pdf", mimeType: "application/pdf", sizeBytes: 20 },
  ];
  const terminalUser = { key: "server-user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "COMPLETED" as const, content: "Q", attachments, retrievals: [], createdAt: at, completedAt: at };
  const staleUser = { ...terminalUser, attachmentStatus: "PENDING" as const, attachments: [] };
  const assistant = { key: "server-assistant", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "assistant" as const, status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: "A", attachments: [], retrievals: [], createdAt: at, completedAt: at };
  const overlay = { ...staleUser, key: "optimistic-user", attachments: createLocalConversationAttachments(attachments.map((attachment) => ({ ...attachment, clientKey: `local-${attachment.key}`, uri: `file:///${attachment.filename}` }))), optimistic: true as const };

  const replaced = replaceTurnMessages([terminalUser], staleUser, assistant, []);
  const settled = settlePendingAttachmentOverlays(replaced, [overlay]);

  expect(replaced).toEqual([terminalUser, assistant]);
  expect(replaced[0]?.attachments.map(({ key }) => key)).toEqual(["first", "second"]);
  expect(settled).toEqual({ pendingMessages: [], settledTurnKeys: ["turn"] });
  expect(mergeConversationMessages(replaced, settled.pendingMessages)[0]?.attachments).toEqual(attachments);
});

test("retains settled attachment pills when a subsequent turn completes", () => {
  const attachments = [{ key: "document", kind: "document" as const, filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42 }];
  const firstUser = { key: "first-user", conversationKey: "one", turnKey: "first", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "COMPLETED" as const, content: "Read this", attachments, retrievals: [], createdAt: at, completedAt: at };
  const staleFirstUser = { ...firstUser, attachmentStatus: "PENDING" as const, attachments: [] };
  const firstAssistant = { key: "first-assistant", conversationKey: "one", turnKey: "first", kind: "text" as const, role: "assistant" as const, status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: "Read", attachments: [], retrievals: [], createdAt: at, completedAt: at };
  const secondOptimisticUser = { ...firstUser, key: "optimistic-second-user", turnKey: "second", content: "Follow up", attachmentStatus: "NONE" as const, attachments: [], optimistic: true as const };
  const secondOptimisticAssistant = { ...firstAssistant, key: "optimistic-second-assistant", turnKey: "second", status: "PENDING" as const, content: "", completedAt: undefined, optimistic: true as const };
  const secondUser = { ...secondOptimisticUser, key: "second-user", optimistic: undefined };
  const secondAssistant = { ...secondOptimisticAssistant, key: "second-assistant", status: "COMPLETED" as const, content: "Answer", completedAt: at, optimistic: undefined };

  const afterStaleCompletion = replaceTurnMessages([firstUser], staleFirstUser, firstAssistant, []);
  const afterSecondTurn = replaceTurnMessages([...afterStaleCompletion, secondOptimisticUser, secondOptimisticAssistant], secondUser, secondAssistant, [secondOptimisticUser.key, secondOptimisticAssistant.key]);

  expect(afterSecondTurn.map(({ key }) => key)).toEqual(["first-user", "first-assistant", "second-user", "second-assistant"]);
  expect(afterSecondTurn[0]).toMatchObject({ attachmentStatus: "COMPLETED", attachments });
});

test("retains rendered file pills across an empty pending snapshot", () => {
  const [local] = createLocalConversationAttachments([{ clientKey: "local-document", kind: "document", filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42, uri: "file:///brief.pdf" }]);
  const pending = { attachments: [], attachmentStatus: "PENDING" as const };
  const durable = { attachments: [{ key: "document", displayKey: "local-document", kind: "document" as const, filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42 }], attachmentStatus: "COMPLETED" as const };

  expect(conversationAttachmentsForRender([local], pending)).toEqual([local]);
  expect(conversationAttachmentsForRender([local], durable)).toEqual(durable.attachments);
  expect(conversationAttachmentsForRender([local], { attachments: [], attachmentStatus: "FAILED" })).toEqual([]);
});

test("retains the local preview until durable attachment media is preloaded", () => {
  const local = {
    key: "optimistic-user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const,
    attachmentStatus: "PENDING" as const, content: "Q", attachments: createLocalConversationAttachments([{ clientKey: "local", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 42, uri: "file:///photo.png" }]), retrievals: [], createdAt: at, optimistic: true as const,
  };
  const durable = {
    ...local, key: "server-user", attachmentStatus: "COMPLETED" as const, attachments: [{ key: "image-key", displayKey: "local", kind: "image" as const, filename: "photo.png", mimeType: "image/png" as const, sizeBytes: 42, width: 10, height: 10 }], completedAt: at, optimistic: undefined,
  };
  expect(mergeConversationMessages([durable], [local])).toEqual([local]);
  expect(conversationAttachmentDisplayKey(local.attachments[0]!)).toBe("local");
  expect(conversationAttachmentDisplayKey(durable.attachments[0]!)).toBe("local");
  expect(conversationAttachmentDisplayKey({ ...durable.attachments[0]!, displayKey: undefined })).toBe("image-key");
});

test("retains local attachment overlays while authoritative persistence is pending", () => {
  const [attachment] = createLocalConversationAttachments([{ clientKey: "local", kind: "document", filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42, uri: "file:///brief.pdf" }]);
  const overlay = { key: "user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "PENDING" as const, content: "Q", attachments: [attachment], retrievals: [], createdAt: at, optimistic: true as const };
  const authoritative = { ...overlay, attachments: [], completedAt: at, optimistic: undefined };
  const result = settlePendingAttachmentOverlays([authoritative], [overlay]);
  expect(result.pendingMessages).toEqual([overlay]);
  expect(result.settledTurnKeys).toEqual([]);
});

test.each(["COMPLETED", "PARTIAL", "FAILED"] as const)("settles local overlays only after authoritative attachment status %s", (attachmentStatus) => {
  const [attachment] = createLocalConversationAttachments([{ clientKey: "local", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 42, uri: "file:///photo.png" }]);
  const overlay = { key: "user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const, attachmentStatus: "PENDING" as const, content: "Q", attachments: [attachment], retrievals: [], createdAt: at, optimistic: true as const };
  const durableAttachments = attachmentStatus === "FAILED" ? [] : [{ key: "document", kind: "document" as const, filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 42 }];
  const authoritative = { ...overlay, attachmentStatus, attachments: durableAttachments, completedAt: at, optimistic: undefined };
  const ordinaryPending = { ...overlay, key: "ordinary", turnKey: "ordinary", attachmentStatus: "NONE" as const, attachments: [] };
  const result = settlePendingAttachmentOverlays([authoritative], [overlay, ordinaryPending]);
  expect(result.pendingMessages).toEqual([ordinaryPending]);
  expect(result.settledTurnKeys).toEqual(["turn"]);
  expect(mergeConversationMessages([authoritative], result.pendingMessages)[0]?.attachments).toEqual(durableAttachments);
});

test("removes a complete turn and restores only its missing messages after concurrent cache updates", () => {
  const message = (key: string, turnKey: string, createdAt: string) => ({
    key, conversationKey: "one", turnKey, kind: "text" as const, role: key.endsWith("user") ? "user" as const : "assistant" as const,
    status: "COMPLETED" as const, attachmentStatus: "NONE" as const, content: key, attachments: [], retrievals: [], guideTopics: { status: "NONE" as const }, createdAt, completedAt: createdAt,
  });
  const firstUser = message("a-user", "first", "2026-01-01T00:00:00.000Z");
  const firstAssistant = message("b-assistant", "first", "2026-01-01T00:00:01.000Z");
  const secondUser = message("c-user", "second", "2026-01-01T00:00:02.000Z");
  const data = { pages: [{ messages: [firstUser, firstAssistant, secondUser], cursor: undefined }], pageParams: [undefined] };

  const optimistic = removeConversationMessages(data, ({ turnKey }) => turnKey === "first");
  expect(optimistic.data?.pages[0]?.messages.map(({ key }) => key)).toEqual(["c-user"]);

  const concurrent = message("d-assistant", "second", "2026-01-01T00:00:03.000Z");
  const changed = { ...optimistic.data!, pages: [{ ...optimistic.data!.pages[0]!, messages: [...optimistic.data!.pages[0]!.messages, concurrent] }] };
  const restored = restoreConversationMessages(changed, optimistic.removed);
  expect(restored?.pages[0]?.messages.map(({ key }) => key)).toEqual(["a-user", "b-assistant", "c-user", "d-assistant"]);
});
