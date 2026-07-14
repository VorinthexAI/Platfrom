import { z } from 'zod';
import type { ActionId } from '@/lib/ai/actions/types';
import type { ModelActionProfile, ModelDefinition, ModelId, ModelRoute } from '@/lib/ai/models/types';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';
import type { OrganizationProviderRepository } from '@/lib/ai/organization-providers/types';

export const ROUTING_STRATEGIES = ['balanced', 'quality', 'speed', 'cost'] as const;

export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const routingStrategySchema = z.enum(ROUTING_STRATEGIES);

/** One executable model/provider pair that survived every eligibility filter. */
export interface RouteCandidate {
  actionId: ActionId;
  model: ModelDefinition;
  route: ModelRoute;
  profile: ModelActionProfile;
}

/** Just enough to execute an alternative route — never secrets or config. */
export interface RouteFallback {
  modelId: ModelId;
  providerId: ProviderId;
  externalModelId: string;
  score: number;
}

export interface RouteDecision {
  actionId: ActionId;
  organizationId: string;

  modelId: ModelId;
  providerId: ProviderId;
  externalModelId: string;

  score: number;

  fallbacks: readonly RouteFallback[];
}

/**
 * Injection points for tests and alternative wiring. Defaults: the static
 * MODEL_REGISTRY, adapters built from `process.env`, and the repository
 * bound to the shared ArangoDB client. The organization allow-list is
 * ALWAYS loaded server-side through the repository — there is deliberately
 * no way to pass a client-supplied list of enabled providers.
 */
export interface RouterDependencies {
  models?: readonly ModelDefinition[];
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  organizationProviders?: Pick<OrganizationProviderRepository, 'listProviderIds'>;
}
