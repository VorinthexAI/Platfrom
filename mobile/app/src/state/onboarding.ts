import { create } from "zustand";

import type { CapabilitySlug } from "@/data/registry";

export type CapabilityDecision = "enabled" | "skipped";

type OnboardingState = {
  /** Index of the card currently at the front of the stack (0–4). */
  activeIndex: number;
  decisions: Partial<Record<CapabilitySlug, CapabilityDecision>>;
  decide: (slug: CapabilitySlug, decision: CapabilityDecision) => void;
  reset: () => void;
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  activeIndex: 0,
  decisions: {},
  decide: (slug, decision) =>
    set((state) => ({
      activeIndex: state.activeIndex + 1,
      decisions: { ...state.decisions, [slug]: decision },
    })),
  reset: () => set({ activeIndex: 0, decisions: {} }),
}));
