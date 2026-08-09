import { create } from "zustand";

import type { CapabilitySlug } from "@/data/registry";
import { readOnboardingDecisions, writeOnboardingDecisions } from "@/lib/onboarding-vault";

export type CapabilityDecision = "enabled" | "skipped";

type OnboardingState = {
  /** Index of the card currently at the front of the stack (0–4). */
  activeIndex: number;
  ownerKey: string | null;
  decisions: Partial<Record<CapabilitySlug, CapabilityDecision>>;
  decide: (slug: CapabilitySlug, decision: CapabilityDecision) => void;
  hydrate: (userKey: string) => Promise<void>;
  reset: () => void;
};

export const useOnboardingStore = create<OnboardingState>((set, get) => ({
  activeIndex: 0,
  ownerKey: null,
  decisions: {},
  decide: (slug, decision) => set((state) => {
    const decisions = { ...state.decisions, [slug]: decision };
    if (state.ownerKey) void writeOnboardingDecisions(state.ownerKey, decisions).catch(() => undefined);
    return {
      activeIndex: state.activeIndex + 1,
      decisions,
    };
  }),
  hydrate: async (userKey) => {
    const persisted = await readOnboardingDecisions(userKey);
    set((state) => {
      const decisions = state.ownerKey === null || state.ownerKey === userKey
        ? { ...persisted, ...state.decisions }
        : persisted;
      const firstIncomplete = Object.keys(decisions).length;
      return { ownerKey: userKey, decisions, activeIndex: Math.min(firstIncomplete, 5) };
    });
    await writeOnboardingDecisions(userKey, get().decisions);
  },
  reset: () => set({ activeIndex: 0, ownerKey: null, decisions: {} }),
}));
