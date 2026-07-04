"use client";

// neural-map.md §7.4/§7.6/§17.2 — the virtualized, bottom-anchored message
// list. Virtualization notes:
//   - Messages render in natural chronological (oldest -> newest, top ->
//     bottom) order; "anchored to bottom, growing upward" falls out of that
//     ordering plus the scroll-anchor hook keeping `scrollTop` pinned to
//     `scrollHeight` while armed — no reversed-index trick needed.
//   - Each row's `ref={virtualizer.measureElement}` is TanStack Virtual v3's
//     own dynamic-measurement hook, which internally uses a `ResizeObserver`
//     per currently-rendered row and feeds corrected sizes back into the
//     virtualizer automatically. That *is* the "ResizeObserver on the
//     currently-streaming message" requirement from §7.4 — reusing it here
//     instead of hand-rolling a second, redundant observer.
//   - Rule 5 (no visible jump on older-message pagination) is handled by
//     capturing/compensating `scrollTop` around `onLoadOlder` via the
//     scroll-anchor hook, independent of virtualization.
import { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { EmptyState, Spinner } from "@/shared/packages/ui";
import { ChatMessageComponent } from "./chat-message";
import { ScrollAnchorProvider, useScrollAnchorContext } from "./scroll/scroll-anchor-provider";
import type { ChatMessage } from "./types";

export type ChatMessageListProps = {
  threadId: string;
  messages: ChatMessage[];
  isStreaming: boolean;
  onLoadOlder: () => Promise<void>;
  hasOlder: boolean;
};

const OLDER_MESSAGES_TRIGGER_PX = 200;

function ChatMessageListInner({ threadId, messages, isStreaming, onLoadOlder, hasOlder }: ChatMessageListProps) {
  const { anchor, jumpToLatest, isNearBottom } = useScrollAnchorContext();
  const isLoadingOlderRef = useRef(false);
  const prevLastMessageRef = useRef<{ id: string; role: string } | null>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => anchor.containerRef.current,
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // Rule 4: force-scroll to bottom the instant the user's own new message
  // appears, regardless of prior scroll-anchor state.
  useEffect(() => {
    const last = messages[messages.length - 1];
    const prev = prevLastMessageRef.current;
    if (last && last.role === "user" && prev?.id !== last.id) {
      anchor.forceScrollOnSend();
    }
    prevLastMessageRef.current = last ? { id: last.id, role: last.role } : null;
  }, [messages, anchor]);

  const handleScroll = useCallback(
    async (event: React.UIEvent<HTMLDivElement>) => {
      anchor.handleScroll();

      const el = event.currentTarget;
      if (hasOlder && !isLoadingOlderRef.current && el.scrollTop < OLDER_MESSAGES_TRIGGER_PX) {
        isLoadingOlderRef.current = true;
        anchor.captureScrollHeightForPrepend();
        try {
          await onLoadOlder();
        } finally {
          // Compensate once the newly-prepended rows have actually painted.
          requestAnimationFrame(() => {
            anchor.compensateAfterPrepend();
            isLoadingOlderRef.current = false;
          });
        }
      }
    },
    [anchor, hasOlder, onLoadOlder],
  );

  const virtualItems = virtualizer.getVirtualItems();
  const lastMessageId = messages[messages.length - 1]?.id;

  if (messages.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6" data-thread-id={threadId}>
        <EmptyState className="max-w-sm text-center text-[var(--vx-console-text-muted)]">
          Ask anything — about your data, your graph, or just to think something through.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col" data-thread-id={threadId}>
      <div
        ref={anchor.containerRef}
        onScroll={handleScroll}
        className="h-full min-h-0 overflow-y-auto"
      >
        {hasOlder && (
          <div className="flex justify-center py-3" aria-hidden="true">
            <Spinner />
          </div>
        )}
        <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
          {virtualItems.map((virtualRow) => {
            const message = messages[virtualRow.index];
            if (!message) return null;
            return (
              <div
                key={virtualRow.key}
                ref={virtualizer.measureElement}
                data-index={virtualRow.index}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <ChatMessageComponent
                  message={message}
                  isStreamingNow={isStreaming && message.id === lastMessageId}
                />
              </div>
            );
          })}
        </div>
      </div>

      {!isNearBottom && isStreaming && (
        // Positioned well above bottom:0 so it clears the floating island
        // (fixed, ~24px inset + its own height, z-index 40 — console-theme.css)
        // rather than sitting underneath it. 96px is a conservative default;
        // tune once the island's real rendered height is finalized.
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full border border-[var(--vx-console-border)] bg-[var(--vx-console-surface-raised)] px-4 py-1.5 text-sm font-medium text-[var(--vx-console-text)] shadow-lg"
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}

export function ChatMessageList(props: ChatMessageListProps) {
  return (
    <ScrollAnchorProvider messageCount={props.messages.length} isStreaming={props.isStreaming}>
      <ChatMessageListInner {...props} />
    </ScrollAnchorProvider>
  );
}
