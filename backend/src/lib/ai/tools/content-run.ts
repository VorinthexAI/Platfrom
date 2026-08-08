import { z } from 'zod';
import { authorizeAgentExecution, type ExecutionAccessDataSource } from '@/lib/ai/agents/access';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import type { DomainToolContext } from './domain-execute';
import { ContentError } from './content-errors';
import { contentToolNameSchema } from './content-registry';
import { runContentTool } from './content-runtime';

export const runContentAgentToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  agentKey: z.string().cuid(),
  tool: contentToolNameSchema,
  input: z.unknown(),
}).strict();

export interface RunContentAgentToolOptions {
  authenticatedUserKey: string;
  runtimeData?: AgentRuntimeDataSource;
  accessData?: ExecutionAccessDataSource;
  resolveMembership?: typeof getUserOrganizationByOrganizationAndUser;
  execute?: typeof runContentTool;
}

/** Authenticated human boundary for invoking a registered Content tool. */
export async function runContentAgentTool(rawInput: z.input<typeof runContentAgentToolInputSchema>, options: RunContentAgentToolOptions) {
  const input = runContentAgentToolInputSchema.parse(rawInput);
  const authenticatedUserKey = z.string().trim().min(1).parse(options.authenticatedUserKey);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey || runtime.scope.organizationKey !== input.organizationKey) {
    throw new ContentError('CONTENT_FORBIDDEN', 'Agent does not belong to the requested organization.', input.tool, { action: 'authorization' });
  }
  const membership = await (options.resolveMembership ?? getUserOrganizationByOrganizationAndUser)(input.organizationKey, authenticatedUserKey);
  if (!membership || membership.userId !== authenticatedUserKey) {
    throw new ContentError('CONTENT_FORBIDDEN', 'Active organization membership is required.', input.tool, { action: 'authorization' });
  }
  const principal = await authorizeAgentExecution(runtime, { kind: 'member', userOrganizationKey: membership.key }, options.accessData);
  if (principal.kind !== 'member' || principal.user.key !== authenticatedUserKey) {
    throw new ContentError('CONTENT_FORBIDDEN', 'Authenticated user does not match the resolved principal.', input.tool, { action: 'authorization' });
  }

  const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
  return (options.execute ?? runContentTool)(input.tool, input.input, context);
}
