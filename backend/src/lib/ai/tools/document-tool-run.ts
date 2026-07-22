import { z } from 'zod';
import { authorizeAgentExecution, type ExecutionAccessDataSource } from '@/lib/ai/agents/access';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import { newId } from '@/lib/ids';
import { recordRuntimeEvent, type RuntimeEventRecorder, type RuntimeEventSlug } from '@/platform/events';
import type { DomainToolContext } from '@/lib/ai/domain-tools/execute';
import { DocumentError } from './document-tool-errors';
import { documentToolNameSchema } from './document-tool-registry';
import { runDocumentTool } from './document-tool-runtime';

export const runDocumentAgentToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  agentKey: z.string().cuid(),
  tool: documentToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunDocumentAgentToolOptions {
  authenticatedUserKey: string;
  runtimeData?: AgentRuntimeDataSource;
  accessData?: ExecutionAccessDataSource;
  events?: RuntimeEventRecorder;
  resolveMembership?: typeof getUserOrganizationByOrganizationAndUser;
  execute?: typeof runDocumentTool;
}

/** Authenticated human boundary for invoking a registered Document tool. */
export async function runDocumentAgentTool(rawInput: z.input<typeof runDocumentAgentToolInputSchema>, options: RunDocumentAgentToolOptions) {
  const input = runDocumentAgentToolInputSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey || runtime.scope.organizationKey !== input.organizationKey) {
    throw new DocumentError('DOCUMENT_FORBIDDEN', 'Agent does not belong to the requested organization.', input.tool, { action: 'authorization' });
  }
  const membership = await (options.resolveMembership ?? getUserOrganizationByOrganizationAndUser)(input.organizationKey, authenticatedUserKey);
  if (!membership || membership.userId !== authenticatedUserKey) {
    throw new DocumentError('DOCUMENT_FORBIDDEN', 'Active organization membership is required.', input.tool, { action: 'authorization' });
  }
  const principal = await authorizeAgentExecution(runtime, { kind: 'member', userOrganizationKey: membership.key }, options.accessData);
  if (principal.kind !== 'member' || principal.user.key !== authenticatedUserKey) {
    throw new DocumentError('DOCUMENT_FORBIDDEN', 'Authenticated user does not match the resolved principal.', input.tool, { action: 'authorization' });
  }

  const invocationKey = newId();
  const startedAt = performance.now();
  const eventData = { invocationKey, agentKey: runtime.agent.key, actionSlug: input.tool };
  const record = options.events ?? recordRuntimeEvent;
  const emit = async (slug: RuntimeEventSlug, status: string, elapsedMs?: number) => {
    try {
      await record({ scopeId: runtime.scope.key, userId: principal.user.key, slug, data: { ...eventData, status, ...(elapsedMs === undefined ? {} : { elapsedMs }) } });
    } catch {
      // Runtime telemetry must not change tool behavior.
    }
  };

  await emit('agent.started', 'started');
  try {
    const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
    const output = await (options.execute ?? runDocumentTool)(input.tool, input.input, context);
    await emit('agent.completed', 'completed', Math.round(performance.now() - startedAt));
    return output;
  } catch (error) {
    await emit('agent.failed', 'failed', Math.round(performance.now() - startedAt));
    throw error;
  }
}
