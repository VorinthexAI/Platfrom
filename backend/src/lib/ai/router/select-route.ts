import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers/repository';
import { getActionDefinition } from '@/lib/ai/actions';
import { getModelBySlug } from '@/lib/db/models.node';
import { listEnabledModelProvidersByModelKey } from '@/lib/db/model-providers.node';
import { getProviderById, getProviderBySlug } from '@/lib/db/providers.node';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError, RouteValidationError, UnknownModelError, UnknownProviderError } from './errors';
import { routeRequestSchema, type RouteRequestInput } from './route-request';
import { isStaticProvider } from './static-routes';
import type { RouteDecision, RouterDataSource, RouterDependencies } from './types';

const defaultDataSource: RouterDataSource = {
  getModelBySlug,
  getProviderBySlug,
  getProviderByKey: getProviderById,
  listModelProviders: listEnabledModelProvidersByModelKey,
  listOrganizationProviderKeys: (organizationKey) => getDefaultOrganizationProviderRepository().listProviderKeys(organizationKey),
};

/** Selects the first operational route in action-definition priority order. */
export async function selectRoute(input: RouteRequestInput, deps: RouterDependencies = {}): Promise<RouteDecision> {
  const parsed = routeRequestSchema.safeParse(input);
  if (!parsed.success) throw new RouteValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const request = parsed.data;
  const data = deps.data ?? defaultDataSource;
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

  const selectedModel = request.mode === 'model' || request.mode === 'fixed' ? await data.getModelBySlug(request.modelSlug) : null;
  if ((request.mode === 'model' || request.mode === 'fixed') && !selectedModel) throw new UnknownModelError(request.modelSlug);
  const fixedProvider = request.mode === 'fixed' ? await data.getProviderBySlug(request.providerSlug) : null;
  if (request.mode === 'fixed' && !fixedProvider) throw new UnknownProviderError(request.providerSlug);
  const organizationProvider = request.organizationProviderKey ? await data.getProviderByKey(request.organizationProviderKey) : null;
  if (request.organizationProviderKey && !organizationProvider) throw new UnknownProviderError(request.organizationProviderKey);

  const allowedProviderKeys = new Set(await data.listOrganizationProviderKeys(request.organizationKey));
  for (const provider of [fixedProvider, organizationProvider]) {
    const staticProvider = provider && !request.organizationProviderKey && isStaticProvider(provider.slug);
    if (provider && !allowedProviderKeys.has(provider.key) && !staticProvider) {
      throw new ProviderNotEnabledForOrganizationError(request.organizationKey, provider.slug);
    }
  }

  for (const { binding } of candidates) {
    const model = selectedModel?.slug === binding.model ? selectedModel : await data.getModelBySlug(binding.model);
    if (!model?.enabled) continue;
    const provider = fixedProvider?.slug === binding.provider
      ? fixedProvider
      : organizationProvider?.slug === binding.provider
        ? organizationProvider
        : await data.getProviderBySlug(binding.provider);
    if (!provider || organizationProvider && organizationProvider.key !== provider.key) continue;
    let modelProviders = await data.listModelProviders(model.key);
    modelProviders = modelProviders
      .filter((link) => link.enabled && link.providerKey === provider.key)
      .sort((left, right) => left.providerKey.localeCompare(right.providerKey) || left.key.localeCompare(right.key));
    for (const modelProvider of modelProviders) {
      const staticProvider = !request.organizationProviderKey && isStaticProvider(provider.slug);
      if (!staticProvider && !allowedProviderKeys.has(provider.key)) continue;
      return {
        organizationKey: request.organizationKey,
        actionSlug: action.id,
        modelKey: model.key,
        modelSlug: model.slug,
        providerKey: provider.key,
        providerSlug: provider.slug,
        providerModelId: modelProvider.providerModelId,
        ...(staticProvider
          ? { credentialSource: 'environment' as const }
          : { credentialSource: 'organization' as const, orgProviderKey: provider.key }),
      };
    }
  }
  throw new NoEligibleRouteError(request.actionSlug, 'no enabled priority route is allowed and executable');
}
