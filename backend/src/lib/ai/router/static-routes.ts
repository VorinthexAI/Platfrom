import { createAwsBedrockProvider } from '@/lib/ai/providers/aws-bedrock';
import { resolveAwsCredentials } from '@/lib/ai/providers/aws-sigv4';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';

interface StaticProviderRoute {
  actionSlug: string;
  modelSlug: string;
  providerSlug: ProviderId;
}

export const STATIC_PROVIDER_ROUTES: readonly StaticProviderRoute[] = [{
  actionSlug: 'embed',
  modelSlug: 'amazon.titan-embed-text-v2',
  providerSlug: 'aws-bedrock',
}];

export function isStaticProviderRoute(route: StaticProviderRoute): boolean {
  return STATIC_PROVIDER_ROUTES.some((candidate) =>
    candidate.actionSlug === route.actionSlug
    && candidate.modelSlug === route.modelSlug
    && candidate.providerSlug === route.providerSlug);
}

export function createStaticProviderAdapter(route: StaticProviderRoute): ProviderAdapter | undefined {
  if (!isStaticProviderRoute(route)) return undefined;
  try {
    resolveAwsCredentials();
    return createAwsBedrockProvider();
  } catch {
    return undefined;
  }
}
