import { create } from "zustand";

export type GalleryTab = "all" | "collections" | "favorites";

type UiState = {
  galleryTab: GalleryTab;
  setGalleryTab: (tab: GalleryTab) => void;
};

export const useUiStore = create<UiState>((set) => ({
  galleryTab: "all",
  setGalleryTab: (galleryTab) => set({ galleryTab }),
}));
