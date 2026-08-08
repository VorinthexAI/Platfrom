import OpenAI from 'openai';
import { z } from 'zod';
import { EMBEDDING_DIMENSIONS, EMBEDDING_ROUTE, EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embedding-constants';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { normalizeProviderError, ProviderError, providerErrorCodeForStatus } from './errors';
import { CHAT_ACTION_IDS, executeOpenAICompatibleChat, streamOpenAICompatibleChat, unsupportedAction } from './openai-compatible';
import { embeddingInputSchema, type EmbeddingOutput, type ProviderAdapter, type ProviderEmbedRequest, type ProviderEmbedResponse, type ProviderExecuteRequest, type ProviderExecuteResponse, type ProviderFactory } from './types';

/** OpenRouter is an OpenAI-compatible gateway; model ids are `vendor/model` slugs. */
export const openRouterProviderConfigSchema = z
  .object({
    apiKey: z.string({ required_error: 'OPENROUTER_API_KEY is required' }).trim().min(1, 'OPENROUTER_API_KEY is required'),
    baseUrl: z.string().url().default('https://openrouter.ai/api/v1'),
    /** Optional attribution headers OpenRouter uses for rankings. */
    siteUrl: z.string().url().optional(),
    appName: z.string().optional(),
  })
  .strict();

export type OpenRouterProviderConfig = z.infer<typeof openRouterProviderConfigSchema>;
export type OpenRouterProviderConfigInput = z.input<typeof openRouterProviderConfigSchema>;
export const openRouterCredentialsSchema = openRouterProviderConfigSchema;
export type OpenRouterCredentials = OpenRouterProviderConfig;

const PROVIDER_ID = 'openrouter' as const;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 5_000;
const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: z.array(z.number().finite()) }).passthrough()),
  provider: z.string().trim().min(1),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().optional(), total_tokens: z.number().int().nonnegative().optional() }).passthrough().optional(),
}).passthrough();

interface OpenRouterEnvironment {
  [key: string]: string | undefined;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_BASE_URL?: string;
  OPENROUTER_SITE_URL?: string;
  OPENROUTER_APP_NAME?: string;
}

export function resolveOpenRouterEnvironment(env: OpenRouterEnvironment): OpenRouterProviderConfig {
  return openRouterProviderConfigSchema.parse({
    apiKey: env.OPENROUTER_API_KEY ?? '',
    ...(env.OPENROUTER_BASE_URL ? { baseUrl: env.OPENROUTER_BASE_URL } : {}),
    ...(env.OPENROUTER_SITE_URL ? { siteUrl: env.OPENROUTER_SITE_URL } : {}),
    ...(env.OPENROUTER_APP_NAME ? { appName: env.OPENROUTER_APP_NAME } : {}),
  });
}

function abortError(signal?: AbortSignal): unknown {
  return signal?.reason ?? new DOMException('Request aborted', 'AbortError');
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => { clearTimeout(timer); reject(abortError(signal)); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal) setTimeout(() => signal.removeEventListener('abort', abort), ms);
  });
}

function retryDelay(response: Response): number | undefined {
  const milliseconds = response.headers.get('retry-after-ms');
  if (milliseconds !== null && Number.isFinite(Number(milliseconds))) return Math.min(Math.max(Number(milliseconds), 0), MAX_RETRY_DELAY_MS);
  const value = response.headers.get('retry-after');
  if (value === null) return undefined;
  const seconds = Number(value);
  const delayMs = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(value) - Date.now();
  return Number.isFinite(delayMs) ? Math.min(Math.max(delayMs, 0), MAX_RETRY_DELAY_MS) : undefined;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.code === 'timeout' || error.cause instanceof TypeError || error.status === 408 || error.status === 429 || (error.status !== undefined && error.status >= 500);
  return error instanceof TypeError;
}

async function createEmbeddings(config: OpenRouterProviderConfig, request: ProviderEmbedRequest): Promise<ProviderEmbedResponse> {
  if (request.externalModelId !== EXTERNAL_EMBEDDING_MODEL_ID) throw new ProviderError(PROVIDER_ID, 'unsupported_action', `OpenRouter embeddings require ${EXTERNAL_EMBEDDING_MODEL_ID}`);
  if (request.dimensions !== undefined && request.dimensions !== EMBEDDING_DIMENSIONS) throw new ProviderError(PROVIDER_ID, 'invalid_input', `OpenRouter embeddings require ${EMBEDDING_DIMENSIONS} dimensions`);
  const inputs = typeof request.input === 'string' ? [request.input] : request.input;
  if (inputs.length === 0 || inputs.some((text) => !text.trim())) throw new ProviderError(PROVIDER_ID, 'invalid_input', 'OpenRouter embedding input must be non-empty');
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' };
  if (config.siteUrl) headers['HTTP-Referer'] = config.siteUrl;
  if (config.appName) headers['X-Title'] = config.appName;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let requestedDelay: number | undefined;
    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST', headers, signal,
        body: JSON.stringify({ model: request.externalModelId, input: request.input, dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float', provider: { order: [EMBEDDING_ROUTE], allow_fallbacks: false, data_collection: 'deny', zdr: true } }),
      });
      if (!response.ok) {
        requestedDelay = retryDelay(response);
        throw new ProviderError(PROVIDER_ID, providerErrorCodeForStatus(response.status), `openrouter request failed with status ${response.status}`, { status: response.status });
      }
      const raw = responseSchema.parse(await response.json());
      if (raw.provider.toLowerCase().replace(/[^a-z0-9]/g, '') !== EMBEDDING_ROUTE) throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openrouter embeddings were not served by DeepInfra');
      const ordered = [...raw.data].sort((left, right) => left.index - right.index);
      const indices = ordered.map(({ index }) => index);
      if (ordered.length !== inputs.length || new Set(indices).size !== indices.length || indices.some((index, position) => index !== position)) {
        throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openrouter embeddings returned invalid or non-contiguous indices');
      }
      const embeddings = ordered.map(({ embedding }) => embedding);
      if (embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS || embedding.some((value) => !Number.isFinite(value)))) {
        throw new ProviderError(PROVIDER_ID, 'response_invalid', 'openrouter embeddings returned invalid vector dimensions or values');
      }
      return { embeddings, usage: tokenUsage(raw.usage?.prompt_tokens, 0, raw.usage?.total_tokens), providerId: PROVIDER_ID, externalModelId: request.externalModelId, rawResponse: raw };
    } catch (error) {
      const normalized = normalizeProviderError(PROVIDER_ID, error);
      if (request.signal?.aborted || !isRetryable(normalized) || attempt === MAX_ATTEMPTS) throw normalized;
      lastError = normalized;
      try {
        await delay(requestedDelay ?? Math.min(250 * 2 ** (attempt - 1), 1_000), request.signal);
      } catch (backoffError) {
        throw normalizeProviderError(PROVIDER_ID, backoffError);
      }
    }
  }
  throw normalizeProviderError(PROVIDER_ID, lastError);
}

export function createOpenRouterProvider(config: OpenRouterProviderConfigInput): ProviderAdapter {
  const parsed = openRouterProviderConfigSchema.parse(config);
  const headers: Record<string, string> = {};
  if (parsed.siteUrl) headers['HTTP-Referer'] = parsed.siteUrl;
  if (parsed.appName) headers['X-Title'] = parsed.appName;
  const client = new OpenAI({ apiKey: parsed.apiKey, baseURL: parsed.baseUrl, defaultHeaders: headers });

  return {
    id: PROVIDER_ID,
    name: 'OpenRouter',

    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
      if (request.actionId === 'embed') {
        const input = embeddingInputSchema.parse(request.input);
        const result = await createEmbeddings(parsed, { externalModelId: request.externalModelId, input: input.text, dimensions: EMBEDDING_DIMENSIONS, timeoutMs: request.timeoutMs, signal: request.signal });
        return { output: { embedding: result.embeddings[0]! } as TOutput & EmbeddingOutput, usage: result.usage, providerId: PROVIDER_ID, modelId: request.modelId, externalModelId: request.externalModelId, rawResponse: result.rawResponse };
      }
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return executeOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },

    stream(request) {
      if (!CHAT_ACTION_IDS.has(request.actionId)) throw unsupportedAction(PROVIDER_ID, request.actionId);
      return streamOpenAICompatibleChat(PROVIDER_ID, client, request, { maxTokensParam: 'max_tokens' });
    },

    embed(request) {
      return createEmbeddings(parsed, request);
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
