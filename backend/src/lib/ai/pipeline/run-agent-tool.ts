import { z } from 'zod';
import { getAgent } from '@/lib/ai/agents/registry';
import { compileAgentSystemPrompt } from '@/lib/ai/agents/prompt';
import type { AgentDefinition } from '@/lib/ai/agents/types';
import { aggregateAgentRun } from '@/lib/ai/agent-runs/aggregation';
import { getDefaultAgentRunRepository } from '@/lib/ai/agent-runs/repository';
import { agentRunCallSchema, maxTenWordsSchema, type AgentRun, type AgentRunCall } from '@/lib/ai/agent-runs/schema';
import type { AgentRunRepository } from '@/lib/ai/agent-runs/types';
import { assertToolAllowedByGuardrails } from '@/lib/ai/guardrails';
import { chatInputSchema, type ProviderExecuteResponse } from '@/lib/ai/providers/types';
import { executeRouteWithFallbacks, type RouteAttemptTelemetry } from '@/lib/ai/router/execute-route';
import type { RouteRequestInput } from '@/lib/ai/router/route-request';
import { selectRoute } from '@/lib/ai/router/select-route';
import { routingStrategySchema, type RouterDependencies } from '@/lib/ai/router/types';
import { AiError } from '@/lib/ai/shared/result';
import { getTool } from '@/lib/ai/tools';
import type { ToolDefinition } from '@/lib/ai/tools/types';
import { getActionBySlug, type Action } from '@/lib/db/actions.node';
import { getModelBySlug, type ModelSlug } from '@/lib/db/models.node';
import { getProviderBySlug, type ProviderSlug } from '@/lib/db/providers.node';
import { newId } from '@/lib/ids';
import { validateProviderResponse } from './validation';

export class InvalidRunRequestError extends AiError {
  constructor(detail: string) {
    super('invalid_run_request', `Invalid agent run request: ${detail}`);
  }
}

export class ToolNotGrantedError extends AiError {
  constructor(agentId: string, toolId: string) {
    super('tool_not_granted', `Agent ${agentId} does not have tool ${toolId}`);
  }
}

const cuidSchema = z.string().cuid2();

export const runAgentToolParamsSchema = z
  .object({
    agentId: z.string().min(1),
    toolId: z.string().min(1),
    organizationKey: cuidSchema,
    scopeKey: cuidSchema,
    agentKey: cuidSchema,
    skillKey: cuidSchema,
    toolKey: cuidSchema.nullable().default(null),
    stepId: z.string().trim().min(1),
    status: z.enum(['accepted', 'rejected']),
    reason: maxTenWordsSchema,
    score: z.number().min(0).max(1),
    input: z.unknown(),
    objective: z.string().optional(),
    strategy: routingStrategySchema.optional(),
  })
  .strict();

export type RunAgentToolParams = z.input<typeof runAgentToolParamsSchema>;

export interface AgentRunKeyResolver {
  resolveActionKey(actionId: string): Promise<string>;
  resolveModelKey(modelId: string): Promise<string>;
  resolveProviderKey(providerId: string): Promise<string>;
}

const defaultRunKeyResolver: AgentRunKeyResolver = {
  async resolveActionKey(actionId) {
    const action = await getActionBySlug(actionId as Action['slug']);
    if (!action) throw new InvalidRunRequestError(`action slug is not stored in DB: ${actionId}`);
    return action.key;
  },
  async resolveModelKey(modelId) {
    const model = await getModelBySlug(modelId as ModelSlug);
    if (!model) throw new InvalidRunRequestError(`model slug is not stored in DB: ${modelId}`);
    return model.key;
  },
  async resolveProviderKey(providerId) {
    const provider = await getProviderBySlug(providerId as ProviderSlug);
    if (!provider) throw new InvalidRunRequestError(`provider slug is not stored in DB: ${providerId}`);
    return provider.key;
  },
};

export interface RunAgentToolOptions extends RouterDependencies {
  agents?: Record<string, AgentDefinition>;
  runs?: AgentRunRepository;
  runKeys?: AgentRunKeyResolver;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentToolRunResult<TOutput> {
  response: ProviderExecuteResponse<TOutput>;
  run: AgentRun;
}

function withCompiledPrompt(agent: AgentDefinition, input: unknown): unknown {
  const chat = chatInputSchema.safeParse(input);
  if (!chat.success) return input;
  const compiled = compileAgentSystemPrompt(agent);
  return { ...chat.data, system: chat.data.system ? `${compiled}\n\n${chat.data.system}` : compiled };
}

function buildRouteRequest(tool: ToolDefinition, agent: AgentDefinition, params: z.infer<typeof runAgentToolParamsSchema>): RouteRequestInput {
  const strategy = params.strategy ?? tool.routing?.strategy ?? agent.defaultStrategy;
  if (tool.routing?.modelId) {
    return { mode: 'model', organizationId: params.organizationKey, actionId: tool.actionId, modelId: tool.routing.modelId, objective: params.objective, strategy };
  }
  return { mode: 'auto', organizationId: params.organizationKey, actionId: tool.actionId, objective: params.objective, strategy };
}

async function buildCalls(
  attempts: readonly RouteAttemptTelemetry[],
  request: z.infer<typeof runAgentToolParamsSchema>,
  actionId: string,
  resolver: AgentRunKeyResolver,
): Promise<AgentRunCall[]> {
  if (attempts.length === 0) return [];
  const actionKey = await resolver.resolveActionKey(actionId);
  return Promise.all(attempts.map(async (attempt) => agentRunCallSchema.parse({
    callId: newId(),
    stepId: request.stepId,
    skillKey: request.skillKey,
    toolKey: request.toolKey,
    actionKey,
    modelKey: await resolver.resolveModelKey(attempt.modelId),
    providerKey: await resolver.resolveProviderKey(attempt.providerId),
    ...attempt.usage,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    elapsedMs: attempt.elapsedMs,
  })));
}

/** Executes one runtime step and stores one call for every real provider invocation. */
export async function runAgentTool<TOutput = unknown>(params: RunAgentToolParams, options: RunAgentToolOptions = {}): Promise<AgentToolRunResult<TOutput>> {
  const parsedParams = runAgentToolParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    throw new InvalidRunRequestError(parsedParams.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  const request = parsedParams.data;
  const agent = options.agents?.[request.agentId] ?? getAgent(request.agentId);
  const tool = getTool(request.toolId);
  if (!agent.toolIds.includes(tool.id)) throw new ToolNotGrantedError(agent.id, tool.id);
  assertToolAllowedByGuardrails(agent.id, agent.guardrails, tool);

  const runs = options.runs ?? getDefaultAgentRunRepository();
  const resolver = options.runKeys ?? defaultRunKeyResolver;
  const attempts: RouteAttemptTelemetry[] = [];
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  const persistRun = async (stepStatus: 'completed' | 'failed') => {
    const endedAtMs = Date.now();
    const calls = await buildCalls(attempts, request, tool.actionId, resolver);
    return runs.insertRun(aggregateAgentRun({
      organizationKey: request.organizationKey,
      scopeKey: request.scopeKey,
      agentKey: request.agentKey,
      status: request.status,
      reason: request.reason,
      score: request.score,
      startedAt,
      endedAt: new Date(endedAtMs).toISOString(),
      elapsedMs: endedAtMs - startedAtMs,
      steps: [{ stepId: request.stepId, status: stepStatus, skillKeys: [request.skillKey], startedAt, endedAt: new Date(endedAtMs).toISOString(), elapsedMs: endedAtMs - startedAtMs }],
      calls,
    }));
  };

  try {
    const decision = await selectRoute(buildRouteRequest(tool, agent, request), options);
    const response = await executeRouteWithFallbacks<unknown, TOutput>({
      decision,
      input: withCompiledPrompt(agent, request.input),
      adapters: options.adapters,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onAttempt: (attempt) => attempts.push(attempt),
    });
    const validated = validateProviderResponse(response);
    return { response: validated, run: await persistRun('completed') };
  } catch (error) {
    await persistRun('failed');
    throw error;
  }
}
