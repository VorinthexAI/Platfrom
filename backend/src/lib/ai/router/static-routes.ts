import { createAwsBedrockProvider } from '@/lib/ai/providers/aws-bedrock';
import { createAwsBedrockMantleProvider } from '@/lib/ai/providers/aws-bedrock-mantle';
import { createOpenAIProvider, type OpenAIProviderConfig } from '@/lib/ai/providers/openai';
import { createOpenRouterProvider, type OpenRouterProviderConfig } from '@/lib/ai/providers/openrouter';
import type { AwsCredentialEnvironment } from '@/lib/ai/providers/aws-sigv4';
import type { ProviderAdapter, ProviderId } from '@/lib/ai/providers/types';

export const STATIC_PROVIDER_IDS = ['openai', 'openrouter', 'aws-bedrock', 'aws-bedrock-mantle'] as const satisfies readonly ProviderId[];

export function isStaticProvider(providerSlug: ProviderId): boolean {
  return STATIC_PROVIDER_IDS.includes(providerSlug as (typeof STATIC_PROVIDER_IDS)[number]);
}

interface StaticBedrockEnvironment extends AwsCredentialEnvironment {
  BEDROCK_REGION?: string;
  BEDROCK_AWS_ACCESS_KEY_ID?: string;
  BEDROCK_AWS_SECRET_ACCESS_KEY?: string;
}

interface StaticOpenAIEnvironment {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_ORGANIZATION?: string;
  OPENAI_PROJECT?: string;
}

interface StaticOpenRouterEnvironment {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
}

export function resolveStaticOpenAIConfig(env: StaticOpenAIEnvironment): OpenAIProviderConfig {
  return {
    apiKey: env.OPENAI_API_KEY ?? '',
    ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}),
    ...(env.OPENAI_ORGANIZATION ? { organization: env.OPENAI_ORGANIZATION } : {}),
    ...(env.OPENAI_PROJECT ? { project: env.OPENAI_PROJECT } : {}),
  };
}

export function resolveStaticOpenRouterConfig(env: StaticOpenRouterEnvironment): OpenRouterProviderConfig {
  return {
    apiKey: env.OPENROUTER_API_KEY ?? '',
    ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
  };
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
      case 'openai': return createOpenAIProvider(resolveStaticOpenAIConfig({
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
        OPENAI_ORGANIZATION: process.env.OPENAI_ORGANIZATION,
        OPENAI_PROJECT: process.env.OPENAI_PROJECT,
      }));
      case 'openrouter': return createOpenRouterProvider(resolveStaticOpenRouterConfig({ OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY, OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL }));
      case 'aws-bedrock': return createAwsBedrockProvider(undefined, resolveStaticBedrockEnvironment(process.env));
      case 'aws-bedrock-mantle': return createAwsBedrockMantleProvider(undefined, resolveStaticBedrockEnvironment(process.env));
    }
  } catch {
    return undefined;
  }
}
