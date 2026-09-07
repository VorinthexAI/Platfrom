import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";
export type SparksSheetReason = "manual" | "insufficient-balance";

type UiState = {
  galleryTab: GalleryTab;
  sparksSheetOpen: boolean;
  sparksSheetReason: SparksSheetReason | null;
  paywallOpen: boolean;
  onboardingReferralEntry: boolean;
  selectedTagsByContext: Record<string, SelectedTag[]>;
  closeSparksSheet: () => void;
  closePaywall: () => void;
  openSparksSheet: (reason?: SparksSheetReason) => void;
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
  sparksSheetOpen: false,
  sparksSheetReason: null,
  paywallOpen: false,
  onboardingReferralEntry: false,
  selectedTagsByContext: {},
  closeSparksSheet: () => set((state) => state.sparksSheetOpen ? { sparksSheetOpen: false, sparksSheetReason: null } : state),
  closePaywall: () => set({ paywallOpen: false }),
  openSparksSheet: (reason = "manual") => set((state) => state.sparksSheetOpen && state.sparksSheetReason === reason ? state : { sparksSheetOpen: true, sparksSheetReason: reason }),
  openPaywall: () => set({ paywallOpen: true }),
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
