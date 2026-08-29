import { getActionDefinition } from '@/lib/ai/actions';
import { getExternalModelId, getModel, isProviderAvailable } from '@/lib/ai/providers/registry';
import { NoEligibleRouteError, RouteValidationError, UnknownModelError } from './errors';
import { routeRequestSchema, type RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';

/** Selects the first operational route in action-definition priority order. */
export async function selectRoute(input: RouteRequestInput, deps: RouterDependencies = {}): Promise<RouteDecision> {
  const parsed = routeRequestSchema.safeParse(input);
  if (!parsed.success) throw new RouteValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const request = parsed.data;
  const action = getActionDefinition(request.actionSlug);
  if (!action) throw new NoEligibleRouteError(request.actionSlug, 'action is not registered');
  if (action.modelPolicy === 'none' || action.models.length === 0) {
    throw new NoEligibleRouteError(request.actionSlug, 'action does not declare a model route');
  }

  let candidates = action.models
    .map((binding, declarationOrder) => ({ binding, declarationOrder }))
    .sort((left, right) => right.binding.priority - left.binding.priority || left.declarationOrder - right.declarationOrder);
  if (request.mode === 'model' || request.mode === 'fixed') candidates = candidates.filter(({ binding }) => binding.model === request.modelSlug);
  if (request.mode === 'fixed') candidates = candidates.filter(({ binding }) => binding.provider === request.providerSlug);

  if ((request.mode === 'model' || request.mode === 'fixed') && !getModel(request.modelSlug)) throw new UnknownModelError(request.modelSlug);

  for (const { binding } of candidates) {
    const providerModelId = getExternalModelId(binding.model, binding.provider);
    const available = deps.adapters?.[binding.provider] || isProviderAvailable(binding.provider, deps.env ?? process.env);
    if (!providerModelId || !available) continue;
    return { organizationKey: request.organizationKey, actionSlug: action.id, modelSlug: binding.model, providerSlug: binding.provider, providerModelId };
  }
  throw new NoEligibleRouteError(request.actionSlug, 'no registered priority route has valid environment configuration');
}
