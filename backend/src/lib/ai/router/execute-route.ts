import { normalizeProviderError } from '@/lib/ai/providers/errors';
import type { ProviderAdapter, ProviderExecuteResponse, ProviderId } from '@/lib/ai/providers/types';
import { ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import { ProviderExecutionError } from './errors';
import { selectRoute } from './select-route';
import type { RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';

export interface ExecuteRouteOptions<TInput> {
  decision: RouteDecision;
  input: TInput;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onAttemptStart?: (attempt: RouteAttemptStartTelemetry) => string | undefined | Promise<string | undefined>;
  onAttempt?: (attempt: RouteAttemptTelemetry) => void | Promise<void>;
}
export interface RouteAttemptStartTelemetry {
  actionKey: string;
  actionSlug: string;
  modelKey: string;
  providerKey: string;
  startedAt: string;
}
export interface RouteAttemptTelemetry {
  callKey?: string;
  actionKey: string;
  actionSlug: string;
  modelKey: string;
  providerKey: string;
  status: 'completed' | 'failed';
  usage: TokenUsage;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  errorCode?: string;
}

/** V1 executes exactly the selected deterministic route; there are no scored fallbacks. */
export async function executeRoute<TInput, TOutput>(options: ExecuteRouteOptions<TInput>): Promise<ProviderExecuteResponse<TOutput>> {
  const { decision } = options;
  const adapter = options.adapters?.[decision.providerSlug];
  if (!adapter) throw new ProviderExecutionError(decision.actionSlug, [{ modelId: decision.modelSlug, providerId: decision.providerSlug, externalModelId: decision.providerModelId, code: 'adapter_unavailable', message: 'provider adapter is unavailable' }]);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const attemptBase = { actionKey: decision.actionKey, actionSlug: decision.actionSlug, modelKey: decision.modelKey, providerKey: decision.providerKey, startedAt };
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
    await options.onAttempt?.({ ...attemptBase, callKey, status: 'completed', usage: response.usage, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
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
  return executeRoute<TInput, TOutput>({ decision, input, adapters: options.adapters, timeoutMs: options.timeoutMs, signal: options.signal });
}
