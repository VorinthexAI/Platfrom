"use client";

import { create } from "zustand";
import { formatFragments } from "@/lib/format";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { standingLine, type StandingTier } from "./copy";

/**
 * Live leaderboard client: one EventSource against /api/leaderboard/stream
 * while the hunt asteroid is open. The explorer's own standing — total
 * fragments AND 1-based rank — comes from the backend's authoritative
 * standing endpoint (the SAME COLLECT/SUM query family that builds the
 * board), fetched on open and refreshed on every SSE frame, so the "you"
 * card and the in-list "You" row can never disagree with the board.
 */

export interface LeaderboardRow {
  userId: string;
  alias: string | null;
  total: number;
}

export interface CaveEntry {
  key: string;
  fragments: number;
  rarity: string;
  mesh: Record<string, unknown> | null;
  placementSeed: number | null;
  createdAt: string;
  alias: string | null;
}

interface LeaderboardState {
  connected: boolean;
  rows: LeaderboardRow[];
  fragmentsTotal: number;
  fragmentsEntries: number;
  activeExplorers: number;
  entries: CaveEntry[];
  /** The signed-in user's id (from the standing endpoint) for the you-row
   * highlight — matched by id, never by alias string. Null when anonymous. */
  myUserId: string | null;
  /** Authoritative fragment total for the "you" card (server truth). */
  myTotal: number;
  /** 1-based leaderboard rank from the server; null when anonymous/off-board. */
  myRank: number | null;
  standingTier: StandingTier;
  standingText: string;
  /** Bumps every update so seeded copy re-rolls. */
  updateNonce: number;
  connect: () => void;
  disconnect: () => void;
}

let source: EventSource | null = null;
let seenEntryKeys: Set<string> | null = null;

export const useLeaderboardStore = create<LeaderboardState>((set, get) => {
  /**
   * Pull the caller's authoritative standing and fold it into the store,
   * rolling the climbing/steady/falling tier against the previous rank.
   */
  async function refreshStanding() {
    try {
      const response = await fetch("/api/fragments/standing");
      if (!response.ok) return;
      const data = (await response.json()) as {
        userId: string | null;
        total: number;
        rank: number | null;
        entries: number;
      };
      const previousRank = get().myRank;
      const nextRank = data.rank;
      const tier: StandingTier =
        previousRank === null || nextRank === null || nextRank === previousRank
          ? "draw"
          : nextRank < previousRank
            ? "win"
            : "lose";
      const nonce = get().updateNonce + 1;
      set({
        myUserId: data.userId,
        myTotal: data.total,
        myRank: nextRank,
        standingTier: tier,
        standingText: standingLine(tier, nonce * 2654435761),
        updateNonce: nonce,
      });
    } catch {
      // Standing is decorative on failure — leave the last known values.
    }
  }

  return {
    connected: false,
    rows: [],
    fragmentsTotal: 0,
    fragmentsEntries: 0,
    activeExplorers: 0,
    entries: [],
    myUserId: null,
    myTotal: 0,
    myRank: null,
    standingTier: "draw",
    standingText: "",
    updateNonce: 0,

    connect: () => {
      if (source) return;
      seenEntryKeys = null;
      source = new EventSource("/api/leaderboard/stream");
      set({ connected: true });
      // Authoritative standing up front, then refreshed on every SSE frame.
      void refreshStanding();

      source.addEventListener("leaderboard", (event) => {
        let data: {
          top?: Array<{ user_id: string; alias: string | null; total: number }>;
          fragments_total?: number;
          fragments_entries?: number;
          active_explorers?: number;
          recent?: Array<{
            key: string;
            fragments: number;
            rarity: string;
            mesh: Record<string, unknown> | null;
            placement_seed: number | null;
            created_at: string;
            alias: string | null;
          }>;
        };
        try {
          data = JSON.parse((event as MessageEvent).data as string);
        } catch {
          return;
        }

        const rows: LeaderboardRow[] = (data.top ?? []).map((row) => ({
          userId: row.user_id,
          alias: row.alias,
          total: row.total,
        }));
        const entries: CaveEntry[] = (data.recent ?? []).map((entry) => ({
          key: entry.key,
          fragments: entry.fragments,
          rarity: entry.rarity,
          mesh: entry.mesh,
          placementSeed: entry.placement_seed,
          createdAt: entry.created_at,
          alias: entry.alias,
        }));

        // FOMO toasts: pieces that appeared since the last frame, collected by
        // somebody else. Skipped on the very first frame (nothing is "new").
        const fragments = useFragmentsStore.getState();
        if (seenEntryKeys) {
          const fresh = entries.filter((entry) => !seenEntryKeys!.has(entry.key));
          const loudest = fresh
            .filter((entry) => !fragments.lootCollectedIds.includes(entry.key))
            .sort((a, b) => b.fragments - a.fragments)[0];
          if (loudest) {
            fragments.pushToast(
              `+${formatFragments(loudest.fragments)} Intelligence Fragments`,
              `Added by ${loudest.alias ?? "an unnamed explorer"}`,
            );
          }
        }
        seenEntryKeys = new Set(entries.map((entry) => entry.key));

        set({
          rows,
          entries,
          fragmentsTotal: data.fragments_total ?? 0,
          fragmentsEntries: data.fragments_entries ?? 0,
          activeExplorers: data.active_explorers ?? 0,
        });

        // Re-pull the caller's own standing so rank/total track the board.
        void refreshStanding();
      });

      source.onerror = () => {
        // EventSource retries by itself; just reflect the state.
        set({ connected: false });
      };
    },

    disconnect: () => {
      source?.close();
      source = null;
      seenEntryKeys = null;
      set({ connected: false, myRank: null, myTotal: 0, myUserId: null });
    },
  };
});
