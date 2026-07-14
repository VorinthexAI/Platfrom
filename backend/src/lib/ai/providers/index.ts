import { anthropicProviderFactory } from './anthropic';
import { awsBedrockProviderFactory } from './aws-bedrock';
import { azureAIFoundryProviderFactory } from './azure-ai-foundry';
import { googleVertexProviderFactory } from './google-vertex';
import { openAIProviderFactory } from './openai';
import { openRouterProviderFactory } from './openrouter';
import { xaiProviderFactory } from './xai';
import type { ProviderAdapter, ProviderFactory, ProviderId } from './types';

export {
  PROVIDER_SLUGS,
  providerSlugSchema,
  providerIdSchema,
  providerExecuteRequestSchema,
  chatInputSchema,
  chatMessageSchema,
  chatToolSchema,
  imageGenerateInputSchema,
  transcribeInputSchema,
  speechInputSchema,
  resolveRequestSignal,
  type ProviderId,
  type ProviderSlug,
  type ProviderAdapter,
  type ProviderFactory,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderStreamChunk,
  type ProviderHealth,
  type ChatInput,
  type ChatMessage,
  type ChatTool,
  type ChatOutput,
  type NormalizedToolCall,
  type ImageGenerateInput,
  type ImageOutput,
  type TranscribeInput,
  type TranscriptionOutput,
  type SpeechInput,
  type SpeechOutput,
} from './types';
export {
  ProviderError,
  isProviderError,
  normalizeProviderError,
  providerErrorCodeForStatus,
  PROVIDER_ERROR_CODES,
  PRE_EXECUTION_ERROR_CODES,
  type ProviderErrorCode,
} from './errors';
export { createOpenAIProvider, openAIProviderConfigSchema, openAIProviderFactory, type OpenAIProviderConfig } from './openai';
export { createAnthropicProvider, anthropicProviderConfigSchema, anthropicProviderFactory, type AnthropicProviderConfig } from './anthropic';
export { createXaiProvider, xaiProviderConfigSchema, xaiProviderFactory, type XaiProviderConfig } from './xai';
export {
  createGoogleVertexProvider,
  googleVertexProviderConfigSchema,
  googleVertexProviderFactory,
  type GoogleVertexProviderConfig,
} from './google-vertex';
export {
  createAzureAIFoundryProvider,
  azureAIFoundryProviderConfigSchema,
  azureAIFoundryProviderFactory,
  type AzureAIFoundryProviderConfig,
} from './azure-ai-foundry';
export { createAwsBedrockProvider, awsBedrockProviderConfigSchema, awsBedrockProviderFactory, type AwsBedrockProviderConfig } from './aws-bedrock';
export { createOpenRouterProvider, openRouterProviderConfigSchema, openRouterProviderFactory, type OpenRouterProviderConfig } from './openrouter';

/**
 * Adapter factories for every provider. Factories (not initialized
 * adapters) because secrets load at runtime — no external SDK client is
 * constructed at module import time.
 */
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderFactory> = {
  openai: openAIProviderFactory,
  anthropic: anthropicProviderFactory,
  xai: xaiProviderFactory,
  'google-vertex': googleVertexProviderFactory,
  'azure-ai-foundry': azureAIFoundryProviderFactory,
  'aws-bedrock': awsBedrockProviderFactory,
  openrouter: openRouterProviderFactory,
};

/**
 * Builds adapters for every provider whose configuration is present in the
 * given environment. Providers with missing configuration are simply
 * absent — the router treats them as unavailable routes.
 */
export function createProviderAdaptersFromEnv(
  env: Record<string, string | undefined> = process.env,
): Partial<Record<ProviderId, ProviderAdapter>> {
  const adapters: Partial<Record<ProviderId, ProviderAdapter>> = {};
  for (const factory of Object.values(PROVIDER_REGISTRY)) {
    const adapter = factory.fromEnv(env);
    if (adapter) adapters[factory.id] = adapter;
  }
  return adapters;
}

let cachedDefaultAdapters: Partial<Record<ProviderId, ProviderAdapter>> | null = null;

/** Process-wide adapters built once from `process.env` — the router's default. */
export function getDefaultProviderAdapters(): Partial<Record<ProviderId, ProviderAdapter>> {
  cachedDefaultAdapters ??= createProviderAdaptersFromEnv();
  return cachedDefaultAdapters;
}

/** Test hook: clears the process-wide adapter cache. */
export function resetDefaultProviderAdapters(): void {
  cachedDefaultAdapters = null;
}
