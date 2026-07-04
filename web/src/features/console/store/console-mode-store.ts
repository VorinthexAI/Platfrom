"use client";

// neural-map.md §6.4, §12.3. In-session mode state lives here (not React
// Context) so a toggle only re-renders the header icon and the two panels'
// `hidden` attribute — never the whole shell tree.

import { create } from "zustand";

export type ConsoleMode = "chat" | "universe";

const LAST_MODE_COOKIE = "vx_last_mode";

type ConsoleModeStore = {
  mode: ConsoleMode;
  hasOtherModeActivity: boolean;
  setMode: (mode: ConsoleMode) => void;
  markOtherModeActivity: () => void;
};

function readLastModeCookie(): ConsoleMode {
  if (typeof document === "undefined") return "chat";
  const match = document.cookie.match(/(?:^|;\s*)vx_last_mode=([^;]+)/);
  return match?.[1] === "universe" ? "universe" : "chat";
}

function writeLastModeCookie(mode: ConsoleMode) {
  if (typeof document === "undefined") return;
  const oneYear = 60 * 60 * 24 * 365;
  document.cookie = `${LAST_MODE_COOKIE}=${mode}; Path=/; Max-Age=${oneYear}; SameSite=Lax`;
}

export const useConsoleModeStore = create<ConsoleModeStore>((set, get) => ({
  mode: readLastModeCookie(),
  hasOtherModeActivity: false,
  setMode: (mode) => {
    if (get().mode === mode) return;
    writeLastModeCookie(mode);
    set({ mode, hasOtherModeActivity: false });
  },
  markOtherModeActivity: () => set({ hasOtherModeActivity: true }),
}));

/** Selective-subscription helper for the header icon (§12.3's "must never subscribe to the whole store" rule). */
export function useConsoleModeIndicator() {
  return useConsoleModeStore((s) => ({
    mode: s.mode,
    hasOtherModeActivity: s.hasOtherModeActivity,
  }));
}
