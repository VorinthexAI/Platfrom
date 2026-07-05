"use client";

// neural-map.md §17.2's public `ScrollAnchorContextValue` contract, backed by
// `use-scroll-anchor.ts`'s full implementation. `chat-message-list.tsx` (the
// scroll owner) reads the full internal value (including `anchor`, the raw
// hook result it needs for `containerRef`/pagination compensation); any other
// consumer should only rely on the narrower public shape.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useScrollAnchor, type UseScrollAnchorResult } from "./use-scroll-anchor";

export type ScrollAnchorContextValue = {
  isNearBottom: boolean;
  jumpToLatest: () => void;
  lockAutoScroll: () => void;
};

type InternalScrollAnchorContextValue = ScrollAnchorContextValue & {
  anchor: UseScrollAnchorResult;
};

const ScrollAnchorContext = createContext<InternalScrollAnchorContextValue | null>(null);

export function ScrollAnchorProvider({
  messageCount,
  isStreaming,
  children,
}: {
  messageCount: number;
  isStreaming: boolean;
  children: ReactNode;
}) {
  const anchor = useScrollAnchor({ messageCount, isStreaming });

  const value = useMemo<InternalScrollAnchorContextValue>(
    () => ({
      isNearBottom: anchor.autoScrollArmed,
      jumpToLatest: anchor.jumpToLatest,
      lockAutoScroll: anchor.lockAutoScroll,
      anchor,
    }),
    [anchor],
  );

  return <ScrollAnchorContext.Provider value={value}>{children}</ScrollAnchorContext.Provider>;
}

export function useScrollAnchorContext(): InternalScrollAnchorContextValue {
  const ctx = useContext(ScrollAnchorContext);
  if (!ctx) {
    throw new Error("useScrollAnchorContext must be used within a ScrollAnchorProvider");
  }
  return ctx;
}
