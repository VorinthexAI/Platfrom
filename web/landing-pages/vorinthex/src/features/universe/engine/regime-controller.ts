// neural-map.md §9.4 — the per-frame regime/LOD transition decision loop,
// plus §8.1's regime thresholds and hysteresis-gapped boundary crossing.
//
// Runs once per frame from a single top-level `useFrame`, NOT per-node.

import type { Regime } from "../types";

/** §8.1's placeholder distance bands (world units, pre-origin-rebasing). */
export const REGIME_BOUNDARIES = {
  r3ToR2: 50,
  r2ToR1: 1000,
  r1ToR0: 10000,
} as const;

/** Ordered coarsest→finest is R0..R3; here finest→coarsest for boundary indexing. */
const REGIME_ORDER: Regime[] = ["R3", "R2", "R1", "R0"];
const REGIME_THRESHOLDS = [
  REGIME_BOUNDARIES.r3ToR2,
  REGIME_BOUNDARIES.r2ToR1,
  REGIME_BOUNDARIES.r1ToR0,
];

/** ~20% hysteresis gap per §8.1/§9.4 — prevents boundary flicker/thrashing. */
export const HYSTERESIS_FACTOR = 0.2;

export function classifyRegime(distance: number): Regime {
  if (distance < REGIME_BOUNDARIES.r3ToR2) return "R3";
  if (distance < REGIME_BOUNDARIES.r2ToR1) return "R2";
  if (distance < REGIME_BOUNDARIES.r1ToR0) return "R1";
  return "R0";
}

/**
 * True if crossing from `current` to `candidate` at `distance` clears the
 * hysteresis gap. Entering a *finer* regime (zooming in) is immediate;
 * falling back to a *coarser* regime (zooming out) requires clearing the
 * boundary by `HYSTERESIS_FACTOR` — e.g. enter R2 at 1000, only fall back to
 * R1 at 1200, matching §8.1's example exactly.
 */
export function withinHysteresisBand(
  distance: number,
  current: Regime,
  candidate: Regime,
): boolean {
  const currentIdx = REGIME_ORDER.indexOf(current);
  const candidateIdx = REGIME_ORDER.indexOf(candidate);
  if (candidateIdx === currentIdx) return true;

  if (candidateIdx < currentIdx) {
    // Moving toward a finer regime (zooming in) — no gap needed.
    return true;
  }

  // Moving toward a coarser regime (zooming out) — clear the boundary
  // directly coarser than `current` by the hysteresis factor.
  const threshold = REGIME_THRESHOLDS[currentIdx];
  if (threshold === undefined) return true; // already coarsest (R0)
  return distance >= threshold * (1 + HYSTERESIS_FACTOR);
}

/**
 * Continuous zoom-tier value (§9.2.3) — e.g. `2.37` means "37% of the way
 * from tier 2 (R1/R2 boundary) to tier 3 (R2/R3 boundary)". Log-linear
 * across the regime anchors, extrapolated (not clamped) past both ends so
 * "zoom forever" stays representable per §8.2's third sub-claim.
 */
const ZOOM_TIER_ANCHORS: Array<{ distance: number; tier: number }> = [
  { distance: 100_000, tier: 0 }, // deep R0
  { distance: REGIME_BOUNDARIES.r1ToR0, tier: 1 },
  { distance: REGIME_BOUNDARIES.r2ToR1, tier: 2 },
  { distance: REGIME_BOUNDARIES.r3ToR2, tier: 3 },
  { distance: 1, tier: 4 }, // deep R3
];

export function distanceToZoomTier(distance: number): number {
  const safeDistance = Math.max(distance, 1e-6);
  const logD = Math.log(safeDistance);

  // Find the bracketing anchor segment (anchors are distance-descending).
  for (let i = 0; i < ZOOM_TIER_ANCHORS.length - 1; i++) {
    const a = ZOOM_TIER_ANCHORS[i];
    const b = ZOOM_TIER_ANCHORS[i + 1];
    if (safeDistance <= a.distance && safeDistance >= b.distance) {
      const logA = Math.log(a.distance);
      const logB = Math.log(b.distance);
      const t = logB === logA ? 0 : (logD - logA) / (logB - logA);
      return a.tier + t * (b.tier - a.tier);
    }
  }

  // Extrapolate past either end using the nearest segment's slope.
  if (safeDistance > ZOOM_TIER_ANCHORS[0].distance) {
    const a = ZOOM_TIER_ANCHORS[0];
    const b = ZOOM_TIER_ANCHORS[1];
    const slope =
      (b.tier - a.tier) / (Math.log(b.distance) - Math.log(a.distance));
    return a.tier + slope * (logD - Math.log(a.distance));
  }
  const last = ZOOM_TIER_ANCHORS[ZOOM_TIER_ANCHORS.length - 1];
  const prev = ZOOM_TIER_ANCHORS[ZOOM_TIER_ANCHORS.length - 2];
  const slope =
    (last.tier - prev.tier) /
    (Math.log(last.distance) - Math.log(prev.distance));
  return last.tier + slope * (logD - Math.log(last.distance));
}

export type RegimeControllerState = {
  currentRegime: Regime;
  zoomTier: number;
  /** Spatial hash of the last viewport that actually triggered a chunk fetch — §9.4's debounce. */
  lastChunkRequestHash: string | null;
};

export function createRegimeControllerState(): RegimeControllerState {
  return { currentRegime: "R0", zoomTier: 0, lastChunkRequestHash: null };
}

export type RegimeTransitionHandlers = {
  onRegimeCrossing?: (from: Regime, to: Regime) => void;
  /** Spatial hash of the camera's current viewport bounding volume + tier — only
   * fetches when this actually changes (§9.4), never every frame. */
  computeViewportHash: () => string;
  ensureChunksLoadedForCurrentView: (hash: string) => void;
};

/**
 * The per-frame decision loop (§9.4). `rawDistance` is the camera's current
 * perceived-zoom distance (§9.2.3's `computePerceivedZoomDistance` input).
 */
export function updateRegime(
  state: RegimeControllerState,
  rawDistance: number,
  handlers: RegimeTransitionHandlers,
): void {
  state.zoomTier = distanceToZoomTier(rawDistance);

  const candidate = classifyRegime(rawDistance);
  if (candidate !== state.currentRegime) {
    const gapped = withinHysteresisBand(
      rawDistance,
      state.currentRegime,
      candidate,
    );
    if (gapped) {
      handlers.onRegimeCrossing?.(state.currentRegime, candidate);
      state.currentRegime = candidate;
    }
    // else: stay put — prevents boundary flicker (§8.1).
  }

  const hash = handlers.computeViewportHash();
  if (hash !== state.lastChunkRequestHash) {
    state.lastChunkRequestHash = hash;
    handlers.ensureChunksLoadedForCurrentView(hash);
  }
}
