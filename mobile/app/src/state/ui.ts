import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";
export type AgentGreetingOccasion = "onboarding" | "returning";
export type AgentGreetingRequest = { id: number; occasion: AgentGreetingOccasion };
type UiState = {
  galleryTab: GalleryTab;
  paywallOpen: boolean;
  onboardingReferralEntry: boolean;
  agentGreetingRequest?: AgentGreetingRequest;
  agentGreetingSequence: number;
  selectedTagsByContext: Record<string, SelectedTag[]>;
  closePaywall: () => void;
  openPaywall: () => void;
  consumeOnboardingReferralEntry: () => boolean;
  enterOnboardingReferral: () => void;
  requestAgentGreeting: (occasion: AgentGreetingOccasion) => void;
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
  onboardingReferralEntry: false,
  agentGreetingRequest: undefined,
  agentGreetingSequence: 0,
  selectedTagsByContext: {},
  closePaywall: () => set((state) => state.paywallOpen ? { paywallOpen: false } : state),
  openPaywall: () => set((state) => state.paywallOpen ? state : { paywallOpen: true }),
  consumeOnboardingReferralEntry: () => {
    const pending = get().onboardingReferralEntry;
    if (pending) set({ onboardingReferralEntry: false });
    return pending;
  },
  enterOnboardingReferral: () => set({ onboardingReferralEntry: true }),
  requestAgentGreeting: (occasion) => set((state) => {
    const id = state.agentGreetingSequence + 1;
    return { agentGreetingRequest: { id, occasion }, agentGreetingSequence: id };
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
