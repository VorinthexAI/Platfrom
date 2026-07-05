"use client";

// Small cross-mode handoff store backing neural-map.md §8's "Ask about this
// in Chat" quick-action (node detail card / universe command bar → chat
// composer) and §7.9's "View in Universe" citation (the reverse direction
// isn't a draft, just a mode+camera pivot, handled by the universe engine
// bridge directly). Kept separate from `console-mode-store` because it's a
// one-shot handoff value, not persistent UI state.

import { create } from "zustand";

type PendingChatDraftStore = {
  draft: string | null;
  setDraft: (draft: string) => void;
  consumeDraft: () => string | null;
};

export const usePendingChatDraftStore = create<PendingChatDraftStore>(
  (set, get) => ({
    draft: null,
    setDraft: (draft) => set({ draft }),
    consumeDraft: () => {
      const draft = get().draft;
      if (draft !== null) set({ draft: null });
      return draft;
    },
  }),
);
