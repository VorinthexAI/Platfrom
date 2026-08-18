import { z } from 'zod';
import { authorizeAgentExecution } from '@/lib/ai/agents/access';
import { loadAgentRuntime } from '@/lib/ai/agents/runtime';
import { executeRoute, selectRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers';
import { DOMAIN_ACTION_SLUGS, isDomainActionSlug } from './domain-schemas';
import { runDomainAgentTool, type RunDomainAgentToolOptions } from './domain-run';
import { contentToolJsonSchemas } from './domain-content-schemas';

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });

export const domainToolJsonSchemas: Record<string, Record<string, unknown>> = {
  'email.thread.list': objectSchema({ filter: { type: 'string', enum: ['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite'] }, search: { type: 'string', maxLength: 200 } }),
  'email.thread.read': objectSchema({ threadKey: { type: 'string' } }, ['threadKey']),
  'email.reply.draft': objectSchema({ threadKey: { type: 'string' }, tone: { type: 'string', enum: ['concise', 'warm', 'formal', 'direct'] }, instruction: { type: 'string', maxLength: 1000 }, profileKey: { type: 'string' } }, ['threadKey']),
  ...contentToolJsonSchemas,
};

export const interpretDomainToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1), agentKey: z.string().cuid(), principal: z.object({ kind: z.literal('member'), userOrganizationKey: z.string().cuid() }).strict(), request: z.string().trim().min(1).max(20_000),
}).strict();

export interface InterpretDomainToolOptions extends RouterDependencies, RunDomainAgentToolOptions {}

/** GPT-5.4 Mini chooses one direct domain action and produces strict arguments. */
export async function interpretAndRunDomainTool(rawInput: z.input<typeof interpretDomainToolInputSchema>, options: InterpretDomainToolOptions = {}) {
  const input = interpretDomainToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey) throw new Error('agent belongs to another organization');
  await authorizeAgentExecution(runtime, input.principal, options.accessData);
  const actions = DOMAIN_ACTION_SLUGS;
  const names = new Map(actions.map((action) => [action.replaceAll('.', '__'), action]));
  const decision = await selectRoute({ mode: 'auto', organizationKey: input.organizationKey, actionSlug: 'reason' }, options);
  const response = await executeRoute<unknown, ChatOutput>({ decision, adapters: options.adapters, input: {
    messages: [{ role: 'user', content: input.request }],
    system: 'Choose exactly one direct domain action. Never invent identifiers or permissions. Return a tool call only.',
    tools: actions.map((action) => ({ name: action.replaceAll('.', '__'), description: action, inputSchema: domainToolJsonSchemas[action] })),
  } });
  if (response.output.toolCalls.length !== 1) throw new Error(`expected exactly one domain tool call, received ${response.output.toolCalls.length}`);
  const call = response.output.toolCalls[0]!; const actionSlug = names.get(call.name);
  if (!actionSlug) throw new Error(`model selected unknown domain action ${call.name}`);
  const output = await runDomainAgentTool({ organizationKey: input.organizationKey, agentKey: input.agentKey, actionSlug, principal: input.principal, input: call.arguments }, options);
  return { model: { actionSlug: decision.actionSlug, modelSlug: decision.modelSlug, providerSlug: decision.providerSlug, usage: response.usage }, toolCall: { id: call.id, actionSlug, arguments: call.arguments }, output };
}
