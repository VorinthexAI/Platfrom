import OpenAI from 'openai';
import { z } from 'zod';
import { CHAT_ACTION_IDS, executeOpenAICompatibleChat, streamOpenAICompatibleChat, unsupportedAction } from './openai-compatible';
import type { ProviderAdapter, ProviderFactory } from './types';

/** OpenRouter is an OpenAI-compatible gateway; model ids are `vendor/model` slugs. */
export const openRouterProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
    /** Optional attribution headers OpenRouter uses for rankings. */
    siteUrl: z.string().url().optional(),
    appName: z.string().optional(),
  })
  .strict();

export type OpenRouterProviderConfig = z.infer<typeof openRouterProviderConfigSchema>;
export const openRouterCredentialsSchema = openRouterProviderConfigSchema;
export type OpenRouterCredentials = OpenRouterProviderConfig;

const PROVIDER_ID = 'openrouter' as const;

export function createOpenRouterProvider(config: OpenRouterProviderConfig): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  const headers: Record<string, string> = {};
  if (parsed.siteUrl) headers['HTTP-Referer'] = parsed.siteUrl;
  if (parsed.appName) headers['X-Title'] = parsed.appName;
  const client = new OpenAI({ apiKey: parsed.apiKey, baseURL: parsed.baseUrl, defaultHeaders: headers });

  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',

    async execute(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },

    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },
  };
}

export const openRouterProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: openRouterProviderConfigSchema,
  create(config) {
    return createOpenRouterProvider(openRouterProviderConfigSchema.parse(config));
  },
};
