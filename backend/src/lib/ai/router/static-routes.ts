import { createAwsBedrockProvider } from '@/lib/ai/providers/aws-bedrock';
import { createAwsPollyProvider } from '@/lib/ai/providers/aws-polly';
import { createAwsTranscribeProvider } from '@/lib/ai/providers/aws-transcribe';
import type { AwsCredentialEnvironment } from '@/lib/ai/providers/aws-sigv4';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';

export const STATIC_PROVIDER_IDS = ['aws-bedrock', 'aws-polly', 'aws-transcribe'] as const satisfies readonly ProviderId[];

export function isStaticProvider(providerSlug: ProviderId): boolean {
  return STATIC_PROVIDER_IDS.includes(providerSlug as (typeof STATIC_PROVIDER_IDS)[number]);
}

interface StaticBedrockEnvironment extends AwsCredentialEnvironment {
  BEDROCK_REGION?: string;
  BEDROCK_AWS_ACCESS_KEY_ID?: string;
  BEDROCK_AWS_SECRET_ACCESS_KEY?: string;
}

export function resolveStaticBedrockEnvironment(env: StaticBedrockEnvironment): AwsCredentialEnvironment {
  return {
    AWS_REGION: env.BEDROCK_REGION ?? env.AWS_REGION,
    AWS_DEFAULT_REGION: env.AWS_DEFAULT_REGION,
    AWS_ACCESS_KEY_ID: env.BEDROCK_AWS_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: env.BEDROCK_AWS_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY,
  };
}

export function createStaticProviderAdapter(providerSlug: ProviderId): ProviderAdapter | undefined {
  if (!isStaticProvider(providerSlug)) return undefined;
  try {
    switch (providerSlug) {
      case 'aws-bedrock': return createAwsBedrockProvider(undefined, resolveStaticBedrockEnvironment(process.env));
      case 'aws-polly': return createAwsPollyProvider();
      case 'aws-transcribe': return createAwsTranscribeProvider();
    }
  } catch {
    return undefined;
  }
}
