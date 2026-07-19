import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';
import type { Action } from '@/lib/db/actions.node';
import type { Model } from '@/lib/db/models.node';
import type { ModelAction } from '@/lib/db/model-actions.node';
import type { ModelProvider } from '@/lib/db/model-providers.node';
import type { Provider } from '@/lib/db/providers.node';
import type { OrganizationCredentialsRepository } from '@/lib/ai/organization-credentials';

export interface RouteDecision {
  organizationKey: string;
  actionKey: string;
  actionSlug: Action['slug'];
  modelKey: string;
  modelSlug: Model['slug'];
  providerKey: string;
  /** Global provider key enabled for this organization and used to load its credentials. */
  orgProviderKey: string;
  providerSlug: Provider['slug'];
  providerModelId: string;
}
export interface RouterDataSource {
  getActionBySlug(slug: Action['slug']): Promise<Action | null>;
  getModelBySlug(slug: Model['slug']): Promise<Model | null>;
  getModelByKey(key: string): Promise<Model | null>;
  getProviderBySlug(slug: Provider['slug']): Promise<Provider | null>;
  getProviderByKey(key: string): Promise<Provider | null>;
  listModelActions(actionKey: string): Promise<readonly ModelAction[]>;
  listModelProviders(modelKey: string): Promise<readonly ModelProvider[]>;
  listOrganizationProviderKeys(organizationKey: string): Promise<readonly string[]>;
}
export interface RouterDependencies {
  data?: RouterDataSource;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  credentials?: OrganizationCredentialsRepository;
}
