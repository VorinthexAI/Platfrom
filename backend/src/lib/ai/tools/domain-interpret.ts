import { z } from 'zod';
import { authorizeAgentExecution } from '@/lib/ai/agents/access';
import { loadAgentRuntime } from '@/lib/ai/agents/runtime';
import { executeRoute, selectRoute, type RouterDependencies } from '@/lib/ai/router';
import type { ChatOutput } from '@/lib/ai/providers';
import { DOMAIN_ACTION_SLUGS, isDomainActionSlug } from './domain-schemas';
import { runDomainAgentTool, type RunDomainAgentToolOptions } from './domain-run';
import { archiveToolJsonSchemas } from './domain-archive-schemas';
import { momentumToolJsonSchemas } from '@/lib/ai/momentum/tool-schemas';

const property = (type: 'string' | 'boolean' | 'integer' | 'array', description: string, extra: Record<string, unknown> = {}) => ({ type, description, ...extra });
const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', additionalProperties: false, properties, ...(required.length ? { required } : {}) });
const refs = property('array', 'One or more unambiguous keys, names, aliases, slugs, emails, or paths.', { items: { type: 'string' }, minItems: 1, maxItems: 100 });
const role = { type: 'string', enum: ['owner', 'admin', 'moderator', 'viewer'] };
const artifactPath = { type: 'array', items: { type: 'string' }, maxItems: 20 };
const artifactVariable = {
  oneOf: [
    objectSchema({ kind: { const: 'literal' }, value: {} }, ['kind', 'value']),
    objectSchema({ kind: { const: 'binding' }, binding: { type: 'string' } }, ['kind', 'binding']),
    objectSchema({ kind: { const: 'context' }, value: { type: 'string', enum: ['organizationKey', 'scopeKey'] } }, ['kind', 'value']),
  ],
};
const artifactBinding = {
  oneOf: [
    objectSchema({ kind: { const: 'node' }, ref: objectSchema({ type: { type: 'string' }, key: { type: 'string' } }, ['type', 'key']), path: artifactPath }, ['kind', 'ref']),
    objectSchema({ kind: { const: 'query' }, queryId: { type: 'string' }, variables: { type: 'object', additionalProperties: artifactVariable }, path: artifactPath }, ['kind', 'queryId', 'variables']),
    objectSchema({ kind: { const: 'artifact' }, artifactKey: { type: 'string' }, path: artifactPath }, ['kind', 'artifactKey']),
  ],
};
const artifactDefinition = objectSchema({
  version: { const: 1 },
  mode: { type: 'string', enum: ['live', 'snapshot'] },
  root: { type: 'string' },
  nodes: { type: 'object', additionalProperties: objectSchema({ binding: { type: 'string' }, kind: { type: 'string', enum: ['organization', 'scope', 'member', 'agent', 'artifact', 'metric', 'event'] }, labelPath: artifactPath, statePath: artifactPath, weightPath: artifactPath, appearance: objectSchema({ shape: { type: 'string', enum: ['sphere', 'cube', 'ring', 'plane'] }, texture: { type: 'string' }, scale: { type: 'number' } }) }, ['binding', 'kind']) },
  edges: { type: 'array', maxItems: 300, items: objectSchema({ from: { type: 'string' }, to: { type: 'string' }, relation: { type: 'string' }, directed: { type: 'boolean' } }, ['from', 'to', 'relation']) },
  bindings: { type: 'object', additionalProperties: artifactBinding },
  view: objectSchema({ layout: { type: 'string', enum: ['tree', 'cluster', 'galaxy', 'timeline', 'hierarchy', 'radial', 'force', 'grid', 'flow', 'orbit', 'layered', 'manual'] }, theme: { type: 'string', enum: ['obsidian', 'chrome', 'wireframe', 'blueprint', 'neural', 'holographic', 'minimal', 'monochrome'] }, camera: { type: 'string', enum: ['perspective', 'orthographic'] }, textures: { type: 'object', additionalProperties: { type: 'string' } }, spacing: { type: 'number' }, positions: { type: 'object', additionalProperties: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 } } }, ['layout', 'theme']),
  actions: { type: 'object', additionalProperties: objectSchema({ actionId: { type: 'string' }, label: { type: 'string' }, input: { type: 'object', additionalProperties: artifactVariable } }, ['actionId', 'label']) },
}, ['version', 'mode', 'root', 'nodes', 'edges', 'bindings', 'view']);

export const domainToolJsonSchemas: Record<string, Record<string, unknown>> = {
  'artifact.create': objectSchema({ name: { type: 'string', maxLength: 160 }, definition: artifactDefinition }, ['name', 'definition']),
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
  'scope.member.list': objectSchema({ scope: { type: 'string' }, query: { type: 'string' }, status: { type: 'string', enum: ['active', 'suspended'] }, role, source: { type: 'string', enum: ['direct', 'inherited'] }, limit: { type: 'integer' }, cursor: { type: 'string' } }, ['scope']),
  'scope.member.read': objectSchema({ scope: { type: 'string' }, members: refs }, ['scope', 'members']),
  'scope.member.add': objectSchema({ scope: { type: 'string' }, members: refs, role }, ['scope', 'members', 'role']),
  'scope.member.role.update': objectSchema({ scope: { type: 'string' }, members: refs, role }, ['scope', 'members', 'role']),
  'scope.member.activate': objectSchema({ scope: { type: 'string' }, members: refs }, ['scope', 'members']),
  'scope.member.suspend': objectSchema({ scope: { type: 'string' }, members: refs, reason: { type: 'string' } }, ['scope', 'members']),
  'scope.member.remove': objectSchema({ scope: { type: 'string' }, members: refs, reason: { type: 'string' } }, ['scope', 'members']),
  'scope.agent.list': objectSchema({ scope: { type: 'string' }, query: { type: 'string' }, status: { type: 'string', enum: ['active', 'archived'] }, minimumAccessRole: role, sort: { type: 'string', enum: ['position', 'name', 'createdAt'] }, limit: { type: 'integer' }, cursor: { type: 'string' } }, ['scope']),
  'scope.agent.read': objectSchema({ scope: { type: 'string' }, agents: refs }, ['scope', 'agents']),
  'scope.agent.add': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, position: { type: 'integer' } }, ['scope', 'agent']),
  'scope.agent.move': objectSchema({ agent: { type: 'string' }, fromScope: { type: 'string' }, toScope: { type: 'string' }, scope: { type: 'string' }, position: { type: 'integer' } }, ['agent']),
  'scope.agent.archive': objectSchema({ scope: { type: 'string' }, agents: refs, reason: { type: 'string' } }, ['scope', 'agents']),
  'scope.agent.restore': objectSchema({ scope: { type: 'string' }, agents: refs }, ['scope', 'agents']),
  'scope.agent.remove': objectSchema({ scope: { type: 'string' }, agents: refs, reason: { type: 'string' } }, ['scope', 'agents']),
  'scope.agent.access-threshold.update': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, minimumAccessRole: role }, ['scope', 'agent', 'minimumAccessRole']),
  'agent.member.list': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, source: { type: 'string', enum: ['inherited', 'explicit'] }, query: { type: 'string' }, limit: { type: 'integer' }, cursor: { type: 'string' } }, ['scope', 'agent']),
  'agent.member.read': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, members: refs }, ['scope', 'agent', 'members']),
  'agent.member.grant': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, members: refs }, ['scope', 'agent', 'members']),
  'agent.member.revoke': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, members: refs }, ['scope', 'agent', 'members']),
  'agent.member.sync': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, dryRun: { type: 'boolean' } }, ['scope', 'agent']),
  'organization.provider.list': objectSchema({ status: { type: 'string', enum: ['enabled', 'disabled'] }, query: { type: 'string' } }),
  'organization.provider.read': objectSchema({ providers: refs }, ['providers']),
  'organization.provider.enable': objectSchema({ provider: { type: 'string' } }, ['provider']),
  'organization.provider.disable': objectSchema({ provider: { type: 'string' }, reason: { type: 'string' } }, ['provider']),
  'organization.provider.test': objectSchema({ provider: { type: 'string' }, mode: { type: 'string', enum: ['connectivity', 'routing', 'minimal-inference'] } }, ['provider']),
  'organization.read': objectSchema({ organization: { type: 'string' } }),
  'organization.update': objectSchema({ name: { type: 'string' }, alias: { type: ['string', 'null'] }, description: { type: ['string', 'null'] } }),
  'organization.archive': objectSchema({ reason: { type: 'string' }, confirmation: { type: 'string' } }, ['confirmation']),
  'organization.restore': objectSchema({ confirmation: { type: 'string' } }),
  'access.organization.evaluate': objectSchema({ organization: { type: 'string' }, member: { type: 'string' }, action: { type: 'string' } }),
  'access.scope.evaluate': objectSchema({ scope: { type: 'string' }, member: { type: 'string' }, action: { type: 'string' } }, ['scope']),
  'access.agent.evaluate': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, member: { type: 'string' }, action: { type: 'string', enum: ['read', 'run', 'delegate', 'manage'] } }, ['scope', 'agent']),
  'access.organization.explain': objectSchema({ organization: { type: 'string' }, member: { type: 'string' }, action: { type: 'string' } }),
  'access.scope.explain': objectSchema({ scope: { type: 'string' }, member: { type: 'string' }, action: { type: 'string' } }, ['scope']),
  'access.agent.explain': objectSchema({ scope: { type: 'string' }, agent: { type: 'string' }, member: { type: 'string' }, action: { type: 'string', enum: ['read', 'run', 'delegate', 'manage'] } }, ['scope', 'agent']),
  ...archiveToolJsonSchemas,
  ...momentumToolJsonSchemas,
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
