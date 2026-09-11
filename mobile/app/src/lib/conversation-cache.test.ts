import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";

import {
  addConversationToUnfilteredLists,
  compareConversations,
  conversationListFilterFromKey,
  conversationMatchesFilter,
  conversationMessages,
  conversationQueryKeys,
  createLocalConversationAttachments,
  invalidateConversationSearches,
  mergeConversationMessages,
  removeConversationFromLists,
  replaceConversationInMatchingLists,
  replaceTurnMessages,
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

test("retains the local preview until durable attachment media is preloaded", () => {
  const local = {
    key: "optimistic-user", conversationKey: "one", turnKey: "turn", kind: "text" as const, role: "user" as const, status: "COMPLETED" as const,
    attachmentStatus: "PENDING" as const, content: "Q", attachments: createLocalConversationAttachments([{ clientKey: "local", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 42, uri: "file:///photo.png" }]), retrievals: [], createdAt: at, optimistic: true as const,
  };
  const durable = {
    ...local, key: "server-user", attachmentStatus: "COMPLETED" as const, attachments: [{ key: "image-key", kind: "image" as const, filename: "photo.png", mimeType: "image/png" as const, sizeBytes: 42, width: 10, height: 10 }], completedAt: at, optimistic: undefined,
  };
  expect(mergeConversationMessages([durable], [local])).toEqual([local]);
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
