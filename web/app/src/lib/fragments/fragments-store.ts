"use client";

import { create } from "zustand";
import { trackLandingEvent } from "@/lib/analytics";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { CollectibleDef } from "@/lib/galaxy/registry-types";
import { CRYSTAL_VARIANTS } from "@/lib/three/crystal";
import { hashString } from "@/lib/three/procedural";

interface FragmentToastData {
  title: string;
  detail: string;
}

const JOINED_FLAG = "vx_joined";
/** Fragments scavenged from ordinary belt rocks — device-local ledger
 * (uncharted rocks have no registry ids for the backend to verify). */
const LOOSE_KEY = "vx_loose_fragments";
/** Procedural biome loot (fragments + crystals) already collected on this
 * device — the ids are stable per biome, so nothing ever respawns. */
const LOOT_COLLECTED_KEY = "vx_loot_claimed";

function readLooseFragments(): number {
  try {
    return Number(window.localStorage.getItem(LOOSE_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function readCollectedLootIds(): string[] {
  try {
    const raw = window.localStorage.getItem(LOOT_COLLECTED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Deterministic mesh recipe captured with every collected piece. */
export interface LootMeshRecipe {
  generator: string;
  seed: number;
  variant?: number;
  scale?: number;
  params?: Record<string, number | string>;
}

export interface BiomeLootInput {
  /** Stable id: `loot-<biomeKey>-<index>` — same biome, same id, forever. */
  id: string;
  name: string;
  rarity: string;
  fragments: number;
  kind: "fragment" | "crystal";
  mesh: LootMeshRecipe;
}

interface FragmentsState {
  /** Collectible whose collect tooltip is open. */
  selected: CollectibleDef | null;
  /** Collectibles this explorer has collected (dissolved from the scene). */
  collectedIds: string[];
  balance: number;
  globalTotal: number;
  goal: number;
  toast: FragmentToastData | null;
  collecting: boolean;
  /** Whether this explorer has joined the waitlist (unlocks direct Collect). */
  hasJoined: boolean;
  /** Treasure the visitor wants — carried into the join cave and collected
   * against the backend the moment they submit their email. */
  pendingCollect: CollectibleDef | null;
  select: (collectible: CollectibleDef | null) => void;
  setPendingCollect: (collectible: CollectibleDef | null) => void;
  markJoined: () => void;
  /** Apply a collect result returned by the join/collect APIs. */
  applyCollect: (
    collectible: CollectibleDef,
    result: { fragmentsAwarded: number; balance: number; globalTotal: number },
  ) => void;
  hydrateProgress: () => Promise<void>;
  collect: (collectible: CollectibleDef, mesh?: LootMeshRecipe) => Promise<void>;
  /** Scavenge a few loose fragments from an uncharted belt rock. */
  collectLoose: (amount: number) => void;
  /** Ids of procedural biome loot already collected (never respawns). */
  lootCollectedIds: string[];
  /** Collect a procedural biome fragment or crystal (persists its mesh). */
  collectBiomeLoot: (loot: BiomeLootInput) => void;
  /** Show a toast from outside the collect flow (live leaderboard FOMO). */
  pushToast: (title: string, detail: string) => void;
  dismissToast: () => void;
}

export const useFragmentsStore = create<FragmentsState>((set, get) => ({
  selected: null,
  collectedIds: [],
  balance: 0,
  globalTotal: 0,
  goal: VORINTHEX_GALAXY_REGISTRY.fragmentGoal,
  toast: null,
  collecting: false,
  hasJoined: false,
  pendingCollect: null,
  lootCollectedIds: [],
  select: (selected) => {
    if (selected) {
      trackLandingEvent({
        slug: "landing.fragment_discovered",
        metadata: {
          collectible_id: selected.id,
          collectible_slug: selected.slug,
          collectible_name: selected.name,
          rarity: selected.rarity,
          fragments: selected.fragments,
          parent_entity_id: selected.parentEntityId,
        },
      });
    }
    set({ selected });
  },
  setPendingCollect: (pendingCollect) => set({ pendingCollect }),
  markJoined: () => {
    try {
      window.localStorage.setItem(JOINED_FLAG, "1");
    } catch {
      // Storage may be blocked — the session flag still applies.
    }
    set({ hasJoined: true });
  },
  applyCollect: (collectible, result) => {
    const legendary =
      collectible.rarity === "founder" || collectible.rarity === "legendary";
    set((state) => ({
      collectedIds: state.collectedIds.includes(collectible.id)
        ? state.collectedIds
        : [...state.collectedIds, collectible.id],
      balance: result.balance,
      globalTotal: Math.max(state.globalTotal, result.globalTotal),
      selected: null,
      pendingCollect: null,
      toast: {
        title: legendary
          ? `${collectible.name} Discovered`
          : `+${result.fragmentsAwarded} Intelligence Fragments`,
        detail: legendary
          ? `+${result.fragmentsAwarded} Intelligence Fragments`
          : "Added to your Explorer Balance.",
      },
    }));
  },

  hydrateProgress: async () => {
    try {
      const joined =
        window.localStorage.getItem(JOINED_FLAG) === "1" ||
        window.localStorage.getItem("vx_profile") !== null;
      if (joined) set({ hasJoined: true });
    } catch {
      // Storage may be blocked — stay conservative.
    }
    // Loose rock scavenge lives on this device only — count it in even
    // before (or without) a backend ledger.
    const loose = readLooseFragments();
    if (loose > 0) set((state) => ({ balance: state.balance + loose }));
    // Procedural biome loot never respawns: restore the collected set.
    const lootCollected = readCollectedLootIds();
    if (lootCollected.length > 0) set({ lootCollectedIds: lootCollected });
    try {
      const response = await fetch("/api/fragments/progress");
      if (!response.ok) return;
      const data = await response.json();
      set({
        globalTotal: data.total ?? 0,
        goal: data.goal ?? get().goal,
        balance: (data.balance ?? 0) + loose,
        collectedIds: data.collected ?? [],
      });
    } catch {
      // Progress is decorative — stay quiet on network failure.
    }
  },

  collectBiomeLoot: (loot) => {
    if (get().lootCollectedIds.includes(loot.id)) return;

    // Optimistic and final: the collectible is decorative, so the local
    // ledger wins immediately and the backend persists in the background.
    const nextCollected = [...get().lootCollectedIds, loot.id];
    try {
      window.localStorage.setItem(LOOT_COLLECTED_KEY, JSON.stringify(nextCollected));
    } catch {
      // Storage may be blocked — the session set still applies.
    }
    set((state) => ({
      lootCollectedIds: nextCollected,
      balance: state.balance + loot.fragments,
      toast: {
        title:
          loot.kind === "crystal"
            ? `${loot.name} Collected`
            : `+${loot.fragments} Intelligence Fragments`,
        detail:
          loot.kind === "crystal"
            ? `+${loot.fragments.toLocaleString("en-US")} Intelligence Fragments — added to your collection.`
            : "Scavenged from the biome floor.",
      },
    }));
    trackLandingEvent({
      slug:
        loot.kind === "crystal"
          ? "landing.crystal_collected"
          : "landing.biome_fragment_collected",
      metadata: {
        loot_id: loot.id,
        rarity: loot.rarity,
        fragments: loot.fragments,
        mesh_generator: loot.mesh.generator,
        mesh_seed: loot.mesh.seed,
      },
    });

    void fetch("/api/fragments/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectibleId: loot.id,
        loot: {
          kind: loot.kind,
          name: loot.name,
          rarity: loot.rarity,
          fragments: loot.fragments,
          mesh: loot.mesh,
        },
      }),
    }).catch(() => {});
  },

  collectLoose: (amount) => {
    try {
      window.localStorage.setItem(
        LOOSE_KEY,
        String(readLooseFragments() + amount),
      );
    } catch {
      // Storage may be blocked — the session balance still counts it.
    }
    set((state) => ({
      balance: state.balance + amount,
      toast: {
        title: `+${amount} Intelligence Fragments`,
        detail: "Scavenged from an uncharted asteroid.",
      },
    }));
    trackLandingEvent({
      slug: "fragments.collected",
      metadata: { source: "loose_rock", fragments: amount },
    });
  },

  collect: async (collectible, mesh) => {
    if (get().collecting) return;
    trackLandingEvent({
      slug: "landing.fragment_collect_clicked",
      metadata: {
        collectible_id: collectible.id,
        collectible_slug: collectible.slug,
        collectible_name: collectible.name,
        rarity: collectible.rarity,
        fragments: collectible.fragments,
      },
    });
    set({ collecting: true });
    // Every collected piece keeps its exact mesh: registry treasures are
    // rendered from a hash of their id, so that recipe is what persists.
    const variant = hashString(collectible.id) % CRYSTAL_VARIANTS;
    const meshRecipe: LootMeshRecipe = mesh ?? {
      generator: "crystal-v1",
      seed: variant,
      variant,
      scale: 0.5,
    };
    try {
      const response = await fetch("/api/fragments/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectibleId: collectible.id,
          mesh: meshRecipe,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        set({
          toast: {
            title: "Fragment not collected",
            detail: data.error ?? "Try again in a moment.",
          },
          selected: null,
        });
        return;
      }
      get().applyCollect(collectible, {
        fragmentsAwarded: data.fragmentsAwarded,
        balance: data.balance,
        globalTotal: data.globalTotal,
      });
    } catch {
      set({
        toast: { title: "Fragment not collected", detail: "Network error, try again." },
        selected: null,
      });
    } finally {
      set({ collecting: false });
    }
  },

  pushToast: (title, detail) => set({ toast: { title, detail } }),

  dismissToast: () => set({ toast: null }),
}));
