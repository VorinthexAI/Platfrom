import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";
type UiState = {
  galleryTab: GalleryTab;
  paywallOpen: boolean;
  onboardingReferralEntry: boolean;
  selectedTagsByContext: Record<string, SelectedTag[]>;
  closePaywall: () => void;
  openPaywall: () => void;
  consumeOnboardingReferralEntry: () => boolean;
  enterOnboardingReferral: () => void;
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
  selectedTagsByContext: {},
  closePaywall: () => set((state) => state.paywallOpen ? { paywallOpen: false } : state),
  openPaywall: () => set((state) => state.paywallOpen ? state : { paywallOpen: true }),
  consumeOnboardingReferralEntry: () => {
    const pending = get().onboardingReferralEntry;
    if (pending) set({ onboardingReferralEntry: false });
    return pending;
  },
  enterOnboardingReferral: () => set({ onboardingReferralEntry: true }),
  removeSelectedTag: (contextKey, tagKey) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: (state.selectedTagsByContext[contextKey] ?? []).filter(({ key }) => key !== tagKey) } })),
  setGalleryTab: (galleryTab) => set({ galleryTab }),
  setSelectedTags: (contextKey, tags) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: tags } })),
}));
