import { normalizeProviderError } from '@/lib/ai/providers/errors';
import type { ActionId } from '@/lib/ai/actions';
import { webSearchInputSchema, type WebSearchInput } from '@/lib/ai/actions/web-search';
import type { ProviderAdapter, ProviderExecuteResponse, ProviderId } from '@/lib/ai/providers/types';
import { createRegisteredProviderAdapter } from '@/lib/ai/providers';
import { ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import { ProviderExecutionError } from './errors';
import { selectRoute } from './select-route';
import type { RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';
import { coreChatInputSchema, type CoreChatInput } from '@/lib/ai/actions/core-chat';

export interface ExecuteRouteOptions<TInput> {
  decision: RouteDecision;
  input: TInput;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  env?: ExecuteActionOptions['env'];
  timeoutMs?: number;
  signal?: AbortSignal;
  onAttemptStart?: (attempt: RouteAttemptStartTelemetry) => string | undefined | Promise<string | undefined>;
  onAttempt?: (attempt: RouteAttemptTelemetry) => void | Promise<void>;
}

async function resolveAdapter(decision: RouteDecision, adapters: ExecuteRouteOptions<unknown>['adapters'], env: ExecuteRouteOptions<unknown>['env']): Promise<ProviderAdapter | undefined> {
  const injected = adapters?.[decision.providerSlug];
  if (injected) return injected;
  return createRegisteredProviderAdapter(decision.providerSlug, env ?? process.env);
}
export interface RouteAttemptStartTelemetry {
  actionSlug: ActionId;
  modelSlug: string;
  providerSlug: ProviderId;
  startedAt: string;
}
export interface RouteAttemptTelemetry {
  callKey?: string;
  actionSlug: ActionId;
  modelSlug: string;
  providerSlug: ProviderId;
  status: 'completed' | 'failed';
  usage: TokenUsage;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  errorCode?: string;
  costUsd?: number;
}

/** V1 executes exactly the selected deterministic route; there are no scored fallbacks. */
export async function executeRoute<TInput, TOutput>(options: ExecuteRouteOptions<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const { decision } = options;
  const adapter = await resolveAdapter(decision, options.adapters, options.env);
  if (!adapter) throw new ProviderExecutionError(decision.actionSlug, [{ modelId: decision.modelSlug, providerId: decision.providerSlug, externalModelId: decision.providerModelId, code: 'adapter_unavailable', message: 'provider adapter is unavailable' }]);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const attemptBase = { actionSlug: decision.actionSlug, modelSlug: decision.modelSlug, providerSlug: decision.providerSlug, startedAt };
  const callKey = await options.onAttemptStart?.(attemptBase);
  try {
    const response = await adapter.execute<TInput, TOutput>({
      actionId: decision.actionSlug,
      modelId: decision.modelSlug,
      externalModelId: decision.providerModelId,
      input: options.input,
      organizationKey: decision.organizationKey,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const endedAtMs = Date.now();
    await options.onAttempt?.({ ...attemptBase, callKey, status: 'completed', usage: response.usage, ...(response.costUsd !== undefined ? { costUsd: response.costUsd } : {}), endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
    return response;
  } catch (error) {
    const endedAtMs = Date.now();
    const normalized = normalizeProviderError(decision.providerSlug, error);
    await options.onAttempt?.({ ...attemptBase, callKey, status: 'failed', usage: ZERO_TOKEN_USAGE, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs, errorCode: normalized.code });
    throw new ProviderExecutionError(decision.actionSlug, [{ modelId: decision.modelSlug, providerId: decision.providerSlug, externalModelId: decision.providerModelId, code: normalized.code, message: normalized.message }], { cause: normalized });
  }
}

export interface ExecuteActionOptions extends RouterDependencies { timeoutMs?: number; signal?: AbortSignal }
export async function executeAction<TInput, TOutput>(request: RouteRequestInput, input: TInput, options: ExecuteActionOptions = {}) {
  const decision = await selectRoute(request, options);
  return executeRoute<TInput, TOutput>({ decision, input, adapters: options.adapters, env: options.env, timeoutMs: options.timeoutMs, signal: options.signal });
}

/** Executes the canonical text action using the model selected by its provider-neutral mode. */
export async function executeAsk<TOutput>(organizationKey: string, input: CoreChatInput, options: ExecuteActionOptions = {}) {
  const { mode, ...providerInput } = coreChatInputSchema.parse(input);
  const request: RouteRequestInput = {
    mode: 'model',
    organizationKey,
    actionSlug: 'ask',
    modelSlug: mode === 'deep' ? 'openai.gpt-5.6-luna' : 'google.gemini-2.5-flash-lite',
  };
  return executeAction<typeof providerInput, TOutput>(request, providerInput, options);
}

/** Executes grounded web search using the model selected by its provider-neutral mode. */
export async function executeWebSearch<TOutput>(organizationKey: string, input: WebSearchInput, options: ExecuteActionOptions = {}) {
  const { mode, ...providerInput } = webSearchInputSchema.parse(input);
  return executeAction<typeof providerInput, TOutput>({
    mode: 'model', organizationKey, actionSlug: 'web-search',
    modelSlug: mode === 'deep' ? 'openai.gpt-5.6-luna' : 'google.gemini-2.5-flash-lite',
  }, providerInput, options);
}

/** Streams normalized provider chunks over the selected route. */
export async function* streamRoute<TInput>(options: ExecuteRouteOptions<TInput>): AsyncIterable<import('@/lib/ai/providers').ProviderStreamChunk> {
  const adapter = await resolveAdapter(options.decision, options.adapters, options.env);
  if (!adapter?.stream) throw new ProviderExecutionError(options.decision.actionSlug, [{ modelId: options.decision.modelSlug, providerId: options.decision.providerSlug, externalModelId: options.decision.providerModelId, code: 'adapter_unavailable', message: 'provider streaming adapter is unavailable' }]);
  try {
    yield* adapter.stream({ actionId: options.decision.actionSlug, modelId: options.decision.modelSlug, externalModelId: options.decision.providerModelId, input: options.input, organizationKey: options.decision.organizationKey, timeoutMs: options.timeoutMs, signal: options.signal });
  } catch (error) {
    const normalized = normalizeProviderError(options.decision.providerSlug, error);
    throw new ProviderExecutionError(options.decision.actionSlug, [{ modelId: options.decision.modelSlug, providerId: options.decision.providerSlug, externalModelId: options.decision.providerModelId, code: normalized.code, message: normalized.message }], { cause: normalized });
  }
}
