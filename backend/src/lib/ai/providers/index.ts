import { anthropicProviderFactory } from './anthropic';
import { awsBedrockProviderFactory } from './aws-bedrock';
import { awsBedrockMantleProviderFactory } from './aws-bedrock-mantle';
import { azureAIFoundryProviderFactory } from './azure-ai-foundry';
import { googleVertexProviderFactory } from './google-vertex';
import { openAIProviderFactory } from './openai';
import { openRouterProviderFactory } from './openrouter';
import { xaiProviderFactory } from './xai';
import type { AnthropicCredentials } from './anthropic';
import type { AwsBedrockCredentials } from './aws-bedrock';
import type { AwsBedrockMantleCredentials } from './aws-bedrock-mantle';
import type { AzureAIFoundryCredentials } from './azure-ai-foundry';
import type { GoogleVertexCredentials } from './google-vertex';
import type { OpenAICredentials } from './openai';
import type { OpenRouterCredentials } from './openrouter';
import type { XaiCredentials } from './xai';
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
  imageOutputSchema,
  generatedImageMimeTypeSchema,
  imageCaptionInputSchema,
  imageCaptionOutputSchema,
  visualIdentityDescriptionInputSchema,
  visualIdentityDescriptionOutputSchema,
  embeddingInputSchema,
  resolveRequestSignal,
  type ProviderId,
  type ProviderSlug,
  type ProviderAdapter,
  type ProviderFactory,
  type ProviderExecuteRequest,
  type ProviderExecuteResponse,
  type ProviderStreamChunk,
  type ProviderEmbedRequest,
  type ProviderEmbedResponse,
  type ProviderHealth,
  type ChatInput,
  type ChatMessage,
  type ChatTool,
  type ChatOutput,
  type NormalizedToolCall,
  type ImageGenerateInput,
  type ImageOutput,
  type ImageCaptionInput,
  type ImageCaptionOutput,
  type VisualIdentityDescriptionInput,
  type VisualIdentityDescriptionOutput,
  type EmbeddingInput,
  type EmbeddingOutput,
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
export { createOpenAIProvider, openAICredentialsSchema, openAIProviderConfigSchema, openAIProviderFactory, type OpenAICredentials, type OpenAIProviderConfig } from './openai';
export { createOpenRouterProvider, openRouterProviderConfigSchema, openRouterProviderFactory, type OpenRouterCredentials, type OpenRouterProviderConfig } from './openrouter';
export { createAnthropicProvider, anthropicCredentialsSchema, anthropicProviderConfigSchema, anthropicProviderFactory, type AnthropicCredentials, type AnthropicProviderConfig } from './anthropic';
export { createXaiProvider, xaiCredentialsSchema, xaiProviderConfigSchema, xaiProviderFactory, type XaiCredentials, type XaiProviderConfig } from './xai';
export {
  createGoogleVertexProvider,
  googleVertexCredentialsSchema,
  googleVertexProviderConfigSchema,
  googleVertexProviderFactory,
  type GoogleVertexCredentials,
  type GoogleVertexProviderConfig,
} from './google-vertex';
export {
  createAzureAIFoundryProvider,
  azureAIFoundryCredentialsSchema,
  azureAIFoundryProviderConfigSchema,
  azureAIFoundryProviderFactory,
  type AzureAIFoundryCredentials,
  type AzureAIFoundryProviderConfig,
} from './azure-ai-foundry';
export { createAwsBedrockProvider, awsBedrockCredentialsSchema, awsBedrockProviderConfigSchema, awsBedrockProviderFactory, type AwsBedrockCredentials, type AwsBedrockProviderConfig } from './aws-bedrock';
export { createAwsBedrockMantleProvider, awsBedrockMantleCredentialsSchema, awsBedrockMantleProviderConfigSchema, awsBedrockMantleProviderFactory, type AwsBedrockMantleCredentials, type AwsBedrockMantleProviderConfig } from './aws-bedrock-mantle';
export {
  providerSchema,
  getProviderById,
  getProviderBySlug,
  insertProvider,
  updateProvider,
  deleteProvider,
  type Provider,
} from '@/lib/db/providers.node';

/**
 * Adapter factories for every provider. Factories (not initialized
 * adapters) because secrets load at runtime — no external SDK client is
 * constructed at module import time.
 */
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderFactory> = {
  openai: openAIProviderFactory,
  openrouter: openRouterProviderFactory,
  anthropic: anthropicProviderFactory,
  xai: xaiProviderFactory,
  'google-vertex': googleVertexProviderFactory,
  'azure-ai-foundry': azureAIFoundryProviderFactory,
  'aws-bedrock': awsBedrockProviderFactory,
  'aws-bedrock-mantle': awsBedrockMantleProviderFactory,
};

export type ProviderCredentials = {
  openai: OpenAICredentials;
  openrouter: OpenRouterCredentials;
  anthropic: AnthropicCredentials;
  xai: XaiCredentials;
  'google-vertex': GoogleVertexCredentials;
  'azure-ai-foundry': AzureAIFoundryCredentials;
  'aws-bedrock': AwsBedrockCredentials;
  'aws-bedrock-mantle': AwsBedrockMantleCredentials;
};

/** A future provider call always receives model, prompt, and credentials explicitly. */
export type ProviderCallOptions = {
  [Id in ProviderId]: {
    provider: Id;
    model: string;
    prompt: string;
    credentials: ProviderCredentials[Id];
  };
}[ProviderId];

/** Creates one adapter from credentials supplied by the caller, never process.env. */
export function createProviderAdapter(options: ProviderCallOptions): ProviderAdapter {
  return PROVIDER_REGISTRY[options.provider].create(options.credentials);
}
