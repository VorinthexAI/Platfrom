import { getDefaultOrganizationProviderRepository } from '@/lib/ai/organization-providers/repository';
import { getActionBySlug } from '@/lib/db/actions.node';
import { getModelById, getModelBySlug } from '@/lib/db/models.node';
import { listEnabledModelActionsByActionKey } from '@/lib/db/model-actions.node';
import { listEnabledModelProvidersByModelKey } from '@/lib/db/model-providers.node';
import { getProviderById, getProviderBySlug } from '@/lib/db/providers.node';
import { NoEligibleRouteError, ProviderNotEnabledForOrganizationError, RouteValidationError, UnknownModelError, UnknownProviderError } from './errors';
import { routeRequestSchema, type RouteRequestInput } from './route-request';
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
  const adapters = deps.adapters ?? {};
  const action = await data.getActionBySlug(request.actionSlug);
  if (!action || !action.enabled) throw new NoEligibleRouteError(request.actionSlug, 'action is missing or disabled');

  const selectedModel = request.mode === 'model' || request.mode === 'fixed' ? await data.getModelBySlug(request.modelSlug) : null;
  if ((request.mode === 'model' || request.mode === 'fixed') && !selectedModel) throw new UnknownModelError(request.modelSlug);
  const selectedProvider = request.mode === 'fixed' ? await data.getProviderBySlug(request.providerSlug) : null;
  if (request.mode === 'fixed' && !selectedProvider) throw new UnknownProviderError(request.providerSlug);

  const allowedProviderKeys = new Set(await data.listOrganizationProviderKeys(request.organizationKey));
  if (selectedProvider && !allowedProviderKeys.has(selectedProvider.key)) {
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
      if (!allowedProviderKeys.has(modelProvider.providerKey)) continue;
      const provider = selectedProvider?.key === modelProvider.providerKey ? selectedProvider : await data.getProviderByKey(modelProvider.providerKey);
      if (!provider || !adapters[provider.slug]) continue;
      return {
        organizationKey: request.organizationKey,
        actionKey: action.key,
        actionSlug: action.slug,
        modelKey: model.key,
        modelSlug: model.slug,
        providerKey: provider.key,
        providerSlug: provider.slug,
        providerModelId: modelProvider.providerModelId,
      };
    }
  }
  throw new NoEligibleRouteError(request.actionSlug, 'no enabled priority route is allowed and executable');
}
