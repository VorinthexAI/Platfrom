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
  toolKey: z.string().cuid(),
  actionKey: z.string().cuid(),
  principal: executionPrincipalSchema,
  input: z.unknown(),
}).strict();

export interface RunDomainAgentToolOptions {
  runtimeData?: AgentRuntimeDataSource;
  accessData?: ExecutionAccessDataSource;
  events?: RuntimeEventRecorder;
  execute?: typeof executeDomainTool;
}

/** Secure local tool boundary. The calling model chooses a granted tool and supplies JSON; only this backend handler may read or mutate domain data. */
export async function runDomainAgentTool(rawInput: z.input<typeof runDomainAgentToolInputSchema>, options: RunDomainAgentToolOptions = {}) {
  const input = runDomainAgentToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey) throw new Error('agent belongs to another organization');
  const grant = runtime.tools.find(({ tool }) => tool.key === input.toolKey);
  const linked = grant?.actions.find(({ action }) => action.key === input.actionKey);
  const principal = await authorizeAgentExecution(runtime, input.principal, options.accessData, { allowArchivedOrganization: linked?.action.slug === 'organization.restore' });
  if (!grant || !linked || !isDomainActionSlug(linked.action.slug) || grant.tool.slug !== linked.action.slug) throw new Error('domain tool/action is not granted to the agent');
  const record = options.events ?? recordRuntimeEvent;
  const userId = principal.kind === 'member' ? principal.user.key : null;
  const eventBase = { scopeId: runtime.scope.key, userId, data: { invocationKey: newId(), agentKey: runtime.agent.key, agentSlug: runtime.agent.slug, agentName: runtime.agent.name, toolKey: grant.tool.key, toolSlug: grant.tool.slug, toolName: grant.tool.name, actionKey: linked.action.key, actionSlug: linked.action.slug, actionName: linked.action.name } };
  await record({ ...eventBase, slug: 'tool.called', data: { ...eventBase.data, status: 'called' } });
  try {
    const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
    const output = domainToolResultSchema.parse(await (options.execute ?? executeDomainTool)(linked.action.slug, input.input, context));
    await record({ ...eventBase, slug: 'tool.completed', data: { ...eventBase.data, status: output.status } });
    return output;
  } catch (error) {
    await record({ ...eventBase, slug: 'tool.failed', data: { ...eventBase.data, status: 'failed', reason: (error instanceof Error ? error.message : String(error)).slice(0, 500) } });
    throw error;
  }
}

export { DOMAIN_ACTION_SLUGS };
