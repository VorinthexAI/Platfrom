"use client";

import { create } from "zustand";

/**
 * Live presence: every open tab is a glowing star other explorers can
 * see drifting through the galaxy. One join per tab (identity handled
 * server-side: access token → email hash, else the 1-day vx_did cookie),
 * one SSE stream of roster + join/move/leave events, and a heartbeat
 * that publishes our camera position every few seconds.
 *
 * Scale posture: positions land in the `visitors` map without touching
 * the `sessionIds` array — React only re-renders when someone joins or
 * leaves; per-frame consumers read positions imperatively via getState().
 */

export interface RemoteVisitor {
  session: string;
  alias: string;
  position: [number, number, number];
  updatedAt: number;
}

interface PresenceState {
  sessionKey: string | null;
  /** Our own alias, as the rest of the galaxy sees it. */
  alias: string | null;
  /** Remote visitors by session key — own session excluded. */
  visitors: Record<string, RemoteVisitor>;
  /** Stable membership list; changes only on join/leave/roster. */
  sessionIds: string[];
  ensureStarted: () => void;
}

/** Live camera position — written by the R3F probe every frame. */
export const presenceMotion = {
  position: [0, 6.5, 15.5] as [number, number, number],
};

const BEAT_INTERVAL_MS = 5_000;
const PRUNE_INTERVAL_MS = 20_000;
/** Drop remote stars not heard from in this long (server TTL is 45s). */
const STALE_AFTER_MS = 75_000;

let started = false;

function roundedPosition(): [number, number, number] {
  return [
    Math.round(presenceMotion.position[0] * 100) / 100,
    Math.round(presenceMotion.position[1] * 100) / 100,
    Math.round(presenceMotion.position[2] * 100) / 100,
  ];
}

function setVisitors(visitors: Record<string, RemoteVisitor>) {
  usePresenceStore.setState({
    visitors,
    sessionIds: Object.keys(visitors).sort(),
  });
}

function applyRoster(entries: Array<{ session: string; alias: string; position: [number, number, number] }>) {
  const own = usePresenceStore.getState().sessionKey;
  const now = Date.now();
  const visitors: Record<string, RemoteVisitor> = {};
  for (const entry of entries) {
    if (!entry?.session || entry.session === own) continue;
    visitors[entry.session] = {
      session: entry.session,
      alias: entry.alias ?? "Explorer",
      position: entry.position ?? [0, 0, 0],
      updatedAt: now,
    };
  }
  setVisitors(visitors);
}

function applyEvent(event: {
  type?: string;
  session?: string;
  alias?: string;
  position?: [number, number, number];
}) {
  const state = usePresenceStore.getState();
  if (!event.session || event.session === state.sessionKey) return;
  const now = Date.now();
  if (event.type === "leave") {
    if (!state.visitors[event.session]) return;
    const visitors = { ...state.visitors };
    delete visitors[event.session];
    setVisitors(visitors);
    return;
  }
  if (event.type === "join") {
    setVisitors({
      ...state.visitors,
      [event.session]: {
        session: event.session,
        alias: event.alias ?? "Explorer",
        position: event.position ?? [0, 0, 0],
        updatedAt: now,
      },
    });
    return;
  }
  if (event.type === "move") {
    const existing = state.visitors[event.session];
    if (!existing) return;
    // Position-only update: mutate the map in place (new record object,
    // same map identity) so no React subscriber re-renders — the frame
    // loop reads it imperatively.
    state.visitors[event.session] = {
      ...existing,
      position: event.position ?? existing.position,
      updatedAt: now,
    };
  }
}

async function joinSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/presence/join", { method: "POST" });
    if (!response.ok) return false;
    const data = await response.json();
    if (!data?.ok || !data.sessionKey) return false;
    usePresenceStore.setState({
      sessionKey: data.sessionKey,
      alias: data.alias ?? null,
    });
    return true;
  } catch {
    return false;
  }
}

async function sendBeat(): Promise<void> {
  const sessionKey = usePresenceStore.getState().sessionKey;
  if (!sessionKey) return;
  try {
    const response = await fetch("/api/presence/beat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionKey, position: roundedPosition() }),
    });
    if (response.status === 410) {
      // Session expired server-side — rejoin with the same identity.
      usePresenceStore.setState({ sessionKey: null });
      await joinSession();
    }
  } catch {
    // Network blip — the next beat retries; the server TTL forgives.
  }
}

/** Minimal SSE parser over fetch (same posture as live-store). */
async function streamPresence(): Promise<void> {
  let attempt = 0;
  for (;;) {
    if (!usePresenceStore.getState().sessionKey) {
      const joined = await joinSession();
      if (!joined) {
        attempt = Math.min(attempt + 1, 6);
        await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
        continue;
      }
    }
    try {
      const response = await fetch("/api/presence/stream", {
        headers: { accept: "text/event-stream" },
        cache: "no-store",
      });
      if (!response.ok || !response.body) throw new Error("no stream");
      attempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          let event = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length === 0) continue;
          try {
            const payload = JSON.parse(dataLines.join("\n"));
            if (event === "roster" && Array.isArray(payload)) applyRoster(payload);
            else if (event === "presence") applyEvent(payload);
          } catch {
            // Malformed frame — skip it.
          }
        }
      }
    } catch {
      // Fall through to reconnect.
    }
    attempt = Math.min(attempt + 1, 6);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

function pruneStale() {
  const state = usePresenceStore.getState();
  const now = Date.now();
  const staleIds = state.sessionIds.filter(
    (id) => now - (state.visitors[id]?.updatedAt ?? 0) > STALE_AFTER_MS,
  );
  if (staleIds.length === 0) return;
  const visitors = { ...state.visitors };
  for (const id of staleIds) delete visitors[id];
  setVisitors(visitors);
}

export const usePresenceStore = create<PresenceState>(() => ({
  sessionKey: null,
  alias: null,
  visitors: {},
  sessionIds: [],
  ensureStarted: () => {
    if (started || typeof window === "undefined") return;
    started = true;
    // Crawlers and headless automation aren't explorers.
    if (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent)) {
      return;
    }
    const begin = () => {
      setTimeout(() => {
        void streamPresence();
        setInterval(() => void sendBeat(), BEAT_INTERVAL_MS);
        setInterval(pruneStale, PRUNE_INTERVAL_MS);
      }, 900);
    };
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });

    // A polite goodbye when the tab goes away; the server TTL is the backstop.
    window.addEventListener("pagehide", () => {
      const sessionKey = usePresenceStore.getState().sessionKey;
      if (!sessionKey) return;
      navigator.sendBeacon(
        "/api/presence/leave",
        new Blob([JSON.stringify({ sessionKey })], { type: "application/json" }),
      );
    });
  },
}));
