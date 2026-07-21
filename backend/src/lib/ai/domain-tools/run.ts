import { z } from 'zod';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { authorizeAgentExecution, executionPrincipalSchema, type ExecutionAccessDataSource } from '@/lib/ai/agents/access';
import { recordRuntimeEvent, type RuntimeEventRecorder } from '@/platform/events';
import { executeDomainTool, type DomainToolContext } from './execute';
import { DOMAIN_ACTION_SLUGS, domainToolResultSchema, isDomainActionSlug } from './schemas';
import { newId } from '@/lib/ids';

export const runDomainAgentToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1),
  agentKey: z.string().cuid(),
  actionSlug: z.string().trim().min(1).max(160),
  principal: executionPrincipalSchema,
  input: z.unknown(),
}).strict();

export interface RunDomainAgentToolOptions {
  runtimeData?: AgentRuntimeDataSource;
  accessData?: ExecutionAccessDataSource;
  events?: RuntimeEventRecorder;
  execute?: typeof executeDomainTool;
}

/** Secure local action boundary. Only this backend handler may read or mutate domain data. */
export async function runDomainAgentTool(rawInput: z.input<typeof runDomainAgentToolInputSchema>, options: RunDomainAgentToolOptions = {}) {
  const input = runDomainAgentToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey) throw new Error('agent belongs to another organization');
  if (!isDomainActionSlug(input.actionSlug)) throw new Error(`unknown domain action ${input.actionSlug}`);
  const principal = await authorizeAgentExecution(runtime, input.principal, options.accessData, { allowArchivedOrganization: input.actionSlug === 'organization.restore' });
  const record = options.events ?? recordRuntimeEvent;
  const userId = principal.kind === 'member' ? principal.user.key : null;
  const eventBase = { scopeId: runtime.scope.key, userId, data: { invocationKey: newId(), agentKey: runtime.agent.key, agentSlug: runtime.agent.slug, agentName: runtime.agent.name, actionSlug: input.actionSlug } };
  try {
    const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
    const output = domainToolResultSchema.parse(await (options.execute ?? executeDomainTool)(input.actionSlug, input.input, context));
    return output;
  } catch (error) {
    await record({ ...eventBase, slug: 'agent.failed', data: { ...eventBase.data, status: 'failed', reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
    throw error;
  }
}

export { DOMAIN_ACTION_SLUGS };
