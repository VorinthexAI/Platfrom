import "server-only";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { CollectibleDef } from "@/lib/galaxy/registry-types";

/**
 * Server-side fragment ledger. Collectibles are defined in the registry —
 * the client is never trusted: every collect is validated here.
 *
 * TODO: replace the in-memory store with the platform backend (Redis/DB)
 * before launch — balances and the global counter currently reset on
 * server restart.
 */

const collectiblesById = new Map(
  VORINTHEX_GALAXY_REGISTRY.collectibles.map((c) => [c.id, c]),
);

interface Ledger {
  /** explorerId -> collected collectible ids */
  collects: Map<string, Set<string>>;
  /** explorerId -> fragment balance */
  balances: Map<string, number>;
  /** explorerId -> last collect timestamp (rate limiting) */
  lastCollectAt: Map<string, number>;
  globalTotal: number;
}

const ledger: Ledger = {
  collects: new Map(),
  balances: new Map(),
  lastCollectAt: new Map(),
  globalTotal: 0,
};

const COLLECT_COOLDOWN_MS = 1500;

export type CollectResult =
  | {
      ok: true;
      collectible: CollectibleDef;
      fragmentsAwarded: number;
      balance: number;
      globalTotal: number;
    }
  | { ok: false; status: number; error: string };

export function collectCollectible(
  explorerId: string,
  collectibleId: string,
): CollectResult {
  const collectible = collectiblesById.get(collectibleId);
  if (!collectible) {
    return { ok: false, status: 404, error: "Unknown collectible." };
  }
  if (!collectible.isLive || !collectible.isCollectible) {
    return { ok: false, status: 409, error: "This fragment cannot be collected yet." };
  }

  const last = ledger.lastCollectAt.get(explorerId) ?? 0;
  if (Date.now() - last < COLLECT_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "Slow down, explorer." };
  }

  const collected = ledger.collects.get(explorerId) ?? new Set<string>();
  if (collected.has(collectibleId)) {
    return { ok: false, status: 409, error: "Already collected." };
  }

  collected.add(collectibleId);
  ledger.collects.set(explorerId, collected);
  ledger.lastCollectAt.set(explorerId, Date.now());
  const balance =
    (ledger.balances.get(explorerId) ?? 0) + collectible.fragments;
  ledger.balances.set(explorerId, balance);
  ledger.globalTotal += collectible.fragments;

  return {
    ok: true,
    collectible,
    fragmentsAwarded: collectible.fragments,
    balance,
    globalTotal: ledger.globalTotal,
  };
}

export interface ProceduralLootInput {
  lootId: string;
  kind: "fragment" | "crystal";
  name: string;
  rarity: string;
  fragments: number;
}

/** Value bounds the server will honor for procedural biome loot. */
const LOOT_BOUNDS: Record<ProceduralLootInput["kind"], { min: number; max: number }> = {
  fragment: { min: 1, max: 3 },
  crystal: { min: 10, max: 1_000_000 },
};

/** Rapid floor-scavenging is the point — a much shorter cooldown here. */
const LOOT_COOLDOWN_MS = 200;

export type ProceduralCollectResult =
  | { ok: true; fragmentsAwarded: number; balance: number; globalTotal: number }
  | { ok: false; status: number; error: string };

/**
 * Collects procedurally generated biome loot (floor fragments and center
 * crystals). These have no registry entry — the id encodes the biome and
 * slot — so validation is bounds-based: the client is trusted only within
 * the marketing-collectible value ranges.
 */
export function collectProceduralLoot(
  explorerId: string,
  input: ProceduralLootInput,
): ProceduralCollectResult {
  const bounds = LOOT_BOUNDS[input.kind];
  if (input.fragments < bounds.min || input.fragments > bounds.max) {
    return { ok: false, status: 400, error: "Loot value out of range." };
  }

  const last = ledger.lastCollectAt.get(explorerId) ?? 0;
  if (Date.now() - last < LOOT_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "Slow down, explorer." };
  }

  const collected = ledger.collects.get(explorerId) ?? new Set<string>();
  if (collected.has(input.lootId)) {
    return { ok: false, status: 409, error: "Already collected." };
  }

  collected.add(input.lootId);
  ledger.collects.set(explorerId, collected);
  ledger.lastCollectAt.set(explorerId, Date.now());
  const balance = (ledger.balances.get(explorerId) ?? 0) + input.fragments;
  ledger.balances.set(explorerId, balance);
  ledger.globalTotal += input.fragments;

  return {
    ok: true,
    fragmentsAwarded: input.fragments,
    balance,
    globalTotal: ledger.globalTotal,
  };
}

export function getProgress(explorerId?: string) {
  return {
    total: ledger.globalTotal,
    goal: VORINTHEX_GALAXY_REGISTRY.fragmentGoal,
    label: VORINTHEX_GALAXY_REGISTRY.fragmentCounterLabel,
    balance: explorerId ? (ledger.balances.get(explorerId) ?? 0) : 0,
    collected: explorerId
      ? Array.from(ledger.collects.get(explorerId) ?? [])
      : [],
  };
}
