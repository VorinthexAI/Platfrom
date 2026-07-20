import { normalizeProviderError } from '@/lib/ai/providers/errors';
import type { ProviderAdapter, ProviderExecuteResponse, ProviderId } from '@/lib/ai/providers/types';
import { PROVIDER_REGISTRY } from '@/lib/ai/providers';
import { getDefaultOrganizationCredentialsRepository } from '@/lib/ai/organization-credentials';
import { ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import { ProviderExecutionError } from './errors';
import { selectRoute } from './select-route';
import type { RouteRequestInput } from './route-request';
import type { RouteDecision, RouterDependencies } from './types';
import type { CoreChatInput } from '@/lib/ai/actions/core-chat';

export interface ExecuteRouteOptions<TInput> {
  decision: RouteDecision;
  input: TInput;
  adapters?: Partial<Record<ProviderId, ProviderAdapter>>;
  credentials?: ExecuteActionOptions['credentials'];
  timeoutMs?: number;
  signal?: AbortSignal;
  onAttemptStart?: (attempt: RouteAttemptStartTelemetry) => string | undefined | Promise<string | undefined>;
  onAttempt?: (attempt: RouteAttemptTelemetry) => void | Promise<void>;
}

async function resolveAdapter(decision: RouteDecision, adapters: ExecuteRouteOptions<unknown>['adapters'], credentials: ExecuteRouteOptions<unknown>['credentials']): Promise<ProviderAdapter | undefined> {
  const injected = adapters?.[decision.providerSlug];
  if (injected) return injected;
  const encryptedRepository = credentials ?? getDefaultOrganizationCredentialsRepository();
  const organizationCredentials = await encryptedRepository.getCredentials(decision.organizationKey, decision.orgProviderKey);
  if (!organizationCredentials) return undefined;
  return PROVIDER_REGISTRY[decision.providerSlug].create(organizationCredentials);
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
  const adapter = await resolveAdapter(decision, options.adapters, options.credentials);
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
  return executeRoute<TInput, TOutput>({ decision, input, adapters: options.adapters, credentials: options.credentials, timeoutMs: options.timeoutMs, signal: options.signal });
}

/** Executes standalone chat through the caller-selected organization provider. */
export async function executeCoreChat<TOutput>(organizationKey: string, input: CoreChatInput, options: ExecuteActionOptions = {}) {
  return executeAction<CoreChatInput, TOutput>({
    mode: 'auto',
    organizationKey,
    actionSlug: 'chat',
    organizationProviderKey: input.organizationProviderKey,
  }, input, options);
}

/** Streams normalized provider chunks over the selected organization provider route. */
export async function* streamRoute<TInput>(options: ExecuteRouteOptions<TInput>): AsyncIterable<import('@/lib/ai/providers').ProviderStreamChunk> {
  const adapter = await resolveAdapter(options.decision, options.adapters, options.credentials);
  if (!adapter?.stream) throw new ProviderExecutionError(options.decision.actionSlug, [{ modelId: options.decision.modelSlug, providerId: options.decision.providerSlug, externalModelId: options.decision.providerModelId, code: 'adapter_unavailable', message: 'provider streaming adapter is unavailable' }]);
  try {
    yield* adapter.stream({ actionId: options.decision.actionSlug, modelId: options.decision.modelSlug, externalModelId: options.decision.providerModelId, input: options.input, organizationKey: options.decision.organizationKey, timeoutMs: options.timeoutMs, signal: options.signal });
  } catch (error) {
    const normalized = normalizeProviderError(options.decision.providerSlug, error);
    throw new ProviderExecutionError(options.decision.actionSlug, [{ modelId: options.decision.modelSlug, providerId: options.decision.providerSlug, externalModelId: options.decision.providerModelId, code: normalized.code, message: normalized.message }], { cause: normalized });
  }
}
