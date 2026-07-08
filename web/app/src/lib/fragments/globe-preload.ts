"use client";

/**
 * Preloads the fragment jar (`GET /api/fragments/globe`) during the ~1.6s
 * hyperjump white-out so /galaxy/public paints a full jar on first frame
 * instead of empty-then-fill. The jump kicks off `preloadGlobe()`; the
 * destination consumes the in-flight promise. Stale preloads (older than the
 * freshness window) are ignored so a consumer never renders a jar from a jump
 * that happened minutes ago.
 */

export interface GlobePayload {
  ok: boolean;
  balance: number;
  collected: string[];
  globalTotal: number;
  three: {
    points: Array<[number, number, number]>;
    colors: Array<[number, number, number]>;
    meta: Array<{ key: string; label: string | null; mesh?: Record<string, unknown> | null }>;
  };
}

const FRESHNESS_MS = 15_000;

let pending: { promise: Promise<GlobePayload>; startedAt: number } | null = null;

/** Fire the globe fetch now (idempotent within the freshness window). */
export function preloadGlobe(): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  if (pending && now - pending.startedAt < FRESHNESS_MS) return;
  pending = {
    startedAt: now,
    promise: fetch("/api/fragments/globe")
      .then((r) => r.json() as Promise<GlobePayload>),
  };
}

/** Return-and-clear a fresh in-flight preload, or null if none/stale. */
export function consumeGlobePreload(): Promise<GlobePayload> | null {
  if (!pending) return null;
  const fresh = Date.now() - pending.startedAt < FRESHNESS_MS;
  const { promise } = pending;
  pending = null;
  return fresh ? promise : null;
}
