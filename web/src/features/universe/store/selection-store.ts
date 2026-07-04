"use client";

// neural-map.md §12.3.

import { create } from "zustand";

type SelectionStore = {
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  select: (nodeId: string | null) => void;
  hover: (nodeId: string | null) => void;
};

export const useSelectionStore = create<SelectionStore>((set) => ({
  selectedNodeId: null,
  hoveredNodeId: null,
  select: (nodeId) => set({ selectedNodeId: nodeId }),
  hover: (nodeId) => set({ hoveredNodeId: nodeId }),
}));
