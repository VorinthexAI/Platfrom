import { normalizeProviderError } from '@/lib/ai/providers/errors';
import { executeQueueAction, type ActionId, type ActionRouteId } from '@/lib/ai/actions';
import { webInputSchema, type WebInput } from '@/lib/ai/actions/web';
import { imageActionInputSchema, imageOutputSchema, type ImageOutput, type ProviderAdapter, type ProviderExecuteResponse, type ProviderId } from '@/lib/ai/providers/types';
import { createRegisteredProviderAdapter } from '@/lib/ai/providers';
import { tokenUsage, ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import { ProviderExecutionError } from './errors';
import { selectRoutes } from './select-route';
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

export interface ExecuteActionOptions extends RouterDependencies {
  timeoutMs?: number;
  signal?: AbortSignal;
  providers?: readonly ActionRouteId[];
  retry?: { intervalMs?: number; attempts?: number };
}
export async function executeAction<TInput, TOutput>(request: RouteRequestInput, input: TInput, options: ExecuteActionOptions = {}) {
  const decisions = await selectRoutes(request, options, options.providers);
  const executeSelected = async <TSelectedInput, TSelectedOutput>(selectedInput: TSelectedInput) => executeQueueAction({
    action: decisions[0]!.actionSlug,
    signal: options.signal,
    baseDelayMs: options.retry?.intervalMs,
    maxAttempts: options.retry?.attempts,
    shouldRetry: (error) => error instanceof ProviderExecutionError && error.attempts.length > 0 && error.attempts.every(({ code }) => code === 'rate_limited'),
    run: async () => {
    const failures: ProviderExecutionError['attempts'][number][] = [];
    for (const decision of decisions) {
      try {
        return await executeRoute<TSelectedInput, TSelectedOutput>({ decision, input: selectedInput, adapters: options.adapters, env: options.env, timeoutMs: options.timeoutMs, signal: options.signal });
      } catch (error) {
        if (!(error instanceof ProviderExecutionError)) throw error;
        failures.push(...error.attempts);
        if (error.attempts.at(-1)?.code !== 'rate_limited') throw new ProviderExecutionError(decision.actionSlug, failures, { cause: error });
      }
    }
    throw new ProviderExecutionError(decisions[0]!.actionSlug, failures);
    },
  });
  if (decisions[0]!.actionSlug === 'image') {
    const parsed = imageActionInputSchema.parse(input);
    if (parsed.operation !== 'generate') return executeSelected<TInput, TOutput>(input);
    const responses = await Promise.all(Array.from({ length: parsed.count }, async () => {
      return executeSelected<typeof parsed, ImageOutput>({ ...parsed, count: 1 });
    }));
    if (responses.length === 1) return responses[0] as ProviderExecuteResponse<TOutput>;
    const usage = tokenUsage(
      responses.reduce((sum, response) => sum + response.usage.inputTokens, 0),
      responses.reduce((sum, response) => sum + response.usage.outputTokens, 0),
      responses.reduce((sum, response) => sum + response.usage.totalTokens, 0),
    );
    const costs = responses.flatMap(({ costUsd }) => costUsd === undefined ? [] : [costUsd]);
    return {
      output: imageOutputSchema.parse({ images: responses.flatMap(({ output }) => output.images) }) as TOutput,
      usage,
      ...(costs.length ? { costUsd: costs.reduce((sum, cost) => sum + cost, 0) } : {}),
      providerId: responses[0]!.providerId,
      modelId: responses[0]!.modelId,
      externalModelId: responses[0]!.externalModelId,
      rawResponse: responses.map(({ rawResponse }) => rawResponse),
    };
  }
  return executeSelected<TInput, TOutput>(input);
}

/** Executes the canonical text action using the model selected by its provider-neutral mode. */
export async function executeAsk<TOutput>(organizationKey: string, input: CoreChatInput, options: ExecuteActionOptions = {}) {
  const { mode, ...providerInput } = coreChatInputSchema.parse(input);
  const request: RouteRequestInput = {
    mode: 'auto',
    organizationKey,
    actionSlug: 'text',
  };
  return executeAction<typeof providerInput, TOutput>(request, providerInput, options);
}

/** Executes grounded web search using the model selected by its provider-neutral mode. */
export async function executeWebSearch<TOutput>(organizationKey: string, input: WebInput, options: ExecuteActionOptions = {}) {
  const { mode, ...providerInput } = webInputSchema.parse(input);
  return executeAction<typeof providerInput, TOutput>({
    mode: 'model', organizationKey, actionSlug: 'web',
    modelSlug: 'google.gemini-3.1-flash-lite-preview',
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

/** Streams the canonical provider-neutral text action over its selected server-owned route. */
export async function* streamAsk(organizationKey: string, input: CoreChatInput, options: ExecuteActionOptions = {}) {
  const { mode: _mode, ...providerInput } = coreChatInputSchema.parse(input);
  const decision = (await selectRoutes({ mode: 'auto', organizationKey, actionSlug: 'text' }, options, options.providers))[0]!;
  yield* streamRoute({ decision, input: providerInput, adapters: options.adapters, env: options.env, timeoutMs: options.timeoutMs, signal: options.signal });
}
