import { z } from 'zod';
import { loadAgentRuntime, type AgentRuntimeDataSource } from '@/lib/ai/agents/runtime';
import { authorizeAgentExecution, executionPrincipalSchema, type ExecutionAccessDataSource } from '@/lib/ai/agents/access';
import { executeDomainTool, type DomainToolContext } from './domain-execute';
import { DOMAIN_ACTION_SLUGS, domainToolResultSchema, isDomainActionSlug } from './domain-schemas';

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
  execute?: typeof executeDomainTool;
}

/** Secure local action boundary. Only this backend handler may read or mutate domain data. */
export async function runDomainAgentTool(rawInput: z.input<typeof runDomainAgentToolInputSchema>, options: RunDomainAgentToolOptions = {}) {
  const input = runDomainAgentToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey) throw new Error('agent belongs to another organization');
  if (!isDomainActionSlug(input.actionSlug)) throw new Error(`unknown domain action ${input.actionSlug}`);
  const principal = await authorizeAgentExecution(runtime, input.principal, options.accessData);
  const context: DomainToolContext = { organizationKey: input.organizationKey, runtimeScopeKey: runtime.scope.key, principal };
  return domainToolResultSchema.parse(await (options.execute ?? executeDomainTool)(input.actionSlug, input.input, context));
}

export { DOMAIN_ACTION_SLUGS };
