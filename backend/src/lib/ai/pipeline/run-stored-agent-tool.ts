import { z } from 'zod';
import { agentOutputMetadataSchema, type AgentRun } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunRepository, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunStepRepository, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { getDefaultAgentRunCallRepository, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import { compileAgentContext, compileAgentRuntimeContext, loadAgentRuntime, type AgentContext, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { authorizeAgentExecution, type ExecutionAccessDataSource, type ExecutionPrincipal, type ResolvedExecutionPrincipal } from '@/lib/ai/agents/access';
import { sourceSelectionSchema, getDefaultAgentRunSourceRepository, type AgentRunSourceRepository } from '@/lib/ai/agent-run-sources';
import { getDefaultAgentArtifactRepository, type AgentArtifactRepository } from '@/lib/ai/agent-artifacts';
import type { RuntimeVariableRepository } from '@/lib/ai/runtime-variables';
import type { AgentMemoryRepository } from '@/lib/ai/agent-memories';
import type { ArtifactResolverRegistry, SourcePermissionResolver } from '@/lib/ai/artifact-resolvers';
import { getTool as getToolHandler } from '@/lib/ai/tools';
import { executeRoute, selectRoute, ProviderExecutionError, type RouteAttemptTelemetry, type RouterDependencies } from '@/lib/ai/router';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';
import { modelSlugSchema } from '@/lib/db/models.node';
import { providerSlugSchema } from '@/lib/db/providers.node';
import type { Action } from '@/lib/db/actions.node';
import type { ReverseContextCompiler } from '@/lib/ai/reverse-context/compiler';
import { newId } from '@/lib/ids';
import { organizationKeySchema } from '@/lib/ai/shared/ids';
import { recordRuntimeEvent, type RuntimeEventData, type RuntimeEventRecorder, type RuntimeEventSlug } from '@/platform/events';
import { InvalidRunRequestError } from './validation';
import { validateAgentOutput, validateProviderResponse } from './validation';

export const runStoredAgentToolParamsSchema = z.object({
  organizationKey: organizationKeySchema,
  agentKey: z.string().cuid(),
  toolKey: z.string().cuid(),
  actionKey: z.string().cuid().optional(),
  stepSlug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  metadata: agentOutputMetadataSchema,
  input: z.unknown(),
  currentTask: z.string().trim().min(1),
  outputSchema: z.string().trim().min(1),
  sources: z.array(sourceSelectionSchema).max(100).default([]),
  modelSlug: modelSlugSchema.optional(),
  providerSlug: providerSlugSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.providerSlug && !value.modelSlug) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerSlug'], message: 'providerSlug requires modelSlug' });
  const seenSources = new Set<string>();
  value.sources.forEach((source, index) => {
    const identity = `${source.nodeType}/${source.nodeKey}`;
    if (seenSources.has(identity)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sources', index], message: 'source selections must be unique' });
    seenSources.add(identity);
  });
});
export type RunStoredAgentToolParams = z.input<typeof runStoredAgentToolParamsSchema>;
export interface RunStoredAgentToolOptions extends RouterDependencies {
  /** Trusted caller identity. System execution is available only through this server-side option. */
  principal?: ExecutionPrincipal;
  accessData?: ExecutionAccessDataSource;
  runtimeData?: AgentRuntimeDataSource;
  runs?: AgentRunRepository;
  steps?: AgentRunStepRepository;
  calls?: AgentRunCallRepository;
  sources?: AgentRunSourceRepository;
  artifacts?: AgentArtifactRepository;
  events?: RuntimeEventRecorder;
  variables?: RuntimeVariableRepository;
  memories?: AgentMemoryRepository;
  artifactResolvers?: ArtifactResolverRegistry;
  canUseSource?: SourcePermissionResolver;
  reverseContextCompiler?: ReverseContextCompiler;
  knowledgeNodeTypes?: readonly string[];
  knowledgeTokenBudget?: number;
  allowRejectedOutput?: boolean;
  beforeFinalize?: (input: {
    run: AgentRun;
    response: ProviderExecuteResponse<unknown>;
    agentContext: AgentContext;
    /** Server-resolved actor; never copied from model or client payloads. */
    principal: ResolvedExecutionPrincipal;
    recordArtifactCreated: (artifact: { nodeType: string; nodeKey: string }) => Promise<void>;
  }) => Promise<void>;
  stepSlugs?: readonly string[];
  /** Internal model route used before a local tool action finalizes. Never accepted from clients. */
  reasoningActionSlug?: Action['slug'];
  timeoutMs?: number;
  signal?: AbortSignal;
}
export type StoredAgentRunResult<TOutput> =
  | { executed: false; run: AgentRun; step: null; calls: readonly []; response: null }
  | { executed: true; run: AgentRun; step: AgentRunStep; calls: readonly AgentRunCall[]; response: ProviderExecuteResponse<TOutput> };

function finalStatus(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled' as const;
  if (error instanceof ProviderExecutionError) {
    if (error.attempts.some((attempt) => attempt.code === 'timeout')) return 'timeout' as const;
    if (error.attempts.some((attempt) => attempt.code === 'aborted')) return 'cancelled' as const;
  }
  return 'failed' as const;
}

function runtimeEventReason(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 500) || 'Unknown runtime error';
}

/** Secure persisted-agent entry point. No client-supplied relation key is trusted without loading its DB link. */
export async function runStoredAgentTool<TOutput = unknown>(params: RunStoredAgentToolParams, options: RunStoredAgentToolOptions = {}): Promise<StoredAgentRunResult<TOutput>> {
  const parsed = runStoredAgentToolParamsSchema.safeParse(params);
  if (!parsed.success) throw new InvalidRunRequestError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const request = parsed.data;
  const recordEvent = options.events ?? recordRuntimeEvent;
  const runtime = await loadAgentRuntime(request.agentKey, options.runtimeData, {
    onGuardrailBlocked: async ({ scopeId, agentKey, toolKey, reason }) => {
      try {
        await recordEvent({ scopeId, userId: null, slug: 'guardrail.blocked', data: { agentKey, toolKey, reason } });
      } catch (error) {
        console.warn('failed to record agent runtime guardrail event', { agentKey, toolKey, error: error instanceof Error ? error.message : String(error) });
      }
    },
  });
  const emit = async (slug: RuntimeEventSlug, data: RuntimeEventData, userId: string | null = null) => {
    try {
      await recordEvent({ scopeId: runtime.scope.key, userId, slug, data });
    } catch (error) {
      console.warn('failed to record agent runtime event', { slug, runKey: data.runKey, error: error instanceof Error ? error.message : String(error) });
    }
  };
  if (runtime.scope.organizationKey !== request.organizationKey) throw new InvalidRunRequestError('agent scope does not belong to the requested organization');
  if (!options.principal) {
    await emit('guardrail.blocked', { agentKey: runtime.agent.key, reason: 'Execution principal is required' });
    throw new InvalidRunRequestError('execution principal is required');
  }
  let principal: Awaited<ReturnType<typeof authorizeAgentExecution>>;
  try {
    principal = await authorizeAgentExecution(runtime, options.principal, options.accessData);
  } catch (error) {
    await emit('guardrail.blocked', { agentKey: runtime.agent.key, reason: runtimeEventReason(error) });
    throw error;
  }
  const eventUserId = principal.kind === 'member' ? principal.user.key : null;
  const runs = options.runs ?? getDefaultAgentRunRepository();
  const steps = options.steps ?? getDefaultAgentRunStepRepository();
  const calls = options.calls ?? getDefaultAgentRunCallRepository();
  const sources = options.sources ?? getDefaultAgentRunSourceRepository();
  const artifacts = options.artifacts ?? getDefaultAgentArtifactRepository();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  if (request.metadata.status === 'rejected') {
    const endedAtMs = Date.now();
    const run = await runs.insertRun({ organizationKey: request.organizationKey, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, principalType: principal.kind, userOrganizationKey: principal.kind === 'member' ? principal.userOrganization.key : null, status: 'rejected', reason: request.metadata.reason, score: request.metadata.score, startedAt, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
    await emit('agent.started', { runKey: run.key, agentKey: runtime.agent.key, status: 'started' }, eventUserId);
    await emit('agent.failed', { runKey: run.key, agentKey: runtime.agent.key, status: 'rejected', reason: request.metadata.reason, elapsedMs: endedAtMs - startedAtMs }, eventUserId);
    return { executed: false, run, step: null, calls: [], response: null };
  }

  const granted = runtime.tools.find(({ tool }) => tool.key === request.toolKey);
  if (!granted) {
    await emit('guardrail.blocked', { agentKey: runtime.agent.key, toolKey: request.toolKey, reason: 'Tool not allowed' }, eventUserId);
    throw new InvalidRunRequestError(`tool ${request.toolKey} is not granted to agent ${request.agentKey}`);
  }
  getToolHandler(granted.tool.slug);
  const selected = request.actionKey ? granted.actions.find(({ action }) => action.key === request.actionKey) : granted.actions[0];
  if (!selected) {
    await emit('guardrail.blocked', { agentKey: runtime.agent.key, toolKey: request.toolKey, actionKey: request.actionKey, reason: 'Action not allowed' }, eventUserId);
    throw new InvalidRunRequestError(`action is not enabled for tool ${request.toolKey}`);
  }
  const primarySkill = runtime.skills[0]!;
  const agentContext = await compileAgentContext(runtime, { currentTask: request.currentTask, sources: request.sources, variables: options.variables, memories: options.memories, artifactResolvers: options.artifactResolvers, canUseSource: options.canUseSource, reverseContextCompiler: options.reverseContextCompiler, knowledgeNodeTypes: options.knowledgeNodeTypes, knowledgeTokenBudget: options.knowledgeTokenBudget });
  const systemPrompt = compileAgentRuntimeContext(agentContext, { outputSchema: request.outputSchema });
  const input = injectSystemPrompt(request.input, systemPrompt);
  const routeActionSlug = options.reasoningActionSlug ?? selected.action.slug;
  const routeInput = request.providerSlug
    ? { mode: 'fixed' as const, organizationKey: request.organizationKey, actionSlug: routeActionSlug, modelSlug: request.modelSlug!, providerSlug: request.providerSlug }
    : request.modelSlug
      ? { mode: 'model' as const, organizationKey: request.organizationKey, actionSlug: routeActionSlug, modelSlug: request.modelSlug }
      : { mode: 'auto' as const, organizationKey: request.organizationKey, actionSlug: routeActionSlug };
  const attempts: RouteAttemptTelemetry[] = [];
  const stepSlugs = options.stepSlugs ?? [request.stepSlug];
  if (stepSlugs.length === 0 || stepSlugs.at(-1) !== request.stepSlug) throw new InvalidRunRequestError('stepSlugs must end with the executed stepSlug');
  const preparedSteps = stepSlugs.map((stepSlug) => ({ key: newId(), stepSlug }));
  const run = await runs.insertRun({ organizationKey: request.organizationKey, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, principalType: principal.kind, userOrganizationKey: principal.kind === 'member' ? principal.userOrganization.key : null, status: 'accepted', reason: request.metadata.reason, score: request.metadata.score, startedAt, endedAt: startedAt, elapsedMs: 0 });
  await emit('agent.started', { runKey: run.key, agentKey: runtime.agent.key, status: 'started' }, eventUserId);
  for (const step of preparedSteps) await emit('step.started', { runKey: run.key, stepKey: step.key, agentKey: runtime.agent.key, status: 'started' }, eventUserId);
  try {
    await persistSources(run.key, request.sources, sources, artifacts, async (data) => emit('artifact.used', { ...data, agentKey: runtime.agent.key }, eventUserId));
  } catch (error) {
    const endedAtMs = Date.now();
    await runs.updateRun(run.key, { status: 'failed', reason: request.metadata.reason, score: request.metadata.score, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
    for (const step of preparedSteps) await emit('step.failed', { runKey: run.key, stepKey: step.key, agentKey: runtime.agent.key, status: 'failed', reason: runtimeEventReason(error), elapsedMs: endedAtMs - startedAtMs }, eventUserId);
    await emit('agent.failed', { runKey: run.key, agentKey: runtime.agent.key, status: 'failed', reason: runtimeEventReason(error), elapsedMs: endedAtMs - startedAtMs }, eventUserId);
    throw error;
  }

  const executedStep = preparedSteps.at(-1)!;
  await emit('tool.called', { runKey: run.key, stepKey: executedStep.key, agentKey: runtime.agent.key, toolKey: request.toolKey, actionKey: selected.action.key, status: 'called' }, eventUserId);

  let response: ProviderExecuteResponse<TOutput>;
  let responseMetadata: ReturnType<typeof validateAgentOutput>;
  try {
    const decision = await selectRoute(routeInput, options);
    response = validateProviderResponse(await executeRoute<unknown, TOutput>({
      decision,
      input,
      adapters: options.adapters,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onAttemptStart: async (attempt) => {
        const callKey = newId();
        await emit('model.called', { runKey: run.key, stepKey: executedStep.key, callKey, agentKey: runtime.agent.key, toolKey: request.toolKey, actionKey: attempt.actionKey, modelKey: attempt.modelKey, providerKey: attempt.providerKey, status: 'called' }, eventUserId);
        return callKey;
      },
      onAttempt: async (attempt) => {
        attempts.push(attempt);
        await emit(attempt.status === 'completed' ? 'model.completed' : 'model.failed', {
          runKey: run.key, stepKey: executedStep.key, callKey: attempt.callKey, agentKey: runtime.agent.key,
          actionKey: attempt.actionKey, modelKey: attempt.modelKey, providerKey: attempt.providerKey,
          status: attempt.status, reason: attempt.errorCode, inputTokens: attempt.usage.inputTokens,
          outputTokens: attempt.usage.outputTokens, elapsedMs: attempt.elapsedMs,
        }, eventUserId);
      },
    }));
    responseMetadata = validateAgentOutput(response.output);
    if (responseMetadata.status !== 'accepted' && !options.allowRejectedOutput) throw new InvalidRunRequestError('an executed tool response cannot be rejected after execution');
    await options.beforeFinalize?.({
      run,
      response: response as ProviderExecuteResponse<unknown>,
      agentContext,
      principal,
      recordArtifactCreated: ({ nodeType, nodeKey }) => emit('artifact.created', { runKey: run.key, agentKey: runtime.agent.key, nodeType, nodeKey, status: 'created' }, eventUserId),
    });
  } catch (error) {
    await persistExecution({ run, runs, steps, calls, runtime, request, attempts, preparedSteps, primarySkillKey: primarySkill.skill.key, toolActionKey: selected.action.key, status: finalStatus(error), reason: request.metadata.reason, eventReason: runtimeEventReason(error), score: request.metadata.score, startedAtMs, emit, eventUserId });
    throw error;
  }
  const persisted = await persistExecution({ run, runs, steps, calls, runtime, request, attempts, preparedSteps, primarySkillKey: primarySkill.skill.key, toolActionKey: selected.action.key, status: responseMetadata.status === 'accepted' ? 'completed' : 'rejected', reason: responseMetadata.reason, eventReason: responseMetadata.reason, score: responseMetadata.score, startedAtMs, emit, eventUserId });
  return { executed: true, ...persisted, response };
}

function injectSystemPrompt(input: unknown, systemPrompt: string): unknown {
  if (!input || typeof input !== 'object' || !('messages' in input)) return input;
  const record = input as Record<string, unknown>;
  return { ...record, system: typeof record.system === 'string' ? `${systemPrompt}\n\n${record.system}` : systemPrompt };
}

async function persistExecution(input: {
  run: AgentRun; runs: AgentRunRepository; steps: AgentRunStepRepository; calls: AgentRunCallRepository;
  runtime: Awaited<ReturnType<typeof loadAgentRuntime>>; request: z.infer<typeof runStoredAgentToolParamsSchema>;
  attempts: readonly RouteAttemptTelemetry[]; preparedSteps: readonly { key: string; stepSlug: string }[]; primarySkillKey: string; toolActionKey: string; status: 'completed' | 'rejected' | 'failed' | 'cancelled' | 'timeout';
  reason: string; eventReason: string; score: number; startedAtMs: number; eventUserId: string | null;
  emit: (slug: RuntimeEventSlug, data: RuntimeEventData, userId?: string | null) => Promise<void>;
}) {
  const endedAtMs = Math.max(Date.now(), input.startedAtMs + input.preparedSteps.length - 1);
  const endedAt = new Date(endedAtMs).toISOString();
  const persistedSteps = [] as AgentRunStep[];
  for (const [index, prepared] of input.preparedSteps.entries()) {
    const stepStartedAtMs = input.startedAtMs + index;
    const stepStatus = input.status === 'completed' || input.status === 'rejected' ? 'completed' : 'failed';
    persistedSteps.push(await input.steps.insertStep({ key: prepared.key, agentRunKey: input.run.key, stepSlug: prepared.stepSlug, status: stepStatus, startedAt: new Date(stepStartedAtMs).toISOString(), endedAt, elapsedMs: endedAtMs - stepStartedAtMs }));
    await input.emit(stepStatus === 'completed' ? 'step.completed' : 'step.failed', { runKey: input.run.key, stepKey: prepared.key, agentKey: input.runtime.agent.key, status: stepStatus, reason: stepStatus === 'failed' ? input.eventReason : undefined, elapsedMs: endedAtMs - stepStartedAtMs }, input.eventUserId);
  }
  const step = persistedSteps.at(-1)!;
  const persistedCalls = await Promise.all(input.attempts.map((attempt) => input.calls.insertCall({ key: attempt.callKey, agentRunKey: input.run.key, agentRunStepKey: step.key, skillKey: input.primarySkillKey, toolKey: input.request.toolKey, actionKey: attempt.actionKey, modelKey: attempt.modelKey, providerKey: attempt.providerKey, ...attempt.usage, startedAt: attempt.startedAt, endedAt: attempt.endedAt, elapsedMs: attempt.elapsedMs })));
  const run = await input.runs.updateRun(input.run.key, { status: input.status, reason: input.reason, score: input.score, endedAt, elapsedMs: endedAtMs - input.startedAtMs });
  const terminalCall = persistedCalls.at(-1);
  const terminalData = { runKey: run.key, stepKey: step.key, callKey: terminalCall?.key, agentKey: input.runtime.agent.key, toolKey: input.request.toolKey, actionKey: input.toolActionKey, status: input.status, reason: input.status === 'completed' ? undefined : input.eventReason, elapsedMs: endedAtMs - input.startedAtMs };
  await input.emit(input.status === 'completed' ? 'tool.completed' : 'tool.failed', terminalData, input.eventUserId);
  await input.emit(input.status === 'completed' ? 'agent.completed' : 'agent.failed', { runKey: run.key, agentKey: input.runtime.agent.key, status: input.status, reason: input.status === 'completed' ? undefined : input.eventReason, elapsedMs: endedAtMs - input.startedAtMs }, input.eventUserId);
  return { run, step, calls: persistedCalls };
}

async function persistSources(
  runKey: string,
  selections: z.infer<typeof sourceSelectionSchema>[],
  sources: AgentRunSourceRepository,
  artifacts: AgentArtifactRepository,
  onUsed: (data: RuntimeEventData) => Promise<void>,
) {
  const ordered = [...selections].sort((left, right) => right.priority - left.priority || left.nodeType.localeCompare(right.nodeType) || left.nodeKey.localeCompare(right.nodeKey));
  for (const [position, source] of ordered.entries()) {
    await sources.insertSource({ agentRunKey: runKey, ...source });
    await artifacts.insertArtifact({ agentRunKey: runKey, nodeType: source.nodeType, nodeKey: source.nodeKey, relation: 'source', groupKey: null, position });
    await onUsed({ runKey, nodeType: source.nodeType, nodeKey: source.nodeKey, status: 'used' });
  }
}
