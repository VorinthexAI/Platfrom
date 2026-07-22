import { z } from 'zod';
import { authorizeAgentExecution, type ExecutionAccessDataSource } from '@/lib/ai/agents/access';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import { newId } from '@/lib/ids';
import { recordRuntimeEvent, type RuntimeEventRecorder, type RuntimeEventSlug } from '@/platform/events';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { chorusToolNameSchema } from './registry';
import { runChorusTool, type ChorusToolDependencies } from './runtime';

export const runChorusAgentToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  agentKey: z.string().cuid(),
  tool: chorusToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunChorusAgentToolOptions extends ChorusToolDependencies {
  authenticatedUserKey: string;
  runtimeData?: AgentRuntimeDataSource;
  accessData?: ExecutionAccessDataSource;
  events?: RuntimeEventRecorder;
  resolveMembership?: typeof getUserOrganizationByOrganizationAndUser;
  executeTool?: typeof runChorusTool;
}

/** Authenticated human boundary for invoking a registered Chorus tool. */
export async function runChorusAgentTool(rawInput: z.input<typeof runChorusAgentToolInputSchema>, options: RunChorusAgentToolOptions) {
  const input = runChorusAgentToolInputSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey || runtime.scope.organizationKey !== input.organizationKey) {
    throw new Error('Agent does not belong to the requested organization.');
  }
  const membership = await (options.resolveMembership ?? getUserOrganizationByOrganizationAndUser)(input.organizationKey, authenticatedUserKey);
  if (!membership || membership.userId !== authenticatedUserKey || membership.status !== 'active') throw new Error('Active organization membership is required.');
  const principal = await authorizeAgentExecution(runtime, { kind: 'member', userOrganizationKey: membership.key }, options.accessData);
  if (principal.kind !== 'member' || principal.user.key !== authenticatedUserKey) throw new Error('Authenticated user does not match the resolved principal.');

  const invocationKey = newId();
  const startedAt = performance.now();
  const record = options.events ?? recordRuntimeEvent;
  const emit = async (slug: RuntimeEventSlug, status: string, elapsedMs?: number) => {
    try {
      await record({ scopeId: runtime.scope.key, userId: principal.user.key, slug, data: { invocationKey, agentKey: runtime.agent.key, actionSlug: input.tool, status, ...(elapsedMs === undefined ? {} : { elapsedMs }) } });
    } catch {
      // Runtime telemetry must not change tool behavior.
    }
  };

  await emit('agent.started', 'started');
  try {
    const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
    const output = await (options.executeTool ?? runChorusTool)(input.tool, input.input, context, { execute: options.execute });
    await emit('agent.completed', 'completed', Math.round(performance.now() - startedAt));
    return output;
  } catch (error) {
    await emit('agent.failed', 'failed', Math.round(performance.now() - startedAt));
    throw error;
  }
}
