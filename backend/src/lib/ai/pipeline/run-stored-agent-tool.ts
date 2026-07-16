import { z } from 'zod';
import { agentOutputMetadataSchema, type AgentRun } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunRepository, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunStepRepository, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { getDefaultAgentRunCallRepository, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import { compileAgentContext, compileAgentRuntimeContext, loadAgentRuntime, type AgentContext, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
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
import { InvalidRunRequestError } from './validation';
import { validateAgentOutput, validateProviderResponse } from './validation';

export const runStoredAgentToolParamsSchema = z.object({
  organizationKey: z.string().cuid(),
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
  runtimeData?: AgentRuntimeDataSource;
  runs?: AgentRunRepository;
  steps?: AgentRunStepRepository;
  calls?: AgentRunCallRepository;
  sources?: AgentRunSourceRepository;
  artifacts?: AgentArtifactRepository;
  variables?: RuntimeVariableRepository;
  memories?: AgentMemoryRepository;
  artifactResolvers?: ArtifactResolverRegistry;
  canUseSource?: SourcePermissionResolver;
  reverseContextCompiler?: ReverseContextCompiler;
  knowledgeNodeTypes?: readonly string[];
  knowledgeTokenBudget?: number;
  allowRejectedOutput?: boolean;
  beforeFinalize?: (input: { run: AgentRun; response: ProviderExecuteResponse<unknown>; agentContext: AgentContext }) => Promise<void>;
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

/** Secure persisted-agent entry point. No client-supplied relation key is trusted without loading its DB link. */
export async function runStoredAgentTool<TOutput = unknown>(params: RunStoredAgentToolParams, options: RunStoredAgentToolOptions = {}): Promise<StoredAgentRunResult<TOutput>> {
  const parsed = runStoredAgentToolParamsSchema.safeParse(params);
  if (!parsed.success) throw new InvalidRunRequestError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  const request = parsed.data;
  const runtime = await loadAgentRuntime(request.agentKey, options.runtimeData);
  if (runtime.scope.organizationKey !== request.organizationKey) throw new InvalidRunRequestError('agent scope does not belong to the requested organization');
  const runs = options.runs ?? getDefaultAgentRunRepository();
  const steps = options.steps ?? getDefaultAgentRunStepRepository();
  const calls = options.calls ?? getDefaultAgentRunCallRepository();
  const sources = options.sources ?? getDefaultAgentRunSourceRepository();
  const artifacts = options.artifacts ?? getDefaultAgentArtifactRepository();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  if (request.metadata.status === 'rejected') {
    const endedAtMs = Date.now();
    const run = await runs.insertRun({ organizationKey: request.organizationKey, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, status: 'rejected', reason: request.metadata.reason, score: request.metadata.score, startedAt, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
    return { executed: false, run, step: null, calls: [], response: null };
  }

  const granted = runtime.tools.find(({ tool }) => tool.key === request.toolKey);
  if (!granted) throw new InvalidRunRequestError(`tool ${request.toolKey} is not granted to agent ${request.agentKey}`);
  getToolHandler(granted.tool.slug);
  const selected = request.actionKey ? granted.actions.find(({ action }) => action.key === request.actionKey) : granted.actions[0];
  if (!selected) throw new InvalidRunRequestError(`action is not enabled for tool ${request.toolKey}`);
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
  const run = await runs.insertRun({ organizationKey: request.organizationKey, scopeKey: runtime.scope.key, agentKey: runtime.agent.key, status: 'accepted', reason: request.metadata.reason, score: request.metadata.score, startedAt, endedAt: startedAt, elapsedMs: 0 });
  try {
    await persistSources(run.key, request.sources, sources, artifacts);
  } catch (error) {
    const endedAtMs = Date.now();
    await runs.updateRun(run.key, { status: 'failed', reason: request.metadata.reason, score: request.metadata.score, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs });
    throw error;
  }

  let response: ProviderExecuteResponse<TOutput>;
  let responseMetadata: ReturnType<typeof validateAgentOutput>;
  try {
    const decision = await selectRoute(routeInput, options);
    response = validateProviderResponse(await executeRoute<unknown, TOutput>({ decision, input, adapters: options.adapters, timeoutMs: options.timeoutMs, signal: options.signal, onAttempt: (attempt) => attempts.push(attempt) }));
    responseMetadata = validateAgentOutput(response.output);
    if (responseMetadata.status !== 'accepted' && !options.allowRejectedOutput) throw new InvalidRunRequestError('an executed tool response cannot be rejected after execution');
    await options.beforeFinalize?.({ run, response: response as ProviderExecuteResponse<unknown>, agentContext });
  } catch (error) {
    await persistExecution({ run, runs, steps, calls, runtime, request, attempts, stepSlugs: options.stepSlugs ?? [request.stepSlug], primarySkillKey: primarySkill.skill.key, status: finalStatus(error), reason: request.metadata.reason, score: request.metadata.score, startedAt, startedAtMs });
    throw error;
  }
  const persisted = await persistExecution({ run, runs, steps, calls, runtime, request, attempts, stepSlugs: options.stepSlugs ?? [request.stepSlug], primarySkillKey: primarySkill.skill.key, status: responseMetadata.status === 'accepted' ? 'completed' : 'rejected', reason: responseMetadata.reason, score: responseMetadata.score, startedAt, startedAtMs });
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
  attempts: readonly RouteAttemptTelemetry[]; stepSlugs: readonly string[]; primarySkillKey: string; status: 'completed' | 'rejected' | 'failed' | 'cancelled' | 'timeout';
  reason: string; score: number; startedAt: string; startedAtMs: number;
}) {
  const endedAtMs = Math.max(Date.now(), input.startedAtMs + input.stepSlugs.length - 1);
  const endedAt = new Date(endedAtMs).toISOString();
  if (input.stepSlugs.length === 0 || input.stepSlugs.at(-1) !== input.request.stepSlug) throw new InvalidRunRequestError('stepSlugs must end with the executed stepSlug');
  const persistedSteps = [] as AgentRunStep[];
  for (const [index, stepSlug] of input.stepSlugs.entries()) {
    const stepStartedAtMs = input.startedAtMs + index;
    persistedSteps.push(await input.steps.insertStep({ agentRunKey: input.run.key, stepSlug, status: input.status === 'completed' || input.status === 'rejected' ? 'completed' : 'failed', startedAt: new Date(stepStartedAtMs).toISOString(), endedAt, elapsedMs: endedAtMs - stepStartedAtMs }));
  }
  const step = persistedSteps.at(-1)!;
  const persistedCalls = await Promise.all(input.attempts.map((attempt) => input.calls.insertCall({ agentRunKey: input.run.key, agentRunStepKey: step.key, skillKey: input.primarySkillKey, toolKey: input.request.toolKey, actionKey: attempt.actionKey, modelKey: attempt.modelKey, providerKey: attempt.providerKey, ...attempt.usage, startedAt: attempt.startedAt, endedAt: attempt.endedAt, elapsedMs: attempt.elapsedMs })));
  const run = await input.runs.updateRun(input.run.key, { status: input.status, reason: input.reason, score: input.score, endedAt, elapsedMs: endedAtMs - input.startedAtMs });
  return { run, step, calls: persistedCalls };
}

async function persistSources(runKey: string, selections: z.infer<typeof sourceSelectionSchema>[], sources: AgentRunSourceRepository, artifacts: AgentArtifactRepository) {
  const ordered = [...selections].sort((left, right) => right.priority - left.priority || left.nodeType.localeCompare(right.nodeType) || left.nodeKey.localeCompare(right.nodeKey));
  for (const [position, source] of ordered.entries()) {
    await sources.insertSource({ agentRunKey: runKey, ...source });
    await artifacts.insertArtifact({ agentRunKey: runKey, nodeType: source.nodeType, nodeKey: source.nodeKey, relation: 'source', groupKey: null, position });
  }
}
