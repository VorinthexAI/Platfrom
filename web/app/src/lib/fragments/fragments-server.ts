import "server-only";
import { VORINTHEX_GALAXY_REGISTRY } from "@/lib/galaxy/registry";
import type { CollectibleDef } from "@/lib/galaxy/registry-types";

/**
 * Server-side fragment ledger. Collectibles are defined in the registry —
 * the client is never trusted: every claim is validated here.
 *
 * TODO: replace the in-memory store with the platform backend (Redis/DB)
 * before launch — balances and the global counter currently reset on
 * server restart.
 */

const collectiblesById = new Map(
  VORINTHEX_GALAXY_REGISTRY.collectibles.map((c) => [c.id, c]),
);

interface Ledger {
  /** explorerId -> claimed collectible ids */
  claims: Map<string, Set<string>>;
  /** explorerId -> fragment balance */
  balances: Map<string, number>;
  /** explorerId -> last claim timestamp (rate limiting) */
  lastClaimAt: Map<string, number>;
  globalTotal: number;
}

const ledger: Ledger = {
  claims: new Map(),
  balances: new Map(),
  lastClaimAt: new Map(),
  globalTotal: 0,
};

const CLAIM_COOLDOWN_MS = 1500;

export type ClaimResult =
  | {
      ok: true;
      collectible: CollectibleDef;
      fragmentsAwarded: number;
      balance: number;
      globalTotal: number;
    }
  | { ok: false; status: number; error: string };

export function claimCollectible(
  explorerId: string,
  collectibleId: string,
): ClaimResult {
  const collectible = collectiblesById.get(collectibleId);
  if (!collectible) {
    return { ok: false, status: 404, error: "Unknown collectible." };
  }
  if (!collectible.isLive || !collectible.isClaimable) {
    return { ok: false, status: 409, error: "This fragment cannot be claimed yet." };
  }

  const last = ledger.lastClaimAt.get(explorerId) ?? 0;
  if (Date.now() - last < CLAIM_COOLDOWN_MS) {
    return { ok: false, status: 429, error: "Slow down, explorer." };
  }

  const claimed = ledger.claims.get(explorerId) ?? new Set<string>();
  if (claimed.has(collectibleId)) {
    return { ok: false, status: 409, error: "Already claimed." };
  }

  claimed.add(collectibleId);
  ledger.claims.set(explorerId, claimed);
  ledger.lastClaimAt.set(explorerId, Date.now());
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

export function getProgress(explorerId?: string) {
  return {
    total: ledger.globalTotal,
    goal: VORINTHEX_GALAXY_REGISTRY.fragmentGoal,
    label: VORINTHEX_GALAXY_REGISTRY.fragmentCounterLabel,
    balance: explorerId ? (ledger.balances.get(explorerId) ?? 0) : 0,
    claimed: explorerId
      ? Array.from(ledger.claims.get(explorerId) ?? [])
      : [],
  };
}
