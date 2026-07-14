import type { RouteCandidate, RoutingStrategy } from './types';

export interface StrategyWeights {
  quality: number;
  speed: number;
  costEfficiency: number;
  reliability: number;
}

/**
 * The ONLY place routing weights live — never scattered across model
 * files. Each strategy's weights sum to 1 so scores stay in [0, 1].
 */
export const STRATEGY_WEIGHTS: Record<RoutingStrategy, StrategyWeights> = {
  balanced: { quality: 0.35, speed: 0.2, costEfficiency: 0.2, reliability: 0.25 },
  quality: { quality: 0.6, speed: 0.1, costEfficiency: 0.05, reliability: 0.25 },
  speed: { quality: 0.15, speed: 0.6, costEfficiency: 0.1, reliability: 0.15 },
  cost: { quality: 0.15, speed: 0.1, costEfficiency: 0.6, reliability: 0.15 },
};

export function scoreCandidate(candidate: RouteCandidate, strategy: RoutingStrategy): number {
  const weights = STRATEGY_WEIGHTS[strategy];
  const { profile } = candidate;
  return (
    profile.quality * weights.quality +
    profile.speed * weights.speed +
    profile.costEfficiency * weights.costEfficiency +
    profile.reliability * weights.reliability
  );
}

/**
 * Deterministic total order — routing must never be random. Ties break by:
 * higher total score → higher reliability → higher quality →
 * lexicographically smaller model id → lexicographically smaller provider id.
 */
export function compareCandidates(a: RouteCandidate, b: RouteCandidate, strategy: RoutingStrategy): number {
  const scoreDiff = scoreCandidate(b, strategy) - scoreCandidate(a, strategy);
  if (scoreDiff !== 0) return scoreDiff;
  if (a.profile.reliability !== b.profile.reliability) return b.profile.reliability - a.profile.reliability;
  if (a.profile.quality !== b.profile.quality) return b.profile.quality - a.profile.quality;
  if (a.model.id !== b.model.id) return a.model.id < b.model.id ? -1 : 1;
  if (a.route.providerId !== b.route.providerId) return a.route.providerId < b.route.providerId ? -1 : 1;
  return 0;
}

/** Candidates ranked best-first under the strategy's deterministic order. */
export function rankCandidates(candidates: readonly RouteCandidate[], strategy: RoutingStrategy): RouteCandidate[] {
  return [...candidates].sort((a, b) => compareCandidates(a, b, strategy));
}
