import { create } from "zustand";

import type { CapabilitySlug } from "@/data/registry";

/**
 * The dive state machine, modeled on the web galaxy-store's
 * fly → enter → inside choreography:
 *
 *  overview --enter()--> fly --beginEnter()--> enter --arriveInside()--> inside
 *  inside --warp()--> enter (straight to the veil, new target + seed)
 *  inside --exit()--> exit --finishExit()--> overview
 */
export type GalaxyPhase = "overview" | "fly" | "enter" | "inside" | "exit";

type GalaxyState = {
  phase: GalaxyPhase;
  targetSlug: CapabilitySlug | null;
  /** Re-rolled on every dive so each interior assembles fresh. */
  visitSeed: number;
  enter: (slug: CapabilitySlug) => void;
  retarget: (slug: CapabilitySlug) => void;
  beginEnter: () => void;
  arriveInside: () => void;
  warp: (slug: CapabilitySlug) => void;
  exit: () => void;
  finishExit: () => void;
};

let seedState = 0x9e3779b9;
function nextVisitSeed(): number {
  seedState = (Math.imul(seedState, 1664525) + 1013904223) >>> 0;
  return seedState;
}

export const useGalaxyStore = create<GalaxyState>((set, get) => ({
  phase: "overview",
  targetSlug: null,
  visitSeed: nextVisitSeed(),
  enter: (slug) =>
    set({ phase: "fly", targetSlug: slug, visitSeed: nextVisitSeed() }),
  retarget: (slug) => set({ targetSlug: slug }),
  beginEnter: () => {
    if (get().phase === "fly") set({ phase: "enter" });
  },
  arriveInside: () => {
    if (get().phase === "enter") set({ phase: "inside" });
  },
  warp: (slug) =>
    set({ phase: "enter", targetSlug: slug, visitSeed: nextVisitSeed() }),
  exit: () => {
    if (get().phase === "inside") set({ phase: "exit" });
  },
  finishExit: () => {
    if (get().phase === "exit") set({ phase: "overview", targetSlug: null });
  },
}));
