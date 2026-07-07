/**
 * Fragment-count formatting shared by the leaderboard, drawers, and
 * toasts: 200, 443, 1.32k, 10.23k, 1M, 1.10M, 10.20M — two decimals in
 * the compact ranges, with only a fully-empty ".00" dropped.
 */
export function formatFragments(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 1000) return String(n);
  const suffix = n < 1_000_000 ? "k" : "M";
  const scaled = n < 1_000_000 ? n / 1000 : n / 1_000_000;
  return `${scaled.toFixed(2).replace(/\.00$/, "")}${suffix}`;
}
