"use client";

// Client-side wiring for a single chat thread route
// (`src/app/console/(chat)/c/[threadId]/page.tsx`, a Server Component,
// renders this). Combines:
//   - `useConsoleChat` (live streaming messages + §7.8's id reconciliation)
//   - `useChatHistory` (older-message pagination, seeded with the same first
//     page the server already fetched, so it never re-fetches page one)
// into the single `messages` array `ChatMessageList` expects.
import { useCallback, useMemo } from "react";
import { useConsoleChat } from "./use-console-chat";
import { useChatHistory } from "./data/use-chat-history";
import { ChatMessageList } from "./chat-message-list";
import type { ChatHistoryPage } from "./data/chat-api";
import type { ChatMessage } from "./types";

export type ChatThreadViewProps = {
  /** "new" sentinel or a real thread id (§7.2). */
  threadId: string;
  initialMessages: ChatMessage[];
  initialNextCursor: string | null;
};

export function ChatThreadView({ threadId, initialMessages, initialNextCursor }: ChatThreadViewProps) {
  const { messages, status, resolvedThreadId } = useConsoleChat(threadId, { initialMessages });

  // Seeded once as the first page of `useChatHistory`'s infinite query —
  // `useConsoleChat` already owns rendering of this same content via its
  // live `messages` array, so `useChatHistory` here is only ever asked for
  // pages *beyond* this seed (i.e. genuinely older history).
  const initialPage = useMemo<ChatHistoryPage>(
    () => ({ messages: initialMessages, nextCursor: initialNextCursor }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally captured once
    [],
  );

  const history = useChatHistory(resolvedThreadId, { initialPage });

  const olderMessages = useMemo(() => {
    const olderPages = history.data?.pages.slice(1) ?? [];
    // Pages arrive newest-of-the-old -> oldest as `fetchNextPage` is called
    // repeatedly; reverse to get oldest-first before prepending.
    return [...olderPages].reverse().flatMap((page) => page.messages);
  }, [history.data]);

  const loadOlder = useCallback(async () => {
    if (history.hasNextPage && !history.isFetchingNextPage) {
      await history.fetchNextPage();
    }
  }, [history]);

  const allMessages = useMemo(() => [...olderMessages, ...messages], [olderMessages, messages]);
  const isStreaming = status === "streaming" || status === "submitted";

  return (
    <ChatMessageList
      threadId={resolvedThreadId}
      messages={allMessages}
      isStreaming={isStreaming}
      onLoadOlder={loadOlder}
      hasOlder={history.hasNextPage ?? false}
    />
  );
}
