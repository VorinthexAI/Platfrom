import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers/repository';
import { MODEL_REGISTRY } from '@/lib/ai/models';
import { getDefaultProviderAdapters } from '@/lib/ai/providers';
import type { ProviderId } from '@/lib/ai/providers/types';
import { generateCandidates } from './candidates';
import { NoEligibleRouteError, RouteValidationError } from './errors';
import { routeRequestSchema, type RouteRequest, type RouteRequestInput } from './route-request';
import { rankCandidates, scoreCandidate } from './scoring';
import type { RouteCandidate, RouteDecision, RouteFallback, RouterDependencies, RoutingStrategy } from './types';

function toFallback(candidate: RouteCandidate, strategy: RoutingStrategy): RouteFallback {
  return {
    modelId: candidate.model.id,
    providerId: candidate.route.providerId,
    externalModelId: candidate.route.externalModelId,
    score: scoreCandidate(candidate, strategy),
  };
}

function buildDecision(
  request: RouteRequest,
  primary: RouteCandidate,
  fallbacks: readonly RouteCandidate[],
  strategy: RoutingStrategy,
): RouteDecision {
  return {
    actionId: request.actionId,
    organizationId: request.organizationId,
    modelId: primary.model.id,
    providerId: primary.route.providerId,
    externalModelId: primary.route.externalModelId,
    score: scoreCandidate(primary, strategy),
    fallbacks: fallbacks.map((candidate) => toFallback(candidate, strategy)),
  };
}

/**
 * Resolves the best executable route for a request. The organization's
 * enabled providers are loaded server-side from `organizationProviders`
 * (never accepted from the client), models come from the registry, and
 * only providers with a constructable adapter are considered.
 */
export async function selectRoute(request: RouteRequestInput, deps: RouterDependencies = {}): Promise<RouteDecision> {
  const parsed = routeRequestSchema.safeParse(request);
  if (!parsed.success) {
    throw new RouteValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  const validRequest = parsed.data;

  const organizationProviders = deps.organizationProviders ?? getDefaultOrganizationProviderRepository();
  const enabledProviderIds = await organizationProviders.listProviderIds(validRequest.organizationId);

  const adapters = deps.adapters ?? getDefaultProviderAdapters();
  const availableProviderIds = new Set(Object.keys(adapters) as ProviderId[]);

  const models = deps.models ?? Object.values(MODEL_REGISTRY);

  const candidates = generateCandidates(validRequest, { enabledProviderIds, availableProviderIds, models });

  const strategy: RoutingStrategy = validRequest.mode === 'fixed' ? 'balanced' : validRequest.strategy;
  const ranked = rankCandidates(candidates, strategy);

  if (validRequest.mode === 'fixed') {
    // The fixed pair itself must be executable — a manual override is
    // never silently replaced, even with allowFallback.
    const primary = ranked.find(
      (candidate) => candidate.model.id === validRequest.modelId && candidate.route.providerId === validRequest.providerId,
    );
    if (!primary) {
      throw new NoEligibleRouteError(
        validRequest.actionId,
        `fixed route ${validRequest.modelId} via ${validRequest.providerId} is not currently executable`,
      );
    }
    const fallbacks = validRequest.allowFallback ? ranked.filter((candidate) => candidate !== primary) : [];
    return buildDecision(validRequest, primary, fallbacks, strategy);
  }

  const [primary, ...fallbacks] = ranked;
  if (!primary) {
    throw new NoEligibleRouteError(validRequest.actionId, 'no candidates after ranking');
  }
  return buildDecision(validRequest, primary, fallbacks, strategy);
}
