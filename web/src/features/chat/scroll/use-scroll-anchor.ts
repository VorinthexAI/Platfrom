"use client";

// neural-map.md §7.6/§33.2 — the exact 5-rule scroll contract:
//   1. Auto-scroll to bottom on new chunks only if already within ~100px of
//      the bottom at the moment the chunk rendered.
//   2. The instant the user scrolls upward, immediately stop auto-scrolling
//      and do not resume it automatically.
//   3. While suspended and content is still streaming, show "Jump to
//      latest" (owned by the caller — this hook just exposes the flag).
//   4. Sending a new message always force-scrolls to bottom.
//   5. Loading older messages must never visibly jump — the caller captures
//      scrollHeight before prepending and compensates scrollTop right after,
//      in the same paint.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

const NEAR_BOTTOM_THRESHOLD_PX = 100;

export type UseScrollAnchorDeps = {
  messageCount: number;
  isStreaming: boolean;
};

export type UseScrollAnchorResult = {
  containerRef: RefObject<HTMLDivElement | null>;
  handleScroll: () => void;
  autoScrollArmed: boolean;
  showJumpToLatest: boolean;
  jumpToLatest: () => void;
  /** Rule 2 — call the instant a manual upward scroll is detected. */
  lockAutoScroll: () => void;
  captureScrollHeightForPrepend: () => void;
  compensateAfterPrepend: () => void;
  /** Rule 4 — call when the user sends a new message. */
  forceScrollOnSend: () => void;
};

export function useScrollAnchor(deps: UseScrollAnchorDeps): UseScrollAnchorResult {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScrollArmed, setAutoScrollArmed] = useState(true);
  const prevScrollHeightRef = useRef(0);

  // Rule 3 — derived directly from state, no effect needed: the pill is
  // visible exactly when auto-scroll is suspended while content streams.
  const showJumpToLatest = !autoScrollArmed && deps.isStreaming;

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  const lockAutoScroll = useCallback(() => {
    setAutoScrollArmed(false);
  }, []);

  const handleScroll = useCallback(() => {
    if (isNearBottom()) {
      setAutoScrollArmed(true);
    } else {
      lockAutoScroll();
    }
  }, [isNearBottom, lockAutoScroll]);

  // Rule 1 execution.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !autoScrollArmed) return;
    el.scrollTop = el.scrollHeight;
  }, [deps.messageCount, autoScrollArmed]);

  const captureScrollHeightForPrepend = useCallback(() => {
    if (containerRef.current) prevScrollHeightRef.current = containerRef.current.scrollHeight;
  }, []);

  const compensateAfterPrepend = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const delta = el.scrollHeight - prevScrollHeightRef.current;
    el.scrollTop += delta;
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setAutoScrollArmed(true);
  }, []);

  const forceScrollOnSend = useCallback(() => {
    setAutoScrollArmed(true);
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  return {
    containerRef,
    handleScroll,
    autoScrollArmed,
    showJumpToLatest,
    jumpToLatest,
    lockAutoScroll,
    captureScrollHeightForPrepend,
    compensateAfterPrepend,
    forceScrollOnSend,
  };
}
