"use client";

import { create } from "zustand";

/**
 * Live counters streamed from the platform backend over SSE (proxied by
 * /api/live so the API key stays server-side). One stream per tab, shared
 * by every subscriber (hero waitlist counter, fragment progress).
 *
 * IMPORTANT: this reads the SSE stream with fetch + ReadableStream, NOT
 * EventSource. Chrome ties the tab loading spinner to document-lifecycle
 * network activity, and a long-lived EventSource can keep the tab spinner
 * running forever (hiding the favicon). fetch streams never touch the
 * spinner. We also wait for the window load event before connecting so
 * the stream can never delay initial page readiness.
 */

interface LiveState {
  waitlistCount: number;
  waitlistVerifiedCount: number;
  fragmentsTotal: number;
  connected: boolean;
  ensureConnected: () => void;
}

let started = false;

function applyFrame(payload: string) {
  try {
    const data = JSON.parse(payload);
    useLiveStore.setState({
      waitlistCount: data.waitlist_count ?? 0,
      waitlistVerifiedCount: data.waitlist_verified_count ?? 0,
      fragmentsTotal: data.fragments_total ?? 0,
      connected: true,
    });
  } catch {
    // Malformed frame — skip it.
  }
}

/** Minimal SSE parser over a fetch body; reconnects with backoff. */
async function streamCounters() {
  let attempt = 0;
  // Reconnect forever — the tab may outlive many server restarts.
  for (;;) {
    try {
      const response = await fetch("/api/live", {
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
        // SSE frames are separated by a blank line.
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
          if (event === "counters" && dataLines.length > 0) {
            applyFrame(dataLines.join("\n"));
          }
        }
      }
    } catch {
      // Fall through to reconnect.
    }
    useLiveStore.setState({ connected: false });
    attempt = Math.min(attempt + 1, 6);
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
  }
}

export const useLiveStore = create<LiveState>(() => ({
  waitlistCount: 0,
  waitlistVerifiedCount: 0,
  fragmentsTotal: 0,
  connected: false,
  ensureConnected: () => {
    if (started || typeof window === "undefined") return;
    started = true;
    // Crawlers and headless automation don't need a live stream — an
    // always-open connection just wastes server resources there (and
    // stalls virtual-time screenshot tooling).
    if (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent)) {
      return;
    }
    const begin = () => {
      setTimeout(() => {
        void streamCounters();
      }, 600);
    };
    // Never open the stream before the page finishes loading, so it can
    // never hold the document in a loading state.
    if (document.readyState === "complete") begin();
    else window.addEventListener("load", begin, { once: true });
  },
}));
