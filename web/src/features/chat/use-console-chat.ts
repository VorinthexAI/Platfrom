"use client";

// neural-map.md §7.3 — thin wrapper around `@ai-sdk/react`'s `useChat`,
// transport pointed at our own `/api/chat` proxy route. Also owns the
// optimistic thread-id reconciliation contract from §7.8:
//
//  - While `threadId === "new"`, a local id (`local-<uuid>`) is minted once
//    and used as the *stable* `useChat({id})` instance id for the lifetime
//    of this hook instance. `useChat`'s `id` must never change mid-session —
//    changing it creates a brand-new Chat instance and would wipe an
//    in-flight stream — so the sentinel "new" -> real-id transition is
//    handled entirely out of band from that `id`.
//  - The real id is discovered from the `X-Thread-Id` response header
//    (readable as soon as headers arrive, before the stream body starts) via
//    a custom `fetch` passed to `DefaultChatTransport`.
//  - On discovery: `history.replaceState` swaps the URL without a
//    navigation/remount, and the TanStack Query cache is reconciled by
//    copying data to the new key and removing the old one (never an in-place
//    mutation, per §12.2's explicit warning).
import { useCallback, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { ChatMessage } from "./types";

export type UseConsoleChatOptions = {
  /** Server-fetched first page of messages (§7.2), used to hydrate `useChat`
   * without a client round-trip. Ignored for the "new" sentinel. */
  initialMessages?: ChatMessage[];
};

function createLocalThreadId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local-${crypto.randomUUID()}`;
  }
  return `local-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function useConsoleChat(threadId: string, options?: UseConsoleChatOptions) {
  const queryClient = useQueryClient();

  // Minted once, lazily, and never changed for the life of this hook
  // instance — see the file-level comment above for why.
  const [localId] = useState(() => (threadId === "new" ? createLocalThreadId() : threadId));
  const chatId = threadId === "new" ? localId : threadId;

  // A ref (read synchronously by the transport's `body`/`fetch` callbacks,
  // which run outside React's render cycle) mirrored into state (so
  // consumers of this hook's return value re-render once the real id is
  // known, instead of reading a stale value until some unrelated update).
  // Both are seeded from the same expression independently, rather than the
  // state initializer reading the ref, so no hook call argument ever
  // textually contains a `.current` access (avoids the react-hooks/refs
  // "may read its value during render" lint rule on a pattern that's
  // actually safe here, since the ref is only ever read inside callbacks
  // that run after render).
  const resolvedThreadIdRef = useRef<string | null>(
    threadId === "new" ? null : threadId,
  );
  const [resolvedThreadId, setResolvedThreadId] = useState<string | null>(
    () => (threadId === "new" ? null : threadId),
  );

  const getResolvedThreadId = useCallback(() => resolvedThreadIdRef.current, []);

  const reconcileThreadId = useCallback(
    (realId: string) => {
      if (resolvedThreadIdRef.current === realId) return;
      const previousId = resolvedThreadIdRef.current ?? chatId;
      resolvedThreadIdRef.current = realId;
      setResolvedThreadId(realId);

      if (typeof window !== "undefined" && previousId !== realId) {
        // §7.2/§7.8: swap the URL from /console/c/new to /console/c/:realId
        // without a navigation/remount.
        window.history.replaceState(window.history.state, "", `/console/c/${realId}`);
      }

      if (previousId === realId) return;

      // §12.2: reconcile by copying to the new key then dropping the old
      // one — never mutate an existing cache entry in place.
      const threadData = queryClient.getQueryData(queryKeys.chatThread(previousId));
      if (threadData !== undefined) {
        queryClient.setQueryData(queryKeys.chatThread(realId), threadData);
      }
      const messagesData = queryClient.getQueryData(queryKeys.chatMessages(previousId));
      if (messagesData !== undefined) {
        queryClient.setQueryData(queryKeys.chatMessages(realId), messagesData);
      }
      queryClient.removeQueries({ queryKey: queryKeys.chatThread(previousId) });
      queryClient.removeQueries({ queryKey: queryKeys.chatMessages(previousId) });
    },
    [chatId, queryClient],
  );

  // `body`/`fetch` below are only ever invoked later, by `useChat` itself,
  // when an actual request fires — never synchronously during this render.
  // The lint rule's static analysis can't see that far through
  // `DefaultChatTransport`'s constructor, so it conservatively flags this
  // object literal as if it might read the ref during render; it does not.
  /* eslint-disable react-hooks/refs */
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatMessage>({
        api: "/api/chat",
        // §7.8: threadId is null until the backend has minted/confirmed one;
        // the route handler forwards this straight to the backend.
        body: () => ({ threadId: getResolvedThreadId() }),
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          const realThreadId = response.headers.get("X-Thread-Id");
          if (realThreadId) reconcileThreadId(realThreadId);
          return response;
        },
      }),
    [reconcileThreadId, getResolvedThreadId],
  );
  /* eslint-enable react-hooks/refs */

  const chat = useChat<ChatMessage>({
    id: chatId,
    transport,
    messages: options?.initialMessages,
  });

  return {
    ...chat,
    /** The real backend thread id once known, else the local optimistic id. */
    resolvedThreadId: resolvedThreadId ?? chatId,
  };
}
