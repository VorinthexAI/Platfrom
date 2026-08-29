import OpenAI from 'openai';
import { z } from 'zod';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError } from './errors';
import { embeddingInputSchema, resolveRequestSignal, type EmbeddingOutput, type ProviderAdapter, type ProviderEmbedRequest, type ProviderEmbedResponse, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory } from './types';

export const azureAIFoundryProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  endpoint: z.string().url(),
}).strict();
export type AzureAIFoundryProviderConfig = z.input<typeof azureAIFoundryProviderConfigSchema>;
export const azureAIFoundryCredentialsSchema = azureAIFoundryProviderConfigSchema;
export type AzureAIFoundryCredentials = AzureAIFoundryProviderConfig;

const PROVIDER_ID = 'azure-ai-foundry' as const;
function v1BaseUrl(endpoint: string) {
  const url = new URL(endpoint);
  const path = url.pathname.replace(/\/+$/, '');
  if (path && path !== '/openai/v1') throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Azure AI Foundry endpoint must be the Azure OpenAI v1 endpoint');
  url.pathname = '/openai/v1/';
  return url.toString();
}

async function createEmbeddings(client: OpenAI, request: ProviderEmbedRequest): Promise<ProviderEmbedResponse> {
  if (request.dimensions !== undefined && request.dimensions !== EMBEDDING_DIMENSIONS) throw new ProviderError(PROVIDER_ID, 'invalid_input', `Azure embeddings require ${EMBEDDING_DIMENSIONS} dimensions`);
  const inputs = typeof request.input === 'string' ? [request.input] : request.input;
  if (!inputs.length || inputs.some((text) => !text.trim())) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'Azure embedding input must be non-empty');
  try {
    const raw = await client.embeddings.create({ model: request.externalModelId, input: request.input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' }, { signal: resolveRequestSignal(request) });
    const ordered = [...raw.data].sort((left, right) => left.index - right.index);
    if (ordered.length !== inputs.length || ordered.some(({ index }, position) => index !== position)) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'Azure embeddings returned invalid indices');
    const embeddings = ordered.map(({ embedding }) => embedding);
    if (embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value)))) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'Azure embeddings returned invalid vectors');
    return { embeddings, usage: tokenUsage(raw.usage?.prompt_tokens, 0, raw.usage?.total_tokens), providerId: PROVIDER_ID, externalModelId: request.externalModelId, rawResponse: raw };
  } catch (error) { throw normalizeProviderError(PROVIDER_ID, error); }
}

export function createAzureAIFoundryProvider(config: AzureAIFoundryProviderConfig, fetcher: typeof fetch = fetch): ProviderAdapter {
  const parsed = azureAIFoundryProviderConfigSchema.parse(config);
  const client = new OpenAI({ apiKey: parsed.apiKey, baseURL: v1BaseUrl(parsed.endpoint), fetch: fetcher });
  return {
    id: PROVIDER_ID,
    name: 'Azure AI Foundry',
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      if (request.actionId === 'embed') {
        const input = embeddingInputSchema.parse(request.input);
        const result = await createEmbeddings(client, { externalModelId: request.externalModelId, input: input.text, dimensions: EMBEDDING_DIMENSIONS, timeoutMs: request.timeoutMs, signal: request.signal });
        return { output: { embedding: result.embeddings[0]! } as TOutput & EmbeddingOutput, usage: result.usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: result.rawResponse };
      }
      throw new ProviderError(PROVIDER_ID, 'unsupported_action', `azure-ai-foundry does not implement action ${request.actionId}`);
    },
    embed(request) { return createEmbeddings(client, request); },
  };
}

export const azureAIFoundryProviderFactory: ProviderFactory = {
  id: PROVIDER_ID,
  configSchema: azureAIFoundryProviderConfigSchema,
  create(config) { return createAzureAIFoundryProvider(azureAIFoundryProviderConfigSchema.parse(config)); },
};
