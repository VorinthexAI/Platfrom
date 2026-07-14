import OpenAI from 'openai';
import { z } from 'zod';
import { ASK_ACTION_IDS, executeOpenAICompatibleChat, streamOpenAICompatibleChat, unsupportedAction } from './openai-compatible';
import type { ProviderAdapter, ProviderFactory } from './types';

/** xAI exposes Grok through an OpenAI-compatible API at api.x.ai. */
export const xaiProviderConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().default('https://api.x.ai/v1'),
  })
  .strict();

export type XaiProviderConfig = z.infer<typeof xaiProviderConfigSchema>;

const PROVIDER_ID = 'xai' as const;

export function createXaiProvider(config: XaiProviderConfig): ProviderAdapter {
  const parsed = xaiProviderConfigSchema.parse(config);
  const client = new OpenAI({ apiKey: parsed.apiKey, baseURL: parsed.baseUrl });

  return {
    id: PROVIDER_ID,
    name: 'xAI',

    async execute(request) {
      if (!ASK_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },

    stream(request) {
      if (!ASK_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },
  };
}

export const xaiProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: xaiProviderConfigSchema,
  create(config) {
    return createXaiProvider(xaiProviderConfigSchema.parse(config));
  },
  fromEnv(env) {
    // The repo's existing secret name for xAI is GROK_API_KEY; accept the
    // canonical XAI_API_KEY as well.
    const apiKey = env.GROK_API_KEY ?? env.XAI_API_KEY;
    if (!apiKey) return null;
    return createXaiProvider(xaiProviderConfigSchema.parse({ apiKey }));
  },
};
