"use client";

// neural-map.md §34.5 — older-message pagination for a thread. The initial
// page is seeded via `initialPage` (the same page the Server Component
// fetched for TTFB, per §7.2), so this hook only ever does network work when
// the user actually scrolls up for more history.
import { useInfiniteQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { isRetryableError } from "@/lib/is-retryable-error";
import { fetchChatMessagesPage, type ChatHistoryPage } from "./chat-api";

export function useChatHistory(threadId: string, options?: { initialPage?: ChatHistoryPage }) {
  return useInfiniteQuery({
    queryKey: queryKeys.chatMessages(threadId),
    queryFn: ({ pageParam }) => fetchChatMessagesPage(threadId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialData: options?.initialPage
      ? { pages: [options.initialPage], pageParams: [undefined] }
      : undefined,
    staleTime: 30_000,
    enabled: threadId !== "new",
    retry: (failureCount, error) => failureCount < 2 && isRetryableError(error),
  });
}
