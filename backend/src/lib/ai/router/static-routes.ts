import { createAwsBedrockProvider } from '@/lib/ai/providers/aws-bedrock';
import { createAwsPollyProvider } from '@/lib/ai/providers/aws-polly';
import { createAwsTranscribeProvider } from '@/lib/ai/providers/aws-transcribe';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';

export const STATIC_PROVIDER_IDS = ['aws-bedrock', 'aws-polly', 'aws-transcribe'] as const satisfies readonly ProviderId[];

export function isStaticProvider(providerSlug: ProviderId): boolean {
  return STATIC_PROVIDER_IDS.includes(providerSlug as (typeof STATIC_PROVIDER_IDS)[number]);
}

export function createStaticProviderAdapter(providerSlug: ProviderId): ProviderAdapter | undefined {
  if (!isStaticProvider(providerSlug)) return undefined;
  try {
    switch (providerSlug) {
      case 'aws-bedrock': return createAwsBedrockProvider();
      case 'aws-polly': return createAwsPollyProvider();
      case 'aws-transcribe': return createAwsTranscribeProvider();
    }
  } catch {
    return undefined;
  }
}
