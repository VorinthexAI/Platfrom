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
const LOOT_CLAIMED_KEY = "vx_loot_claimed";

function readLooseFragments(): number {
  try {
    return Number(window.localStorage.getItem(LOOSE_KEY) ?? "0") || 0;
  } catch {
    return 0;
  }
}

function readClaimedLootIds(): string[] {
  try {
    const raw = window.localStorage.getItem(LOOT_CLAIMED_KEY);
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
  /** Collectible whose claim tooltip is open. */
  selected: CollectibleDef | null;
  /** Collectibles this explorer has claimed (dissolved from the scene). */
  claimedIds: string[];
  balance: number;
  globalTotal: number;
  goal: number;
  toast: FragmentToastData | null;
  claiming: boolean;
  /** Whether this explorer has joined the waitlist (unlocks direct Claim). */
  hasJoined: boolean;
  /** Treasure the visitor wants — carried into the join cave and claimed
   * against the backend the moment they submit their email. */
  pendingClaim: CollectibleDef | null;
  select: (collectible: CollectibleDef | null) => void;
  setPendingClaim: (collectible: CollectibleDef | null) => void;
  markJoined: () => void;
  /** Apply a claim result returned by the join/claim APIs. */
  applyClaim: (
    collectible: CollectibleDef,
    result: { fragmentsAwarded: number; balance: number; globalTotal: number },
  ) => void;
  hydrateProgress: () => Promise<void>;
  claim: (collectible: CollectibleDef, mesh?: LootMeshRecipe) => Promise<void>;
  /** Scavenge a few loose fragments from an uncharted belt rock. */
  collectLoose: (amount: number) => void;
  /** Ids of procedural biome loot already collected (never respawns). */
  lootClaimedIds: string[];
  /** Collect a procedural biome fragment or crystal (persists its mesh). */
  collectBiomeLoot: (loot: BiomeLootInput) => void;
  dismissToast: () => void;
}

export const useFragmentsStore = create<FragmentsState>((set, get) => ({
  selected: null,
  claimedIds: [],
  balance: 0,
  globalTotal: 0,
  goal: VORINTHEX_GALAXY_REGISTRY.fragmentGoal,
  toast: null,
  claiming: false,
  hasJoined: false,
  pendingClaim: null,
  lootClaimedIds: [],
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
  setPendingClaim: (pendingClaim) => set({ pendingClaim }),
  markJoined: () => {
    try {
      window.localStorage.setItem(JOINED_FLAG, "1");
    } catch {
      // Storage may be blocked — the session flag still applies.
    }
    set({ hasJoined: true });
  },
  applyClaim: (collectible, result) => {
    const legendary =
      collectible.rarity === "founder" || collectible.rarity === "legendary";
    set((state) => ({
      claimedIds: state.claimedIds.includes(collectible.id)
        ? state.claimedIds
        : [...state.claimedIds, collectible.id],
      balance: result.balance,
      globalTotal: Math.max(state.globalTotal, result.globalTotal),
      selected: null,
      pendingClaim: null,
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
    // Procedural biome loot never respawns: restore the claimed set.
    const lootClaimed = readClaimedLootIds();
    if (lootClaimed.length > 0) set({ lootClaimedIds: lootClaimed });
    try {
      const response = await fetch("/api/fragments/progress");
      if (!response.ok) return;
      const data = await response.json();
      set({
        globalTotal: data.total ?? 0,
        goal: data.goal ?? get().goal,
        balance: (data.balance ?? 0) + loose,
        claimedIds: data.claimed ?? [],
      });
    } catch {
      // Progress is decorative — stay quiet on network failure.
    }
  },

  collectBiomeLoot: (loot) => {
    if (get().lootClaimedIds.includes(loot.id)) return;

    // Optimistic and final: the collectible is decorative, so the local
    // ledger wins immediately and the backend persists in the background.
    const nextClaimed = [...get().lootClaimedIds, loot.id];
    try {
      window.localStorage.setItem(LOOT_CLAIMED_KEY, JSON.stringify(nextClaimed));
    } catch {
      // Storage may be blocked — the session set still applies.
    }
    set((state) => ({
      lootClaimedIds: nextClaimed,
      balance: state.balance + loot.fragments,
      toast: {
        title:
          loot.kind === "crystal"
            ? `${loot.name} Claimed`
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

    void fetch("/api/fragments/claim", {
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

  claim: async (collectible, mesh) => {
    if (get().claiming) return;
    trackLandingEvent({
      slug: "landing.fragment_claim_clicked",
      metadata: {
        collectible_id: collectible.id,
        collectible_slug: collectible.slug,
        collectible_name: collectible.name,
        rarity: collectible.rarity,
        fragments: collectible.fragments,
      },
    });
    set({ claiming: true });
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
      const response = await fetch("/api/fragments/claim", {
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
            title: "Fragment unclaimed",
            detail: data.error ?? "Try again in a moment.",
          },
          selected: null,
        });
        return;
      }
      get().applyClaim(collectible, {
        fragmentsAwarded: data.fragmentsAwarded,
        balance: data.balance,
        globalTotal: data.globalTotal,
      });
    } catch {
      set({
        toast: { title: "Fragment unclaimed", detail: "Network error, try again." },
        selected: null,
      });
    } finally {
      set({ claiming: false });
    }
  },

  dismissToast: () => set({ toast: null }),
}));
