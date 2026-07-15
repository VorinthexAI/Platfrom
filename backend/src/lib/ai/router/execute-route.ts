import { ACTION_REGISTRY } from '@/lib/ai/actions';
import { getDefaultProviderAdapters } from '@/lib/ai/providers';
import { normalizeProviderError, PRE_EXECUTION_ERROR_CODES, type ProviderError } from '@/lib/ai/providers/errors';
import type { ProviderAdapter, ProviderExecuteResponse, ProviderId } from '@/lib/ai/providers/types';
import { ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import { ProviderExecutionError, type RouteAttemptFailure } from './errors';
import { selectRoute } from './select-route';
import type { RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';

interface ExecutableRoute {
  modelId: string;
  providerId: ProviderId;
  externalModelId: string;
}

export interface ExecuteRouteOptions<TInput> {
  decision: RouteDecision;
  input: TInput;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  timeoutMs?: number;
  signal?: AbortSignal;
  onAttempt?: (attempt: RouteAttemptTelemetry) => void;
}

export interface RouteAttemptTelemetry extends ExecutableRoute {
  status: 'completed' | 'failed';
  usage: TokenUsage;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  errorCode?: string;
}

/**
 * Whether a failed attempt may fall back to the next route. Two gates:
 * the error itself must be retryable, AND either the action declares safe
 * retry behavior (text-shaped actions) or the failure provably happened
 * before execution (auth/rate-limit/unavailable) — so a fallback can never
 * produce a second billable image/video/music output.
 */
function canFallBack(actionSafeToRetry: boolean, error: ProviderError): boolean {
  if (error.code === 'aborted') return false;
  if (!error.retryable) return false;
  return actionSafeToRetry || PRE_EXECUTION_ERROR_CODES.has(error.code);
}

/**
 * Executes the decided route, walking the decision's fallback list only
 * when the failure mode allows it. Abort signals and timeouts propagate to
 * every attempt; an abort stops the chain immediately.
 */
export async function executeRouteWithFallbacks<TInput, TOutput>(
  options: ExecuteRouteOptions<TInput>,
): Promise<ProviderExecuteResponse<TOutput>> {
  const { decision, input } = options;
  const adapters = options.adapters ?? getDefaultProviderAdapters();
  const action = ACTION_REGISTRY[decision.actionId];

  const routes: ExecutableRoute[] = [
    { modelId: decision.modelId, providerId: decision.providerId, externalModelId: decision.externalModelId },
    ...decision.fallbacks.map((fallback) => ({
      modelId: fallback.modelId,
      providerId: fallback.providerId,
      externalModelId: fallback.externalModelId,
    })),
  ];

  const attempts: RouteAttemptFailure[] = [];
  let lastError: unknown;

  for (const route of routes) {
    if (options.signal?.aborted) {
      throw normalizeProviderError(route.providerId, new DOMException('The operation was aborted.', 'AbortError'));
    }

    const adapter = adapters[route.providerId];
    if (!adapter) {
      attempts.push({
        modelId: route.modelId,
        providerId: route.providerId,
        externalModelId: route.externalModelId,
        code: 'adapter_unavailable',
        message: `no adapter configured for provider ${route.providerId}`,
      });
      continue;
    }

    try {
      const startedAtMs = Date.now();
      const startedAt = new Date(startedAtMs).toISOString();
      try {
        const response = await adapter.execute<TInput, TOutput>({
          actionId: decision.actionId,
          modelId: route.modelId,
          externalModelId: route.externalModelId,
          input,
          organizationId: decision.organizationId,
          timeoutMs: options.timeoutMs,
          signal: options.signal,
        });
        const endedAtMs = Date.now();
        options.onAttempt?.({
          ...route,
          status: 'completed',
          usage: response.usage,
          startedAt,
          endedAt: new Date(endedAtMs).toISOString(),
          elapsedMs: endedAtMs - startedAtMs,
        });
        return response;
      } catch (err) {
        const endedAtMs = Date.now();
        const providerError = normalizeProviderError(route.providerId, err);
        options.onAttempt?.({
          ...route,
          status: 'failed',
          usage: ZERO_TOKEN_USAGE,
          startedAt,
          endedAt: new Date(endedAtMs).toISOString(),
          elapsedMs: endedAtMs - startedAtMs,
          errorCode: providerError.code,
        });
        throw providerError;
      }
    } catch (err) {
      const providerError = normalizeProviderError(route.providerId, err);
      lastError = providerError;
      attempts.push({
        modelId: route.modelId,
        providerId: route.providerId,
        externalModelId: route.externalModelId,
        code: providerError.code,
        message: providerError.message,
      });
      if (providerError.code === 'aborted') throw providerError;
      if (!canFallBack(action.safeToRetry, providerError)) {
        throw new ProviderExecutionError(decision.actionId, attempts, { cause: providerError });
      }
    }
  }

  throw new ProviderExecutionError(decision.actionId, attempts, { cause: lastError });
}

export interface ExecuteActionOptions extends RouterDependencies {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * The single entry point tools call: resolve the best route for the
 * request, then execute it with organization-safe fallbacks.
 */
export async function executeAction<TInput, TOutput>(
  request: RouteRequestInput,
  input: TInput,
  options: ExecuteActionOptions = {},
): Promise<ProviderExecuteResponse<TOutput>> {
  const decision = await selectRoute(request, options);
  return executeRouteWithFallbacks<TInput, TOutput>({
    decision,
    input,
    adapters: options.adapters,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  });
}
