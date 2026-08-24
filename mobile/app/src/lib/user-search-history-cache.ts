import type { QueryClient } from "@tanstack/react-query";

import { listContentSearchHistory, type ContentContext, type ContentSearchHistoryItem } from "./content-client";
import { userSearchHistoryQueryKey } from "./user-search-history-events";

export { userSearchHistoryQueryKey } from "./user-search-history-events";

export function getUserSearchHistory(queryClient: QueryClient, context: ContentContext) {
  return queryClient.fetchQuery({
    queryKey: userSearchHistoryQueryKey(context.userKey),
    queryFn: () => listContentSearchHistory(context),
    staleTime: Infinity,
  });
}

export function promoteCachedUserSearchHistory(queryClient: QueryClient, context: ContentContext, item: ContentSearchHistoryItem) {
  const key = userSearchHistoryQueryKey(context.userKey);
  const previous = queryClient.getQueryData<ContentSearchHistoryItem[]>(key) ?? [];
  const promoted = { ...item, usageCount: item.usageCount + 1, searchedAt: new Date().toISOString() };
  queryClient.setQueryData<ContentSearchHistoryItem[]>(key, [promoted, ...previous.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
  return promoted;
}

export function removeCachedUserSearchHistory(queryClient: QueryClient, context: ContentContext, normalizedQuery: string) {
  const key = userSearchHistoryQueryKey(context.userKey);
  const previous = queryClient.getQueryData<ContentSearchHistoryItem[]>(key) ?? [];
  queryClient.setQueryData<ContentSearchHistoryItem[]>(key, previous.filter((item) => item.normalizedQuery !== normalizedQuery));
  return previous;
}
