import { z } from 'zod';
import { authorizeAgentExecution } from '@/lib/ai/agents/access';
import { loadAgentRuntime } from '@/lib/ai/agents/runtime';
import { executeRoute, selectRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers';
import { isDomainActionSlug } from './schemas';
import { runDomainAgentTool, type RunDomainAgentToolOptions } from './run';

const property = (type: 'string' | 'boolean' | 'integer' | 'array', description: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const refs = property('array', 'One or more unambiguous keys, names, aliases, slugs, emails, or paths.', { items: { type: 'string' }, minItems: 1, maxItems: 100 });
const role = { type: 'string', enum: ['owner', 'admin', 'moderator', 'viewer'] };

export const domainToolJsonSchemas: Record<string, Record<string, unknown>> = {
  'organization.member.list': objectSchema({ role, status: { type: 'string', enum: ['active', 'inactive', 'suspended'] }, name: { type: 'string' }, email: { type: 'string' }, alias: { type: 'string' }, limit: property('integer', 'Page size, maximum 100.'), cursor: { type: 'string' }, sort: { type: 'string', enum: ['name', 'email', 'role', 'status'] } }),
  'organization.member.read': objectSchema({ members: refs }, ['members']),
  'organization.member.add': objectSchema({ member: { type: 'string' }, role }, ['member', 'role']),
  'organization.member.role.update': objectSchema({ members: refs, role }, ['members', 'role']),
  'organization.member.activate': objectSchema({ members: refs }, ['members']),
  'organization.member.suspend': objectSchema({ members: refs, reason: { type: 'string' } }, ['members']),
  'organization.member.remove': objectSchema({ members: refs, reason: { type: 'string' } }, ['members']),
  'scope.list': objectSchema({ query: { type: 'string' }, status: { type: 'string', enum: ['active', 'archived'] }, parentScopeKey: { type: ['string', 'null'] }, includeDescendants: { type: 'boolean' }, limit: { type: 'integer' }, cursor: { type: 'string' } }),
  'scope.read': objectSchema({ scopes: refs }, ['scopes']),
  'scope.create': objectSchema({ name: { type: 'string' }, description: { type: 'string' }, parentScope: { type: ['string', 'null'] }, position: { type: 'integer' } }, ['name']),
  'scope.update': objectSchema({ scope: { type: 'string' }, name: { type: 'string' }, description: { type: ['string', 'null'] } }, ['scope']),
  'scope.move': objectSchema({ scope: { type: 'string' }, parentScope: { type: ['string', 'null'] }, position: { type: 'integer' } }, ['scope']),
  'scope.archive': objectSchema({ scopes: refs, reason: { type: 'string' }, includeDescendants: { type: 'boolean' } }, ['scopes']),
  'scope.restore': objectSchema({ scopes: refs, includeDescendants: { type: 'boolean' } }, ['scopes']),
  'scope.remove': objectSchema({ scopes: refs, confirmation: { type: 'string' }, reason: { type: 'string' } }, ['scopes', 'confirmation']),
};

export const interpretDomainToolInputSchema = z.object({
  organizationKey: z.string().trim().min(1), agentKey: z.string().cuid(), principal: z.object({ kind: z.literal('member'), userOrganizationKey: z.string().cuid() }).strict(), request: z.string().trim().min(1).max(20_000),
}).strict();

export interface InterpretDomainToolOptions extends RouterDependencies, RunDomainAgentToolOptions {}

/** GPT-5.4 Mini chooses one granted domain tool and produces strict arguments; execution then crosses the local authorization boundary. */
export async function interpretAndRunDomainTool(rawInput: z.input<typeof interpretDomainToolInputSchema>, options: InterpretDomainToolOptions = {}) {
  const input = interpretDomainToolInputSchema.parse(rawInput);
  const runtime = await loadAgentRuntime(input.agentKey, options.runtimeData);
  if (runtime.organization.key !== input.organizationKey) throw new Error('agent belongs to another organization');
  await authorizeAgentExecution(runtime, input.principal, options.accessData);
  const grants = runtime.tools.flatMap((grant) => grant.actions.flatMap(({ action }) => isDomainActionSlug(action.slug) && grant.tool.slug === action.slug ? [{ grant, action }] : []));
  if (grants.length === 0) throw new Error('agent has no granted domain tools');
  const names = new Map(grants.map(({ action }) => [action.slug.replaceAll('.', '__'), action.slug]));
  const decision = await selectRoute({ mode: 'auto', organizationKey: input.organizationKey, actionSlug: 'core.reason' }, options);
  const response = await executeRoute<unknown, ChatOutput>({ decision, adapters: options.adapters, input: {
    messages: [{ role: 'user', content: input.request }],
    system: 'Choose exactly one granted tool. Never invent identifiers or permissions. Return a tool call only.',
    tools: grants.map(({ action }) => ({ name: action.slug.replaceAll('.', '__'), description: action.description, inputSchema: domainToolJsonSchemas[action.slug] ?? {} })),
  } });
  if (response.output.toolCalls.length !== 1) throw new Error(`expected exactly one domain tool call, received ${response.output.toolCalls.length}`);
  const call = response.output.toolCalls[0]!; const actionSlug = names.get(call.name);
  if (!actionSlug) throw new Error(`model selected ungranted domain tool ${call.name}`);
  const selected = grants.find(({ action }) => action.slug === actionSlug)!;
  const output = await runDomainAgentTool({ organizationKey: input.organizationKey, agentKey: input.agentKey, toolKey: selected.grant.tool.key, actionKey: selected.action.key, principal: input.principal, input: call.arguments }, options);
  return { model: { actionSlug: decision.actionSlug, modelSlug: decision.modelSlug, providerSlug: decision.providerSlug, usage: response.usage }, toolCall: { id: call.id, actionSlug, arguments: call.arguments }, output };
}
