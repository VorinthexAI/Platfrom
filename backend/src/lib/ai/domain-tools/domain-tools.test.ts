import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { skillSchema } from '@/lib/db/skills.node';
import { actionSchema } from '@/lib/db/actions.node';
import { toolSchema } from '@/lib/db/tools.node';
import { agentSkillSchema } from '@/lib/db/agent-skills.node';
import { agentToolSchema } from '@/lib/db/agent-tools.node';
import { toolActionSchema } from '@/lib/db/tool-actions.node';
import { modelSchema } from '@/lib/db/models.node';
import { providerSchema } from '@/lib/db/providers.node';
import { modelActionSchema } from '@/lib/db/model-actions.node';
import { modelProviderSchema } from '@/lib/db/model-providers.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema } from '@/lib/db/agent-members.node';
import { tokenUsage } from '@/lib/ai/shared';
import type { RuntimeEventInput } from '@/platform/events';
import { DOMAIN_ACTION_SLUGS, domainToolInputSchemas, interpretAndRunDomainTool, runDomainAgentTool } from '.';

const now = '2026-07-18T00:00:00.000Z';

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 1 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: membership.key, role: 'owner' });
  const agent = agentSchema.parse({ key: newId(), slug: 'steward', name: 'Steward', title: 'Steward', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'organization-steward', name: 'Organization Steward', title: 'Steward', definition: 'Manage authorized organization resources.' });
  const action = actionSchema.parse({ key: newId(), slug: 'scope.list', name: 'List Scopes', description: 'List', objective: 'List', inputDescription: 'Filters', outputDescription: 'Scopes', handlerKey: 'scope.list' });
  const tool = toolSchema.parse({ key: newId(), slug: 'scope.list', name: 'List Scopes', description: 'List scopes' });
  const agentSkill = agentSkillSchema.parse({ key: newId(), agentKey: agent.key, skillKey: skill.key, priority: 100 });
  const agentTool = agentToolSchema.parse({ key: newId(), agentKey: agent.key, toolKey: tool.key });
  const toolAction = toolActionSchema.parse({ key: newId(), toolKey: tool.key, actionKey: action.key, priority: 100, enabled: true });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, position: 1, minimumAccessRole: 'owner', createdAt: now, updatedAt: now });
  const agentMember = agentMemberSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey: membership.key, source: 'inherited', createdAt: now });
  const runtimeData = {
    async getAgent(key: string) { return key === agent.key ? agent : null; }, async getScope(key: string) { return key === scope.key ? scope : null; }, async getOrganization(key: string) { return key === organization.key ? organization : null; },
    async listAgentSkills() { return [agentSkill]; }, async getSkill() { return skill; }, async listAgentTools() { return [agentTool]; }, async getTool() { return tool; }, async listToolActions() { return [toolAction]; }, async getAction() { return action; },
  };
  const accessData = { async getUserOrganization() { return membership; }, async getUser() { return user; }, async listScopeMembers() { return [scopeMember]; }, async getScopeAgent() { return scopeAgent; }, async listAgentMembers() { return [agentMember]; } };
  return { organization, scope, user, membership, agent, action, tool, runtimeData, accessData };
}

describe('domain tool schemas', () => {
  test('registers strict input schemas for every local domain action', () => {
    expect(DOMAIN_ACTION_SLUGS).toHaveLength(50);
    expect(domainToolInputSchemas['scope.list'].parse({})).toEqual({ includeDescendants: false, limit: 50 });
    expect(() => domainToolInputSchemas['scope.list'].parse({ unexpected: true })).toThrow();
    expect(() => domainToolInputSchemas['organization.member.add'].parse({ member: 'user@example.com', role: 'member' })).toThrow();
    expect(domainToolInputSchemas['scope.member.add'].parse({ scope: 'Finance', members: ['alice@example.com'], role: 'moderator' })).toMatchObject({ role: 'moderator' });
    for (const schema of Object.values(domainToolInputSchemas)) expect(schema.safeParse({ unexpected: true }).success).toBe(false);
  });
});

describe('local domain tool boundary', () => {
  test('authorizes persisted grants and executes locally without a model route', async () => {
    const f = fixture(); const events: RuntimeEventInput[] = []; let receivedContext: unknown;
    const output = await runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, toolKey: f.tool.key, actionKey: f.action.key, principal: { kind: 'member', userOrganizationKey: f.membership.key }, input: { query: 'ops' } }, {
      runtimeData: f.runtimeData, accessData: f.accessData, events: async (event) => { events.push(event); },
      execute: async (action, input, context) => { receivedContext = context; return { action, status: 'completed', data: { input } }; },
    });
    expect(output).toEqual({ action: 'scope.list', status: 'completed', data: { input: { query: 'ops' } } });
    expect(receivedContext).toMatchObject({ organizationKey: f.organization.key, runtimeScopeKey: f.scope.key, principal: { kind: 'member' } });
    expect(events.map(({ slug }) => slug)).toEqual(['tool.called', 'tool.completed']);
  });

  test('rejects an action that is not linked to the granted tool', async () => {
    const f = fixture();
    await expect(runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, toolKey: f.tool.key, actionKey: newId(), principal: { kind: 'member', userOrganizationKey: f.membership.key }, input: {} }, { runtimeData: f.runtimeData, accessData: f.accessData, events: async () => {} })).rejects.toThrow('not granted');
  });

  test('uses core.reason on Mini to interpret, then executes the selected tool locally', async () => {
    const f = fixture();
    const reason = actionSchema.parse({ key: newId(), slug: 'core.reason', name: 'Reason', description: 'Interpret tool intent', objective: 'Choose a tool', inputDescription: 'Request', outputDescription: 'Tool call', handlerKey: 'core.reason' });
    const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-mini', name: 'Mini', description: 'Reasoning model', supportedUseCases: 'Tool selection' });
    const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai' });
    const route = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: reason.key, priority: 100 });
    const providerRoute = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-mini' });
    const output = await interpretAndRunDomainTool({ organizationKey: f.organization.key, agentKey: f.agent.key, principal: { kind: 'member', userOrganizationKey: f.membership.key }, request: 'List scopes matching operations' }, {
      runtimeData: f.runtimeData, accessData: f.accessData, events: async () => {},
      data: { async getActionBySlug(slug) { return slug === 'core.reason' ? reason : null; }, async getModelBySlug(slug) { return slug === model.slug ? model : null; }, async getModelByKey() { return model; }, async getProviderBySlug() { return provider; }, async getProviderByKey() { return provider; }, async listModelActions() { return [route]; }, async listModelProviders() { return [providerRoute]; }, async listOrganizationProviderKeys() { return [provider.key]; } },
      adapters: { openai: { id: 'openai', name: 'OpenAI', async execute<TInput, TOutput>() { return { output: { text: '', stopReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'scope__list', arguments: { query: 'operations' } }] } as TOutput, usage: tokenUsage(10, 4), providerId: 'openai' as const, modelId: model.slug, externalModelId: 'gpt-5.4-mini' }; } } },
      execute: async (action, input) => ({ action, status: 'completed', data: input }),
    });
    expect(output.model).toMatchObject({ actionSlug: 'core.reason', modelSlug: 'openai.gpt-5.4-mini', providerSlug: 'openai' });
    expect(output.output).toEqual({ action: 'scope.list', status: 'completed', data: { query: 'operations' } });
  });
});
