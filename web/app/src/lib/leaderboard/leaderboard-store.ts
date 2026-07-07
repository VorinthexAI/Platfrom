"use client";

import { create } from "zustand";
import { formatFragments } from "@/lib/format";
import { useFragmentsStore } from "@/lib/fragments/fragments-store";
import { standingLine, type StandingTier } from "./copy";

/**
 * Live leaderboard client: one EventSource against /api/leaderboard/stream
 * while the leaderboard asteroid is open. Every frame re-derives the
 * explorer's rank from the fragments ledger (their balance vs the top
 * rows), rolls a standing tier (climbing / steady / falling) against the
 * previous rank, and surfaces FOMO toasts for pieces other explorers
 * claim in real time.
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
  /** 1-based rank derived from the visible board; null before first frame. */
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

function deriveRank(rows: LeaderboardRow[], myBalance: number): number {
  // Rank among the fetched board: everyone strictly ahead of my balance,
  // plus one. Beyond the fetched rows the exact rank is unknowable — the
  // UI reads it as "below the board", which is the honest answer.
  return rows.filter((row) => row.total > myBalance).length + 1;
}

export const useLeaderboardStore = create<LeaderboardState>((set, get) => ({
  connected: false,
  rows: [],
  fragmentsTotal: 0,
  fragmentsEntries: 0,
  activeExplorers: 0,
  entries: [],
  myRank: null,
  standingTier: "draw",
  standingText: "",
  updateNonce: 0,

  connect: () => {
    if (source) return;
    seenEntryKeys = null;
    source = new EventSource("/api/leaderboard/stream");
    set({ connected: true });

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

      // FOMO toasts: pieces that appeared since the last frame, claimed by
      // somebody else. Skipped on the very first frame (nothing is "new").
      const fragments = useFragmentsStore.getState();
      if (seenEntryKeys) {
        const fresh = entries.filter((entry) => !seenEntryKeys!.has(entry.key));
        const loudest = fresh
          .filter((entry) => !fragments.lootClaimedIds.includes(entry.key))
          .sort((a, b) => b.fragments - a.fragments)[0];
        if (loudest) {
          fragments.pushToast(
            `+${formatFragments(loudest.fragments)} Intelligence Fragments`,
            `Added by ${loudest.alias ?? "an unnamed explorer"}`,
          );
        }
      }
      seenEntryKeys = new Set(entries.map((entry) => entry.key));

      const myBalance = fragments.balance;
      const nextRank = deriveRank(rows, myBalance);
      const previousRank = get().myRank;
      const tier: StandingTier =
        previousRank === null || nextRank === previousRank
          ? "draw"
          : nextRank < previousRank
            ? "win"
            : "lose";
      const nonce = get().updateNonce + 1;

      set({
        rows,
        entries,
        fragmentsTotal: data.fragments_total ?? 0,
        fragmentsEntries: data.fragments_entries ?? 0,
        activeExplorers: data.active_explorers ?? 0,
        myRank: nextRank,
        standingTier: tier,
        standingText: standingLine(tier, nonce * 2654435761),
        updateNonce: nonce,
      });
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
    set({ connected: false, myRank: null });
  },
}));
