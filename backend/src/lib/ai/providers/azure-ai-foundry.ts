import { AzureOpenAI } from 'openai';
import { z } from 'zod';
import { CHAT_ACTION_IDS, executeOpenAICompatibleChat, streamOpenAICompatibleChat, unsupportedAction } from './openai-compatible';
import type { ProviderAdapter, ProviderFactory } from './types';

/**
 * Azure AI Foundry (Azure OpenAI) — the external model id on a route is the
 * DEPLOYMENT name configured in the Azure resource, which is
 * tenant-specific. Routes through this provider stay disabled in the model
 * registry until a deployment exists for the target model.
 */
export const azureAIFoundryProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    endpoint: z.string().url(),
    apiVersion: z.string().min(1).default('2024-10-21'),
  })
  .strict();

export type AzureAIFoundryProviderConfig = z.infer<typeof azureAIFoundryProviderConfigSchema>;
export const azureAIFoundryCredentialsSchema = azureAIFoundryProviderConfigSchema;
export type AzureAIFoundryCredentials = AzureAIFoundryProviderConfig;

const PROVIDER_ID = 'azure-ai-foundry' as const;

export function createAzureAIFoundryProvider(config: AzureAIFoundryProviderConfig): ProviderAdapter {
  const parsed = azureAIFoundryProviderConfigSchema.parse(config);
  const client = new AzureOpenAI({
    apiKey: parsed.apiKey,
    endpoint: parsed.endpoint,
    apiVersion: parsed.apiVersion,
  });

  return {
    id: PROVIDER_ID,
    name: 'Azure AI Foundry',

    async execute(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
    },

    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_completion_tokens' });
    },
  };
}

export const azureAIFoundryProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: azureAIFoundryProviderConfigSchema,
  create(config) {
    return createAzureAIFoundryProvider(azureAIFoundryProviderConfigSchema.parse(config));
  },
};
