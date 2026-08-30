import { getActionDefinition, type ActionRouteId } from '@/lib/ai/actions';
import { getExternalModelId, getModel, isProviderAvailable } from '@/lib/ai/providers/registry';
import { NoEligibleRouteError, RouteValidationError, UnknownModelError } from './errors';
import { routeRequestSchema, type RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';

/** Selects every operational route in trusted action-slot order. */
export async function selectRoutes(input: RouteRequestInput, deps: RouterDependencies = {}, routeIds?: readonly ActionRouteId[]): Promise<RouteDecision[]> {
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
  if (routeIds?.length) {
    const slots = routeIds.map((routeId) => {
      const prefix = `${action.id}.`;
      if (!routeId.startsWith(prefix)) throw new RouteValidationError(`route ${routeId} does not belong to action ${action.id}`);
      return routeId.slice(prefix.length);
    });
    if (new Set(slots).size !== slots.length) throw new RouteValidationError('route list contains duplicate slots');
    const order = new Map(slots.map((slot, index) => [slot, index]));
    candidates = candidates.filter(({ binding }) => order.has(binding.slot)).sort((left, right) => order.get(left.binding.slot)! - order.get(right.binding.slot)!);
  }
  if (request.mode === 'model' || request.mode === 'fixed') candidates = candidates.filter(({ binding }) => binding.model === request.modelSlug);
  if (request.mode === 'fixed') candidates = candidates.filter(({ binding }) => binding.provider === request.providerSlug);

  if ((request.mode === 'model' || request.mode === 'fixed') && !getModel(request.modelSlug)) throw new UnknownModelError(request.modelSlug);

  const decisions: RouteDecision[] = [];
  for (const { binding } of candidates) {
    const providerModelId = getExternalModelId(binding.model, binding.provider);
    const available = deps.adapters?.[binding.provider] || isProviderAvailable(binding.provider, deps.env ?? process.env);
    if (!providerModelId || !available) continue;
    decisions.push({ organizationKey: request.organizationKey, actionSlug: action.id, modelSlug: binding.model, providerSlug: binding.provider, providerModelId });
  }
  if (!decisions.length) throw new NoEligibleRouteError(request.actionSlug, 'no registered priority route has valid environment configuration');
  return decisions;
}

/** Selects the first operational route in action-definition priority order. */
export async function selectRoute(input: RouteRequestInput, deps: RouterDependencies = {}): Promise<RouteDecision> {
  return (await selectRoutes(input, deps))[0]!;
}
