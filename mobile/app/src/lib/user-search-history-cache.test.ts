import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import type { ContentSearchHistoryItem } from "./content-client";
import { promoteCachedUserSearchHistory, removeCachedUserSearchHistory } from "./user-search-history-cache";
import { publishUserSearchHistoryAppend, subscribeUserSearchHistoryAppends, userSearchHistoryQueryKey } from "./user-search-history-events";

test("uses one per-user search history key across every workspace", () => {
  expect(userSearchHistoryQueryKey("user-key")).toEqual(["user-searches", "user-key"]);
  expect(userSearchHistoryQueryKey("user-key")).not.toEqual(userSearchHistoryQueryKey("other-user"));
});

test("publishes successful history appends to every active cache observer", () => {
  const received: string[] = [];
  const unsubscribe = subscribeUserSearchHistoryAppends((userKey) => received.push(userKey));
  publishUserSearchHistoryAppend("");
  publishUserSearchHistoryAppend("user-key");
  unsubscribe();
  publishUserSearchHistoryAppend("ignored-user");
  expect(received).toEqual(["user-key"]);
});

test("optimistically promotes and removes entries in the singleton cache", () => {
  const client = new QueryClient();
  const context = { userKey: "user-key", organizationKey: "organization", scopeKey: "scope" };
  const older: ContentSearchHistoryItem = { query: "older", normalizedQuery: "older", searchedAt: "2026-08-10T00:00:00.000Z", usageCount: 1 };
  const selected: ContentSearchHistoryItem = { query: "roadmap", normalizedQuery: "roadmap", searchedAt: "2026-08-11T00:00:00.000Z", usageCount: 3 };
  const key = userSearchHistoryQueryKey(context.userKey);
  client.setQueryData(key, [older, selected]);

  expect(promoteCachedUserSearchHistory(client, context, selected).usageCount).toBe(4);
  expect(client.getQueryData<ContentSearchHistoryItem[]>(key)?.map(({ normalizedQuery, usageCount }) => ({ normalizedQuery, usageCount }))).toEqual([{ normalizedQuery: "roadmap", usageCount: 4 }, { normalizedQuery: "older", usageCount: 1 }]);
  expect(removeCachedUserSearchHistory(client, context, "roadmap")).toHaveLength(2);
  expect(client.getQueryData(key)).toEqual([older]);
});
