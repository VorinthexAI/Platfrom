import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers/repository';
import { getActionBySlug } from '@/lib/db/actions.node';
import { getModelById, getModelBySlug } from '@/lib/db/models.node';
import { listEnabledModelActionsByActionKey } from '@/lib/db/model-actions.node';
import { listEnabledModelProvidersByModelKey } from '@/lib/db/model-providers.node';
import { getProviderById, getProviderBySlug } from '@/lib/db/providers.node';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError, RouteValidationError, UnknownModelError, UnknownProviderError } from './errors';
import { routeRequestSchema, type RouteRequestInput } from './route-request';
import { isStaticProviderRoute } from './static-routes';
import type { RouteDecision, RouterDataSource, RouterDependencies } from './types';

const defaultDataSource: RouterDataSource = {
  getActionBySlug,
  getModelBySlug,
  getModelByKey: getModelById,
  getProviderBySlug,
  getProviderByKey: getProviderById,
  listModelActions: listEnabledModelActionsByActionKey,
  listModelProviders: listEnabledModelProvidersByModelKey,
  listOrganizationProviderKeys: (organizationKey) => getDefaultOrganizationProviderRepository().listProviderKeys(organizationKey),
};

/** Selects the first valid persisted route using modelAction priority only. */
export async function selectRoute(input: RouteRequestInput, deps: RouterDependencies = {}): Promise<RouteDecision> {
  const parsed = routeRequestSchema.safeParse(input);
  if (!parsed.success) throw new RouteValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const request = parsed.data;
  const data = deps.data ?? defaultDataSource;
  const action = await data.getActionBySlug(request.actionSlug);
  if (!action || !action.enabled) throw new NoEligibleRouteError(request.actionSlug, 'action is missing or disabled');

  const selectedModel = request.mode === 'model' || request.mode === 'fixed' ? await data.getModelBySlug(request.modelSlug) : null;
  if ((request.mode === 'model' || request.mode === 'fixed') && !selectedModel) throw new UnknownModelError(request.modelSlug);
  const selectedProvider = request.mode === 'fixed'
    ? await data.getProviderBySlug(request.providerSlug)
    : request.organizationProviderKey
      ? await data.getProviderByKey(request.organizationProviderKey)
      : null;
  if ((request.mode === 'fixed' || request.organizationProviderKey) && !selectedProvider) {
    throw new UnknownProviderError(request.mode === 'fixed' ? request.providerSlug : request.organizationProviderKey!);
  }

  const allowedProviderKeys = new Set(await data.listOrganizationProviderKeys(request.organizationKey));
  const selectedStaticRoute = selectedModel && selectedProvider && !request.organizationProviderKey && isStaticProviderRoute({
    actionSlug: action.slug,
    modelSlug: selectedModel.slug,
    providerSlug: selectedProvider.slug,
  });
  if (selectedProvider && !allowedProviderKeys.has(selectedProvider.key) && !selectedStaticRoute) {
    throw new ProviderNotEnabledForOrganizationError(request.organizationKey, selectedProvider.slug);
  }

  let modelActions = await data.listModelActions(action.key);
  modelActions = modelActions
    .filter((link) => link.enabled)
    .sort((left, right) => right.priority - left.priority || left.key.localeCompare(right.key));
  if (selectedModel) modelActions = modelActions.filter((link) => link.modelKey === selectedModel.key);

  for (const modelAction of modelActions) {
    const model = selectedModel?.key === modelAction.modelKey ? selectedModel : await data.getModelByKey(modelAction.modelKey);
    if (!model?.enabled) continue;
    let modelProviders = await data.listModelProviders(model.key);
    modelProviders = modelProviders
      .filter((link) => link.enabled)
      .sort((left, right) => left.providerKey.localeCompare(right.providerKey) || left.key.localeCompare(right.key));
    if (selectedProvider) modelProviders = modelProviders.filter((link) => link.providerKey === selectedProvider.key);
    for (const modelProvider of modelProviders) {
      const provider = selectedProvider?.key === modelProvider.providerKey ? selectedProvider : await data.getProviderByKey(modelProvider.providerKey);
      if (!provider) continue;
      const staticRoute = !request.organizationProviderKey && isStaticProviderRoute({ actionSlug: action.slug, modelSlug: model.slug, providerSlug: provider.slug });
      if (!staticRoute && !allowedProviderKeys.has(modelProvider.providerKey)) continue;
      return {
        organizationKey: request.organizationKey,
        actionKey: action.key,
        actionSlug: action.slug,
        modelKey: model.key,
        modelSlug: model.slug,
        providerKey: provider.key,
        providerSlug: provider.slug,
        providerModelId: modelProvider.providerModelId,
        ...(staticRoute
          ? { credentialSource: 'environment' as const }
          : { credentialSource: 'organization' as const, orgProviderKey: request.organizationProviderKey ?? provider.key }),
      };
    }
  }
  throw new NoEligibleRouteError(request.actionSlug, 'no enabled priority route is allowed and executable');
}
