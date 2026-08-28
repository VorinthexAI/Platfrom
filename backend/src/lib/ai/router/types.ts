import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';
import type { ActionId } from '@/lib/ai/actions';
import type { Model } from '@/lib/db/models.node';
import type { ModelProvider } from '@/lib/db/model-providers.node';
import type { Provider } from '@/lib/db/providers.node';
import type { OrganizationCredentialsRepository } from '@/lib/ai/organization-credentials';

interface RouteDecisionBase {
  organizationKey: string;
  actionSlug: ActionId;
  modelKey: string;
  modelSlug: Model['slug'];
  providerKey: string;
  providerSlug: Provider['slug'];
  providerModelId: string;
}
export type RouteDecision = RouteDecisionBase & (
  | { credentialSource: 'organization'; /** Global provider key used to load organization credentials. */ orgProviderKey: string }
  | { credentialSource: 'environment'; orgProviderKey?: never }
);
export interface RouterDataSource {
  getModelBySlug(slug: Model['slug']): Promise<Model | null>;
  getProviderBySlug(slug: Provider['slug']): Promise<Provider | null>;
  getProviderByKey(key: string): Promise<Provider | null>;
  listModelProviders(modelKey: string): Promise<readonly ModelProvider[]>;
  listOrganizationProviderKeys(organizationKey: string): Promise<readonly string[]>;
}
export interface RouterDependencies {
  data?: RouterDataSource;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  credentials?: OrganizationCredentialsRepository;
}
