import { z } from 'zod';
import { agentOutputMetadataSchema, type AgentRun } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunRepository, type AgentRunRepository } from '@/lib/ai/agent-runs';
import { getDefaultAgentRunStepRepository, type AgentRunStep, type AgentRunStepRepository } from '@/lib/ai/agent-run-steps';
import { getDefaultAgentRunCallRepository, type AgentRunCall, type AgentRunCallRepository } from '@/lib/ai/agent-run-calls';
import { compileAgentRuntimeContext, loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { getTool as getToolHandler } from '@/lib/ai/tools';
import { executeRoute, selectRoute, ProviderExecutionError, type RouteAttemptTelemetry, type RouterDependencies } from '@/lib/ai/router';
import type { ProviderExecuteResponse } from '@/lib/ai/providers';
import { modelSlugSchema } from '@/lib/db/models.node';
import { providerSlugSchema } from '@/lib/db/providers.node';
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
  modelSlug: modelSlugSchema.optional(),
  providerSlug: providerSlugSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.providerSlug && !value.modelSlug) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['providerSlug'], message: 'providerSlug requires modelSlug' });
});
export type RunStoredAgentToolParams = z.input<typeof runStoredAgentToolParamsSchema>;
export interface RunStoredAgentToolOptions extends RouterDependencies {
  runtimeData?: AgentRuntimeDataSource;
  runs?: AgentRunRepository;
  steps?: AgentRunStepRepository;
  calls?: AgentRunCallRepository;
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
  const systemPrompt = compileAgentRuntimeContext(runtime, { currentTask: request.currentTask, outputSchema: request.outputSchema });
  const input = injectSystemPrompt(request.input, systemPrompt);
  const routeInput = request.providerSlug
    ? { mode: 'fixed' as const, organizationKey: request.organizationKey, actionSlug: selected.action.slug, modelSlug: request.modelSlug!, providerSlug: request.providerSlug }
    : request.modelSlug
      ? { mode: 'model' as const, organizationKey: request.organizationKey, actionSlug: selected.action.slug, modelSlug: request.modelSlug }
      : { mode: 'auto' as const, organizationKey: request.organizationKey, actionSlug: selected.action.slug };
  const attempts: RouteAttemptTelemetry[] = [];

  try {
    const decision = await selectRoute(routeInput, options);
    const response = validateProviderResponse(await executeRoute<unknown, TOutput>({ decision, input, adapters: options.adapters, timeoutMs: options.timeoutMs, signal: options.signal, onAttempt: (attempt) => attempts.push(attempt) }));
    const metadata = validateAgentOutput(response.output);
    if (metadata.status !== 'accepted') throw new InvalidRunRequestError('an executed tool response cannot be rejected after execution');
    const persisted = await persistExecution({ runs, steps, calls, runtime, request, attempts, primarySkillKey: primarySkill.skill.key, status: 'completed', reason: metadata.reason, score: metadata.score, startedAt, startedAtMs });
    return { executed: true, ...persisted, response };
  } catch (error) {
    await persistExecution({ runs, steps, calls, runtime, request, attempts, primarySkillKey: primarySkill.skill.key, status: finalStatus(error), reason: request.metadata.reason, score: request.metadata.score, startedAt, startedAtMs });
    throw error;
  }
}

function injectSystemPrompt(input: unknown, systemPrompt: string): unknown {
  if (!input || typeof input !== 'object' || !('messages' in input)) return input;
  const record = input as Record<string, unknown>;
  return { ...record, system: typeof record.system === 'string' ? `${systemPrompt}\n\n${record.system}` : systemPrompt };
}

async function persistExecution(input: {
  runs: AgentRunRepository; steps: AgentRunStepRepository; calls: AgentRunCallRepository;
  runtime: Awaited<ReturnType<typeof loadAgentRuntime>>; request: z.infer<typeof runStoredAgentToolParamsSchema>;
  attempts: readonly RouteAttemptTelemetry[]; primarySkillKey: string; status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  reason: string; score: number; startedAt: string; startedAtMs: number;
}) {
  const endedAtMs = Date.now();
  const endedAt = new Date(endedAtMs).toISOString();
  const run = await input.runs.insertRun({ organizationKey: input.request.organizationKey, scopeKey: input.runtime.scope.key, agentKey: input.runtime.agent.key, status: input.status, reason: input.reason, score: input.score, startedAt: input.startedAt, endedAt, elapsedMs: endedAtMs - input.startedAtMs });
  const step = await input.steps.insertStep({ agentRunKey: run.key, stepSlug: input.request.stepSlug, status: input.status === 'completed' ? 'completed' : 'failed', startedAt: input.startedAt, endedAt, elapsedMs: endedAtMs - input.startedAtMs });
  const persistedCalls = await Promise.all(input.attempts.map((attempt) => input.calls.insertCall({ agentRunKey: run.key, agentRunStepKey: step.key, skillKey: input.primarySkillKey, toolKey: input.request.toolKey, actionKey: input.request.actionKey ?? input.runtime.tools.find(({ tool }) => tool.key === input.request.toolKey)!.actions[0]!.action.key, modelKey: attempt.modelKey, providerKey: attempt.providerKey, ...attempt.usage, startedAt: attempt.startedAt, endedAt: attempt.endedAt, elapsedMs: attempt.elapsedMs })));
  return { run, step, calls: persistedCalls };
}
