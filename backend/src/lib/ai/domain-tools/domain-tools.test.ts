import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { actionSchema } from '@/lib/db/actions.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { modelSchema } from '@/lib/db/models.node';
import { providerSchema } from '@/lib/db/providers.node';
import { modelActionSchema } from '@/lib/db/model-actions.node';
import { modelProviderSchema } from '@/lib/db/model-providers.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema } from '@/lib/db/agent-members.node';
import { tokenUsage } from '@/lib/ai/shared';
import type { RuntimeEventInput } from '@/platform/events';
import { artifactSchema } from '@/lib/artifacts/schema';
import { DOMAIN_ACTION_SLUGS, domainToolInputSchemas, domainToolJsonSchemas, executeDomainTool, interpretAndRunDomainTool, runDomainAgentTool } from '.';

const now = '2026-07-18T00:00:00.000Z';
const organizationArtifactDefinition = {
  version: 1 as const,
  mode: 'live' as const,
  root: 'organization',
  nodes: { organization: { binding: 'organizationCurrent', kind: 'organization' as const } },
  edges: [],
  bindings: {
    organizationCurrent: {
      kind: 'query' as const,
      queryId: 'organization.current',
      variables: { organizationKey: { kind: 'context' as const, value: 'organizationKey' as const } },
    },
  },
  view: { layout: 'tree' as const, theme: 'obsidian' as const },
};

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 1 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: membership.key, role: 'owner' });
  const agent = agentSchema.parse({ key: newId(), slug: 'organization-operator', name: 'Organization Operator', title: 'Operator', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'organization-operations', name: 'Organization Operations', title: 'Operator', definition: 'Manage authorized organization resources.' });
  const action = actionSchema.parse({ key: newId(), slug: 'scope.list', name: 'List Scopes', description: 'List', objective: 'List', inputDescription: 'Filters', outputDescription: 'Scopes', handlerKey: 'scope.list' });
  const agentSkill = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, position: 1, minimumAccessRole: 'owner', createdAt: now, updatedAt: now });
  const agentMember = agentMemberSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey: membership.key, source: 'inherited', createdAt: now });
  const runtimeData = {
    async getAgent(key: string) { return key === agent.key ? agent : null; }, async getScope(key: string) { return key === scope.key ? scope : null; }, async getOrganization(key: string) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkill]; }, async getSkill() { return skill; },
  };
  const accessData = { async getUserOrganization() { return membership; }, async getUser() { return user; }, async listScopeMembers() { return [scopeMember]; }, async getScopeAgent() { return scopeAgent; }, async listAgentMembers() { return [agentMember]; } };
  return { organization, scope, user, membership, agent, action, runtimeData, accessData };
}

describe('domain tool schemas', () => {
  test('registers strict input schemas for every local domain action', () => {
    expect(DOMAIN_ACTION_SLUGS).toHaveLength(99);
    expect(domainToolJsonSchemas['artifact.create']).toMatchObject({ type: 'object', required: ['name', 'definition'], properties: { definition: { type: 'object' } } });
    expect(domainToolInputSchemas['artifact.create'].parse({ name: 'Organization', definition: organizationArtifactDefinition })).toMatchObject({ name: 'Organization', definition: { root: 'organization' } });
    expect(() => domainToolInputSchemas['artifact.create'].parse({ name: 'Organization', definition: organizationArtifactDefinition, organizationKey: newId() })).toThrow();
    expect(domainToolInputSchemas['scope.list'].parse({})).toEqual({ includeDescendants: false, limit: 50 });
    expect(() => domainToolInputSchemas['scope.list'].parse({ unexpected: true })).toThrow();
    expect(() => domainToolInputSchemas['organization.member.add'].parse({ member: 'user@example.com', role: 'member' })).toThrow();
    expect(domainToolInputSchemas['scope.member.add'].parse({ scope: 'Finance', members: ['alice@example.com'], role: 'moderator' })).toMatchObject({ role: 'moderator' });
    for (const schema of Object.values(domainToolInputSchemas)) expect(schema.safeParse({ unexpected: true }).success).toBe(false);
  });
});

describe('local domain tool boundary', () => {
  test('creates a semantic artifact in the authenticated runtime scope without granting an agent', async () => {
    const f = fixture(); const runtimeEvents: RuntimeEventInput[] = []; const domainEvents: Array<{ action: string; data: Record<string, unknown> }> = []; let receivedInput: unknown = null;
    const artifactKey = newId();
    const output = await executeDomainTool('artifact.create', { name: 'Organization', definition: organizationArtifactDefinition }, {
      organizationKey: f.organization.key,
      runtimeScopeKey: f.scope.key,
      principal: { kind: 'member', user: f.user, userOrganization: f.membership, scopeMember: null },
    }, {
      artifacts: {
        async create(input) {
          receivedInput = input;
          return artifactSchema.parse({ key: artifactKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey, name: input.name, definition: input.definition, schemaVersion: 1, snapshotKey: null, createdByAgentRunKey: null, createdByUserOrganizationKey: input.createdByUserOrganizationKey, createdAt: now, updatedAt: now });
        },
      },
      domainEvents: async (_context, action, data) => { domainEvents.push({ action, data }); },
      runtimeEvents: async (event) => { runtimeEvents.push(event); },
    });

    expect(receivedInput).toMatchObject({ organizationKey: f.organization.key, scopeKey: f.scope.key, organizationWide: true, allowedScopeKeys: [f.scope.key], createdByUserOrganizationKey: f.membership.key });
    expect(output).toEqual({ action: 'artifact.create', status: 'completed', data: { artifact: { key: artifactKey, name: 'Organization', mode: 'live', root: 'organization', layout: 'tree', theme: 'obsidian' } } });
    expect(domainEvents).toEqual([{ action: 'artifact.create', data: { artifactKey } }]);
    expect(runtimeEvents).toEqual([{ scopeId: f.scope.key, userId: f.user.key, slug: 'artifact.created', data: { nodeType: 'artifacts', nodeKey: artifactKey } }]);
  });

  test('authorizes a direct action and executes locally without a model route', async () => {
    const f = fixture(); const events: RuntimeEventInput[] = []; let receivedContext: unknown;
    const output = await runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, actionSlug: 'scope.list', principal: { kind: 'member', userOrganizationKey: f.membership.key }, input: { query: 'ops' } }, {
      runtimeData: f.runtimeData, accessData: f.accessData, events: async (event) => { events.push(event); },
      execute: async (action, input, context) => { receivedContext = context; return { action, status: 'completed', data: { input } }; },
    });
    expect(output).toEqual({ action: 'scope.list', status: 'completed', data: { input: { query: 'ops' } } });
    expect(receivedContext).toMatchObject({ organizationKey: f.organization.key, runtimeScopeKey: f.scope.key, principal: { kind: 'member' } });
    expect(events).toEqual([]);
  });

  test('rejects an unknown direct action', async () => {
    const f = fixture();
    await expect(runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, actionSlug: 'unknown.action', principal: { kind: 'member', userOrganizationKey: f.membership.key }, input: {} }, { runtimeData: f.runtimeData, accessData: f.accessData, events: async () => {} })).rejects.toThrow('unknown domain action');
  });

  test('uses reason on Mini to interpret, then executes the selected action locally', async () => {
    const f = fixture();
    const reason = actionSchema.parse({ key: newId(), slug: 'reason', name: 'Reason', description: 'Interpret tool intent', objective: 'Choose a tool', inputDescription: 'Request', outputDescription: 'Tool call', handlerKey: 'reason' });
    const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-mini', name: 'Mini', description: 'Reasoning model', supportedUseCases: 'Tool selection' });
    const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai' });
    const route = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: reason.key, priority: 100 });
    const providerRoute = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-mini' });
    const output = await interpretAndRunDomainTool({ organizationKey: f.organization.key, agentKey: f.agent.key, principal: { kind: 'member', userOrganizationKey: f.membership.key }, request: 'List scopes matching operations' }, {
      runtimeData: f.runtimeData, accessData: f.accessData, events: async () => {},
      data: { async getActionBySlug(slug) { return slug === 'reason' ? reason : null; }, async getModelBySlug(slug) { return slug === model.slug ? model : null; }, async getModelByKey() { return model; }, async getProviderBySlug() { return provider; }, async getProviderByKey() { return provider; }, async listModelActions() { return [route]; }, async listModelProviders() { return [providerRoute]; }, async listOrganizationProviderKeys() { return [provider.key]; } },
      adapters: { openai: { id: 'openai', name: 'OpenAI', async execute<TInput, TOutput>() { return { output: { text: '', stopReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'scope__list', arguments: { query: 'operations' } }] } as TOutput, usage: tokenUsage(10, 4), providerId: 'openai' as const, modelId: model.slug, externalModelId: 'gpt-5.4-mini' }; } } },
      execute: async (action, input) => ({ action, status: 'completed', data: input }),
    });
    expect(output.model).toMatchObject({ actionSlug: 'reason', modelSlug: 'openai.gpt-5.4-mini', providerSlug: 'openai' });
    expect(output.output).toEqual({ action: 'scope.list', status: 'completed', data: { query: 'operations' } });
  });
});
