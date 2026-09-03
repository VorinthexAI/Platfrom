import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";

import {
  addConversationToUnfilteredLists,
  compareConversations,
  conversationListFilterFromKey,
  conversationMatchesFilter,
  conversationMessages,
  conversationQueryKeys,
  invalidateConversationSearches,
  removeConversationFromLists,
  replaceConversationInMatchingLists,
  replaceTurnMessages,
} from "./conversation-cache";

const at = "2026-09-01T10:00:00.000Z";
const context = { userKey: "user", organizationKey: "org", scopeKey: "scope" };
const conversation = (key: string, input: Partial<{ name: string; isFavorite: boolean; updatedAt: string }> = {}) => ({ key, name: input.name ?? key, isFavorite: input.isFavorite ?? false, createdAt: at, updatedAt: input.updatedAt ?? at });
const infinite = (pages: ReturnType<typeof conversation>[][]) => ({ pages: pages.map((conversations, index) => ({ conversations, cursor: index < pages.length - 1 ? `cursor-${index}` : undefined })), pageParams: pages.map((_, index) => index ? `cursor-${index - 1}` : undefined) });

test("keys include full identity, normalized query, and favoriteOnly", () => {
  const key = conversationQueryKeys.list(context, { query: " Plan ", favoriteOnly: true });
  expect(key).toEqual(["conversations", "user", "org", "scope", "lists", "list", { query: "plan", favoriteOnly: true }]);
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
  const message = (key: string) => ({ key, conversationKey: "one", turnKey: key, kind: "text" as const, role: "assistant" as const, status: "COMPLETED" as const, content: key, retrievals: [], createdAt: at });
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
    { key: "optimistic-user", conversationKey: "one", turnKey: "turn", kind: "image" as const, role: "user" as const, status: "COMPLETED" as const, content: "Q", retrievals: [], createdAt: at, optimistic: true as const },
    { key: "optimistic-assistant", conversationKey: "one", turnKey: "turn", kind: "image" as const, role: "assistant" as const, status: "PENDING" as const, content: "Generating image...", retrievals: [], createdAt: at, optimistic: true as const },
  ];
  const user = { ...optimistic[0], key: "user", optimistic: undefined };
  const assistant = { ...optimistic[1], key: "assistant", status: "COMPLETED" as const, content: "A", optimistic: undefined };
  const result = replaceTurnMessages(optimistic, user, assistant, optimistic.map(({ key }) => key));
  expect(result.map(({ key, status }) => [key, status])).toEqual([["user", "COMPLETED"], ["assistant", "COMPLETED"]]);
});
