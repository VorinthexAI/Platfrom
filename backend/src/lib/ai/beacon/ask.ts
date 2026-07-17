import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { ZERO_TOKEN_USAGE, type TokenUsage } from '@/lib/ai/shared/usage';
import {
  compileAgentContext,
  compileAgentRuntimeContext,
  getAgentBySlug,
  loadAgentRuntime,
  type Agent,
  type AgentRuntimeDataSource,
} from '@/lib/ai/agents';
import type { AgentMemoryRepository } from '@/lib/ai/agent-memories';
import type { RuntimeVariableRepository } from '@/lib/ai/runtime-variables';
import { getDefaultAgentRunRepository, type AgentRun, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunStepRepository, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { getDefaultAgentRunCallRepository, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import { selectRoute, type RouteDecision, type RouterDependencies } from '@/lib/ai/router';
import { getDefaultProviderAdapters, type ChatInput, type ChatOutput, type ProviderExecuteRequest } from '@/lib/ai/providers';
import { ProviderError } from '@/lib/ai/providers/errors';
import type { Organization } from '@/lib/db/organizations.node';
import type { User } from '@/lib/db/users.node';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { Scope } from '@/lib/ai/scopes';
import { newId } from '@/lib/ids';
import { recordRuntimeEvent, type RuntimeEventData, type RuntimeEventRecorder, type RuntimeEventSlug } from '@/platform/events';
import { BEACON_AGENT_SLUG, BEACON_ASK_TOOL_SLUG } from './seed';

export const BEACON_ASK_STEP_SLUG = 'founders-beacon-ask';
export const BEACON_ASK_MAX_MESSAGE_LENGTH = 20_000;
/** Persisted run summary — the run schema caps reasons at ten words. */
const BEACON_RUN_REASON = 'Founders Gate Beacon ask';

export const beaconAskMessageSchema = z.string().trim().min(1).max(BEACON_ASK_MAX_MESSAGE_LENGTH);

export class BeaconUnavailableError extends AiError {
  constructor(detail: string) {
    super('beacon_unavailable', `Beacon is unavailable: ${detail}`);
  }
}

export class BeaconAskRequestError extends AiError {
  constructor(detail: string) {
    super('beacon_ask_invalid', `Invalid Beacon ask: ${detail}`);
  }
}

export interface BeaconAskParams {
  /** Founder-selected organization; membership already proven by the Founders Gate guard. */
  organization: Organization;
  /** Founder-selected scope; access already proven by the Founders Gate guard. */
  scope: Scope;
  /** The caller's active membership in `organization`. */
  membership: UserOrganization;
  user: User;
  message: string;
}

export interface BeaconAskOptions extends RouterDependencies {
  getAgent?: (slug: string) => Promise<Agent | null>;
  runtimeData?: AgentRuntimeDataSource;
  runs?: AgentRunRepository;
  steps?: AgentRunStepRepository;
  calls?: AgentRunCallRepository;
  events?: RuntimeEventRecorder;
  variables?: RuntimeVariableRepository;
  memories?: AgentMemoryRepository;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export type BeaconAskEvent =
  | { type: 'started'; runKey: string }
  | { type: 'delta'; text: string }
  | { type: 'completed'; runKey: string };

function askFailureStatus(error: unknown): 'cancelled' | 'timeout' | 'failed' {
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
  if (error instanceof ProviderError) {
    if (error.code === 'timeout') return 'timeout';
    if (error.code === 'aborted') return 'cancelled';
  }
  return 'failed';
}

function failureReason(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 500) || 'Unknown Beacon runtime error';
}

/**
 * Streams one isolated Beacon run for a founder-selected organization and
 * scope. The Founders Gate guard MUST have verified root membership,
 * organization membership, and scope access before this is called; this
 * function still re-asserts the canonical relations it receives, resolves
 * Beacon by its immutable slug, compiles the agent context, routes through
 * modelActions/modelProviders/organizationProviders, and streams only
 * user-facing text deltas. Every ask creates a new run — nothing is stored
 * on the Beacon node, so concurrent founders never share state.
 */
export async function* streamFoundersBeaconAsk(
  params: BeaconAskParams,
  options: BeaconAskOptions = {},
): AsyncGenerator<BeaconAskEvent> {
  const message = beaconAskMessageSchema.parse(params.message);
  const { organization, scope, membership, user } = params;
  if (membership.status !== 'active') throw new BeaconAskRequestError('membership is not active');
  if (membership.userId !== user.key) throw new BeaconAskRequestError('membership does not belong to the user');
  if (membership.organizationId !== organization.key) throw new BeaconAskRequestError('membership belongs to another organization');
  if (scope.organizationKey !== organization.key) throw new BeaconAskRequestError('scope belongs to another organization');

  const getAgent = options.getAgent ?? getAgentBySlug;
  const agent = await getAgent(BEACON_AGENT_SLUG);
  if (!agent) throw new BeaconUnavailableError('the beacon agent is not registered');

  const recordEvent = options.events ?? recordRuntimeEvent;
  const emit = async (slug: RuntimeEventSlug, data: RuntimeEventData) => {
    try {
      await recordEvent({ scopeId: scope.key, userId: user.key, slug, data });
    } catch (error) {
      console.warn('failed to record beacon runtime event', { slug, error: error instanceof Error ? error.message : String(error) });
    }
  };

  const runtime = await loadAgentRuntime(agent.key, options.runtimeData, {
    onGuardrailBlocked: async ({ scopeId, agentKey, toolKey, reason }) => {
      await emit('guardrail.blocked', { agentKey, toolKey, reason }).catch(() => {});
      void scopeId;
    },
  });
  const granted = runtime.tools.find(({ tool }) => tool.slug === BEACON_ASK_TOOL_SLUG);
  const selectedAction = granted?.actions[0];
  if (!granted || !selectedAction) throw new BeaconUnavailableError('beacon has no granted ask tool');
  const primarySkill = runtime.skills[0]!;

  // Beacon executes inside the founder-selected organization and scope: the
  // context, memories, provider allow-list, and persisted run all use the
  // selection, never Beacon's home scope.
  const executionRuntime = { ...runtime, organization, scope };
  const agentContext = await compileAgentContext(executionRuntime, {
    currentTask: message,
    variables: options.variables,
    memories: options.memories,
  });
  const systemPrompt = compileAgentRuntimeContext(agentContext, { outputFormat: 'user-text' });
  const input: ChatInput = { messages: [{ role: 'user', content: message }], system: systemPrompt };

  let decision: RouteDecision;
  try {
    decision = await selectRoute({ mode: 'auto', organizationKey: organization.key, actionSlug: selectedAction.action.slug }, options);
  } catch (error) {
    throw new BeaconUnavailableError(failureReason(error));
  }
  const adapters = options.adapters ?? getDefaultProviderAdapters();
  const adapter = adapters[decision.providerSlug];
  if (!adapter) throw new BeaconUnavailableError(`provider ${decision.providerSlug} has no adapter`);

  const runs = options.runs ?? getDefaultAgentRunRepository();
  const steps = options.steps ?? getDefaultAgentRunStepRepository();
  const calls = options.calls ?? getDefaultAgentRunCallRepository();

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const run: AgentRun = await runs.insertRun({
    organizationKey: organization.key,
    scopeKey: scope.key,
    agentKey: agent.key,
    principalType: 'member',
    userOrganizationKey: membership.key,
    status: 'accepted',
    reason: BEACON_RUN_REASON,
    score: 0,
    startedAt,
    endedAt: startedAt,
    elapsedMs: 0,
  });
  const stepKey = newId();
  const callKey = newId();
  await emit('agent.started', { runKey: run.key, agentKey: agent.key, status: 'started' });
  await emit('step.started', { runKey: run.key, stepKey, agentKey: agent.key, status: 'started' });
  await emit('tool.called', { runKey: run.key, stepKey, agentKey: agent.key, toolKey: granted.tool.key, actionKey: selectedAction.action.key, status: 'called' });
  await emit('model.called', { runKey: run.key, stepKey, callKey, agentKey: agent.key, toolKey: granted.tool.key, actionKey: decision.actionKey, modelKey: decision.modelKey, providerKey: decision.providerKey, status: 'called' });

  let usage: TokenUsage = ZERO_TOKEN_USAGE;
  let finalized = false;
  const finalize = async (status: 'completed' | 'cancelled' | 'timeout' | 'failed', eventReason?: string) => {
    if (finalized) return;
    finalized = true;
    const endedAtMs = Date.now();
    const endedAt = new Date(endedAtMs).toISOString();
    const elapsedMs = endedAtMs - startedAtMs;
    const stepStatus = status === 'completed' ? 'completed' : 'failed';
    const reason = status === 'completed' ? undefined : (eventReason ?? 'Unknown Beacon runtime error');
    try {
      await steps.insertStep({ key: stepKey, agentRunKey: run.key, stepSlug: BEACON_ASK_STEP_SLUG, status: stepStatus, startedAt, endedAt, elapsedMs });
      await calls.insertCall({
        key: callKey,
        agentRunKey: run.key,
        agentRunStepKey: stepKey,
        skillKey: primarySkill.skill.key,
        toolKey: granted.tool.key,
        actionKey: decision.actionKey,
        modelKey: decision.modelKey,
        providerKey: decision.providerKey,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        startedAt,
        endedAt,
        elapsedMs,
      });
      await runs.updateRun(run.key, { status, reason: BEACON_RUN_REASON, score: status === 'completed' ? 1 : 0, endedAt, elapsedMs });
    } catch (error) {
      console.warn('failed to persist beacon run outcome', { runKey: run.key, error: error instanceof Error ? error.message : String(error) });
    }
    await emit(status === 'completed' ? 'model.completed' : 'model.failed', { runKey: run.key, stepKey, callKey, agentKey: agent.key, actionKey: decision.actionKey, modelKey: decision.modelKey, providerKey: decision.providerKey, status, reason, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, elapsedMs });
    await emit(status === 'completed' ? 'step.completed' : 'step.failed', { runKey: run.key, stepKey, agentKey: agent.key, status: stepStatus, reason, elapsedMs });
    await emit(status === 'completed' ? 'tool.completed' : 'tool.failed', { runKey: run.key, stepKey, callKey, agentKey: agent.key, toolKey: granted.tool.key, actionKey: decision.actionKey, status, reason, elapsedMs });
    await emit(status === 'completed' ? 'agent.completed' : 'agent.failed', { runKey: run.key, agentKey: agent.key, status, reason, elapsedMs });
  };

  try {
    yield { type: 'started', runKey: run.key };
    const request: ProviderExecuteRequest<ChatInput> = {
      actionId: decision.actionSlug,
      modelId: decision.modelSlug,
      externalModelId: decision.providerModelId,
      input,
      organizationKey: organization.key,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    };
    if (adapter.stream) {
      for await (const chunk of adapter.stream(request)) {
        if (chunk.type === 'text-delta' && chunk.text) yield { type: 'delta', text: chunk.text };
        else if (chunk.type === 'usage') usage = chunk.usage;
      }
    } else {
      // No streaming support on this provider: run buffered and emit the
      // full answer as a single delta so the surface still completes.
      const response = await adapter.execute<ChatInput, ChatOutput>(request);
      usage = response.usage;
      const text = typeof response.output === 'object' && response.output !== null && 'text' in response.output
        ? String((response.output as { text?: unknown }).text ?? '')
        : '';
      if (text) yield { type: 'delta', text };
    }
    await finalize('completed');
    yield { type: 'completed', runKey: run.key };
  } catch (error) {
    await finalize(askFailureStatus(error), failureReason(error));
    throw error;
  } finally {
    // Reached without a terminal status only when the consumer stopped
    // iterating early (client disconnect) — record the cancellation.
    await finalize('cancelled', 'Stream consumer disconnected');
  }
}
