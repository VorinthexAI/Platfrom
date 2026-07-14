import { ACTION_REGISTRY } from '@/lib/ai/actions';
import type { ModelDefinition } from '@/lib/ai/models/types';
import type { ProviderId } from '@/lib/ai/providers/types';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError, UnknownModelError } from './errors';
import type { RouteRequest } from './route-request';
import type { RouteCandidate } from './types';

/** Everything candidate generation needs, resolved by the caller — keeps this module pure and deterministic. */
export interface CandidateGenerationContext {
  /** Provider ids loaded server-side from `organization_providers` for THIS organization. */
  enabledProviderIds: readonly ProviderId[];
  /** Providers whose adapter is actually constructable right now (configured secrets). */
  availableProviderIds: ReadonlySet<ProviderId>;
  /** The model registry (or a test double). */
  models: readonly ModelDefinition[];
}

/**
 * Expands the request into every eligible model/provider route candidate,
 * applying the full filter chain:
 *
 *  1. the action must exist in the registry,
 *  2. models must claim the action,
 *  3. `model` mode filters to the selected model,
 *  4. `fixed` mode filters to the selected model AND provider,
 *  5. models are expanded into model/provider route candidates,
 *  6. disabled models are removed,
 *  7. disabled routes are removed,
 *  8. providers not in the organization allow-list are removed,
 *  9. unknown providers are removed (route validation guarantees ids, the
 *     allow-list intersection re-guarantees it),
 * 10. routes whose provider adapter is unavailable are removed,
 * 11. routes lacking an action profile are removed,
 * 12. an empty result is a typed, deterministic error.
 *
 * Iteration order is deterministic: models sorted by id, routes in
 * declaration order — final ranking happens in scoring.
 */
export function generateCandidates(request: RouteRequest, context: CandidateGenerationContext): RouteCandidate[] {
  const { actionId, organizationId } = request;
  // The request schema already constrains actionId to ACTION_IDS; this
  // registry check keeps the invariant when callers bypass parsing.
  if (!(actionId in ACTION_REGISTRY)) {
    throw new NoEligibleRouteError(actionId, 'action is not registered');
  }

  const enabledProviders = new Set(context.enabledProviderIds);

  let models = [...context.models].sort((a, b) => (a.id < b.id ? -1 : 1)).filter((model) => model.actions.includes(actionId));

  if (request.mode === 'model' || request.mode === 'fixed') {
    const selected = context.models.find((model) => model.id === request.modelId);
    if (!selected) throw new UnknownModelError(request.modelId);
    if (!selected.actions.includes(actionId)) {
      throw new NoEligibleRouteError(actionId, `model ${request.modelId} does not support this action`);
    }
    models = [selected];
  }

  if (request.mode === 'fixed') {
    // A fixed provider outside the organization allow-list is an explicit,
    // deterministic rejection — a manual override can never bypass
    // organization restrictions.
    if (!enabledProviders.has(request.providerId)) {
      throw new ProviderNotEnabledForOrganizationError(organizationId, request.providerId);
    }
  }

  const candidates: RouteCandidate[] = [];
  for (const model of models) {
    if (!model.enabled) continue;
    const profile = model.actionProfiles[actionId];
    if (!profile) continue;
    for (const route of model.routes) {
      if (!route.enabled) continue;
      if (request.mode === 'fixed' && !request.allowFallback && route.providerId !== request.providerId) continue;
      if (!enabledProviders.has(route.providerId)) continue;
      if (!context.availableProviderIds.has(route.providerId)) continue;
      candidates.push({ actionId, model, route, profile });
    }
  }

  if (candidates.length === 0) {
    throw new NoEligibleRouteError(
      actionId,
      'no enabled model/provider route is both allowed for the organization and currently available',
    );
  }

  return candidates;
}
