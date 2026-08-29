import type { ModelId, ProviderEnvironment } from '@/lib/ai/providers/registry';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';
import type { ActionId } from '@/lib/ai/actions';

export interface RouteDecision {
  organizationKey: string;
  actionSlug: ActionId;
  modelSlug: ModelId;
  providerSlug: ProviderId;
  providerModelId: string;
}
export interface RouterDependencies {
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  env?: ProviderEnvironment;
}
