import { z } from 'zod';
import { getAgent } from '@/lib/ai/agents/registry';
import { compileAgentSystemPrompt } from '@/lib/ai/agents/prompt';
import type { AgentDefinition } from '@/lib/ai/agents/types';
import { assertToolAllowedByGuardrails } from '@/lib/ai/guardrails';
import { getTool } from '@/lib/ai/tools';
import type { ToolDefinition } from '@/lib/ai/tools/types';
import { chatInputSchema } from '@/lib/ai/providers/types';
import type { ProviderExecuteResponse } from '@/lib/ai/providers/types';
import { isAiError, AiError } from '@/lib/ai/shared/result';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { selectRoute } from '@/lib/ai/router/select-route';
import { executeRouteWithFallbacks } from '@/lib/ai/router/execute-route';
import { routingStrategySchema, type RouterDependencies } from '@/lib/ai/router/types';
import type { RouteRequestInput } from '@/lib/ai/router/route-request';
import { getDefaultAgentRunRepository } from '@/lib/ai/agent-runs/repository';
import type { AgentRun, AgentRunStep } from '@/lib/ai/agent-runs/schema';
import type { AgentRunRepository } from '@/lib/ai/agent-runs/types';
import { buildOutputMetadata, validateProviderResponse } from './validation';

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

export const runAgentToolParamsSchema = z
  .object({
    agentId: z.string().min(1),
    toolId: z.string().min(1),
    organizationId: organizationIdSchema,
    input: z.unknown(),
    objective: z.string().optional(),
    strategy: routingStrategySchema.optional(),
  })
  .strict();

export type RunAgentToolParams = z.input<typeof runAgentToolParamsSchema>;

export interface RunAgentToolOptions extends RouterDependencies {
  /** Agent lookup override for tests / externally-loaded agents. */
  agents?: Record<string, AgentDefinition>;
  runs?: AgentRunRepository;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface AgentToolRunResult<TOutput> {
  response: ProviderExecuteResponse<TOutput>;
  run: AgentRun;
}

/**
 * For chat-shaped actions the agent's compiled system prompt is prepended
 * to whatever system text the caller provided. Non-chat inputs pass
 * through untouched — the provider adapter validates them per action.
 */
function withCompiledPrompt(agent: AgentDefinition, input: unknown): unknown {
  const chat = chatInputSchema.safeParse(input);
  if (!chat.success) return input;
  const compiled = compileAgentSystemPrompt(agent);
  return {
    ...chat.data,
    system: chat.data.system ? `${compiled}\n\n${chat.data.system}` : compiled,
  };
}

function buildRouteRequest(
  tool: ToolDefinition,
  agent: AgentDefinition,
  params: z.infer<typeof runAgentToolParamsSchema>,
): RouteRequestInput {
  const strategy = params.strategy ?? tool.routing?.strategy ?? agent.defaultStrategy;
  if (tool.routing?.modelId) {
    return {
      mode: 'model',
      organizationId: params.organizationId,
      actionId: tool.actionId,
      modelId: tool.routing.modelId,
      objective: params.objective,
      strategy,
    };
  }
  return {
    mode: 'auto',
    organizationId: params.organizationId,
    actionId: tool.actionId,
    objective: params.objective,
    strategy,
  };
}

/**
 * The execution pipeline:
 *
 *   Agent → Tool → Action → Router → Model → Provider → Response
 *   → Validation → agent_runs
 *
 * Guardrails are enforced before anything executes; the router only ever
 * sees actions (tools never name providers); the run ledger records
 * metadata, tokens, timing, steps, and output metadata — ids only, never
 * registry data, credentials, or generated content.
 */
export async function runAgentTool<TOutput = unknown>(
  params: RunAgentToolParams,
  options: RunAgentToolOptions = {},
): Promise<AgentToolRunResult<TOutput>> {
  const parsedParams = runAgentToolParamsSchema.safeParse(params);
  if (!parsedParams.success) {
    throw new InvalidRunRequestError(
      parsedParams.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  const request = parsedParams.data;

  // Agent → Tool: resolve, check the grant, enforce guardrails (scopeId
  // allow-list) — all before any run document or provider call exists.
  const agent = options.agents?.[request.agentId] ?? getAgent(request.agentId);
  const tool = getTool(request.toolId);
  if (!agent.toolIds.includes(tool.id)) throw new ToolNotGrantedError(agent.id, tool.id);
  assertToolAllowedByGuardrails(agent.id, agent.guardrails, tool);

  const routeRequest = buildRouteRequest(tool, agent, request);
  const strategy = request.strategy ?? tool.routing?.strategy ?? agent.defaultStrategy;
  const input = withCompiledPrompt(agent, request.input);

  const runs = options.runs ?? getDefaultAgentRunRepository();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const steps: AgentRunStep[] = [];

  const run = await runs.insertRun({
    organizationId: request.organizationId,
    agentId: agent.id,
    toolId: tool.id,
    actionId: tool.actionId,
    status: 'running',
    strategy,
    startedAt,
  });

  try {
    // Action → Router: the router loads the organization allow-list
    // server-side and stays authoritative over the tool's preferences.
    const decision = await selectRoute(routeRequest, options);
    steps.push({
      index: steps.length,
      type: 'route-selected',
      at: new Date().toISOString(),
      modelId: decision.modelId,
      providerId: decision.providerId,
      externalModelId: decision.externalModelId,
      score: decision.score,
    });

    // Model → Provider → Response.
    const executionStartMs = Date.now();
    const response = await executeRouteWithFallbacks<unknown, TOutput>({
      decision,
      input,
      adapters: options.adapters,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    steps.push({
      index: steps.length,
      type: 'provider-executed',
      at: new Date().toISOString(),
      durationMs: Date.now() - executionStartMs,
      modelId: response.modelId,
      providerId: response.providerId,
      externalModelId: response.externalModelId,
    });

    // Validation → agent_runs.
    const validated = validateProviderResponse(response);
    const finishedAtMs = Date.now();
    const finalRun = await runs.updateRun(run.key, {
      status: 'succeeded',
      modelId: validated.modelId,
      providerId: validated.providerId,
      externalModelId: validated.externalModelId,
      usage: validated.usage,
      steps,
      output: buildOutputMetadata(tool.actionId, validated.output),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
    });

    return { response: validated, run: finalRun };
  } catch (err) {
    const code = isAiError(err) ? err.code : 'unknown';
    const message = err instanceof Error ? err.message : 'unknown error';
    steps.push({ index: steps.length, type: 'provider-failed', at: new Date().toISOString(), errorCode: code });
    const finishedAtMs = Date.now();
    await runs.updateRun(run.key, {
      status: 'failed',
      steps,
      error: { code, message },
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - startedAtMs,
    });
    throw err;
  }
}
