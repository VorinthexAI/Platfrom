import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";
export type SparksSheetReason = "manual" | "insufficient-balance";

type UiState = {
  galleryTab: GalleryTab;
  sparksSheetOpen: boolean;
  sparksSheetReason: SparksSheetReason | null;
  selectedTagsByContext: Record<string, SelectedTag[]>;
  closeSparksSheet: () => void;
  openSparksSheet: (reason?: SparksSheetReason) => void;
  removeSelectedTag: (contextKey: string, tagKey: string) => void;
  setGalleryTab: (tab: GalleryTab) => void;
  setSelectedTags: (contextKey: string, tags: SelectedTag[]) => void;
};

export type SelectedTag = { key: string; name: string };
export const EMPTY_SELECTED_TAGS: SelectedTag[] = [];

export const useUiStore = create<UiState>((set) => ({
  galleryTab: "all",
  sparksSheetOpen: false,
  sparksSheetReason: null,
  selectedTagsByContext: {},
  closeSparksSheet: () => set((state) => state.sparksSheetOpen ? { sparksSheetOpen: false, sparksSheetReason: null } : state),
  openSparksSheet: (reason = "manual") => set((state) => state.sparksSheetOpen && state.sparksSheetReason === reason ? state : { sparksSheetOpen: true, sparksSheetReason: reason }),
  removeSelectedTag: (contextKey, tagKey) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: (state.selectedTagsByContext[contextKey] ?? []).filter(({ key }) => key !== tagKey) } })),
  setGalleryTab: (galleryTab) => set({ galleryTab }),
  setSelectedTags: (contextKey, tags) => set((state) => ({ selectedTagsByContext: { ...state.selectedTagsByContext, [contextKey]: tags } })),
}));
