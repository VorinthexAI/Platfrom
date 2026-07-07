import type { AssetRecord, LockRecord } from "./types";

export function lockRulesFor(asset: AssetRecord, locks: Record<string, LockRecord>): string[] {
  return locks[asset.slug]?.rules ?? [];
}

export function isFrozen(asset: AssetRecord, locks: Record<string, LockRecord>): boolean {
  return locks[asset.slug]?.lockLevel === "frozen";
}

export function defaultLockRules(asset: AssetRecord, review?: string): string[] {
  const base = [
    asset.description || "Preserve the accepted visual identity.",
    "Preserve centered silhouette and core geometry.",
    "No extra text.",
    "No unrelated symbols.",
    "Keep transparent export valid."
  ];
  if (review) base.push("Follow accepted review strengths and avoid listed problems.");
  return base;
}
