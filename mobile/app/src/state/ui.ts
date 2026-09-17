import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";
export type AgentGreetingOccasion = "onboarding" | "returning";
export type AgentGreetingRequestPolicy = "restore-or-greet" | "fresh";
export type AgentGreetingRequest = { id: number; occasion: AgentGreetingOccasion; policy: AgentGreetingRequestPolicy };
type UiState = {
  galleryTab: GalleryTab;
  paywallOpen: boolean;
  paywallEntry: "plans" | "costs";
  onboardingReferralEntry: boolean;
  agentGreetingRequest?: AgentGreetingRequest;
  agentGreetingSequence: number;
  selectedTagsByContext: Record<string, SelectedTag[]>;
  clearSelectedTags: () => void;
  closePaywall: () => void;
  openCostDetails: () => void;
  openPaywall: () => void;
  consumeOnboardingReferralEntry: () => boolean;
  enterOnboardingReferral: () => void;
  requestAgentGreeting: (occasion: AgentGreetingOccasion, policy?: AgentGreetingRequestPolicy) => void;
  consumeAgentGreeting: (id: number) => AgentGreetingRequest | undefined;
  removeSelectedTag: (contextKey: string, tagKey: string) => void;
  setGalleryTab: (tab: GalleryTab) => void;
  setSelectedTags: (contextKey: string, tags: SelectedTag[]) => void;
};

export type SelectedTag = { key: string; name: string };
export const EMPTY_SELECTED_TAGS: SelectedTag[] = [];

export const useUiStore = create<UiState>((set, get) => ({
  galleryTab: "all",
  paywallOpen: false,
  paywallEntry: "plans",
  onboardingReferralEntry: false,
  agentGreetingRequest: undefined,
  agentGreetingSequence: 0,
  selectedTagsByContext: {},
  clearSelectedTags: () => set((state) => Object.keys(state.selectedTagsByContext).length ? { selectedTagsByContext: {} } : state),
  closePaywall: () => set((state) => state.paywallOpen ? { paywallOpen: false } : state),
  openCostDetails: () => set((state) => state.paywallOpen && state.paywallEntry === "costs" ? state : { paywallEntry: "costs", paywallOpen: true }),
  openPaywall: () => set((state) => state.paywallOpen && state.paywallEntry === "plans" ? state : { paywallEntry: "plans", paywallOpen: true }),
  consumeOnboardingReferralEntry: () => {
    const pending = get().onboardingReferralEntry;
    if (pending) set({ onboardingReferralEntry: false });
    return pending;
  },
  enterOnboardingReferral: () => set({ onboardingReferralEntry: true }),
  requestAgentGreeting: (occasion, policy = "fresh") => set((state) => {
    const id = state.agentGreetingSequence + 1;
    return { agentGreetingRequest: { id, occasion, policy }, agentGreetingSequence: id };
  }),
  consumeAgentGreeting: (id) => {
    const request = get().agentGreetingRequest;
    if (request?.id !== id) return undefined;
    set({ agentGreetingRequest: undefined });
    return request;
  },
  removeSelectedTag: (contextKey, tagKey) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: (state.selectedTagsByContext[contextKey] ?? []).filter(({ key }) => key !== tagKey) } })),
  setGalleryTab: (galleryTab) => set({ galleryTab }),
  setSelectedTags: (contextKey, tags) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: tags } })),
}));
