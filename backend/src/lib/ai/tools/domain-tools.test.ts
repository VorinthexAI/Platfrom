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
import { DOMAIN_ACTION_SLUGS, domainToolInputSchemas, interpretAndRunDomainTool, runDomainAgentTool } from '.';

const now = '2026-07-18T00:00:00.000Z';

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'operations', name: 'Operations', summary: 'Operations', description: 'Operations', position: 1 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: membership.key, role: 'owner' });
  const agent = agentSchema.parse({ key: newId(), slug: 'organization-operator', name: 'Organization Operator', title: 'Operator', scopeKey: scope.key });
  const skill = skillSchema.parse({ key: newId(), slug: 'organization-operations', name: 'Organization Operations', title: 'Operator', definition: 'Manage authorized organization resources.' });
  const action = actionSchema.parse({ key: newId(), slug: 'scope.document.search', name: 'Search Documents', description: 'Search', objective: 'Search', inputDescription: 'Query', outputDescription: 'Documents', handlerKey: 'scope.document.search' });
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
    expect(DOMAIN_ACTION_SLUGS).toHaveLength(11);
    expect(domainToolInputSchemas['email.thread.read'].parse({ threadKey: newId() })).toHaveProperty('threadKey');
    expect(() => domainToolInputSchemas['email.thread.read'].parse({ threadKey: newId(), unexpected: true })).toThrow();
    expect(domainToolInputSchemas).not.toHaveProperty('scope.list');
    expect(domainToolInputSchemas).not.toHaveProperty('organization.member.add');
    for (const schema of Object.values(domainToolInputSchemas)) expect(schema.safeParse({ unexpected: true }).success).toBe(false);
  });
});

describe('local domain tool boundary', () => {
  test('authorizes a direct action and executes locally without a model route', async () => {
    const f = fixture(); let receivedContext: unknown;
    const input = { threadKey: newId() };
    const output = await runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, actionSlug: 'email.thread.read', principal: { kind: 'member', userOrganizationKey: f.membership.key }, input }, {
      runtimeData: f.runtimeData, accessData: f.accessData,
      execute: async (action, input, context) => { receivedContext = context; return { action, status: 'completed', data: { input } }; },
    });
    expect(output).toEqual({ action: 'email.thread.read', status: 'completed', data: { input } });
    expect(receivedContext).toMatchObject({ organizationKey: f.organization.key, runtimeScopeKey: f.scope.key, principal: { kind: 'member' } });
  });

  test('rejects an unknown direct action', async () => {
    const f = fixture();
    await expect(runDomainAgentTool({ organizationKey: f.organization.key, agentKey: f.agent.key, actionSlug: 'unknown.action', principal: { kind: 'member', userOrganizationKey: f.membership.key }, input: {} }, { runtimeData: f.runtimeData, accessData: f.accessData })).rejects.toThrow('unknown domain action');
  });

  test('uses reason on Mini to interpret, then executes the selected action locally', async () => {
    const f = fixture();
    const reason = actionSchema.parse({ key: newId(), slug: 'reason', name: 'Reason', description: 'Interpret tool intent', objective: 'Choose a tool', inputDescription: 'Request', outputDescription: 'Tool call', handlerKey: 'reason' });
    const model = modelSchema.parse({ key: newId(), slug: 'openai.gpt-5.4-mini', name: 'Mini', description: 'Reasoning model', supportedUseCases: 'Tool selection' });
    const provider = providerSchema.parse({ key: newId(), slug: 'openai', name: 'OpenAI', description: 'Provider', supportedUseCases: 'AI', handlerKey: 'openai' });
    const route = modelActionSchema.parse({ key: newId(), modelKey: model.key, actionKey: reason.key, priority: 100 });
    const providerRoute = modelProviderSchema.parse({ key: newId(), modelKey: model.key, providerKey: provider.key, providerModelId: 'gpt-5.4-mini' });
    const threadKey = newId();
    const output = await interpretAndRunDomainTool({ organizationKey: f.organization.key, agentKey: f.agent.key, principal: { kind: 'member', userOrganizationKey: f.membership.key }, request: 'Read this email thread' }, {
      runtimeData: f.runtimeData, accessData: f.accessData,
      data: { async getActionBySlug(slug) { return slug === 'reason' ? reason : null; }, async getModelBySlug(slug) { return slug === model.slug ? model : null; }, async getModelByKey() { return model; }, async getProviderBySlug() { return provider; }, async getProviderByKey() { return provider; }, async listModelActions() { return [route]; }, async listModelProviders() { return [providerRoute]; }, async listOrganizationProviderKeys() { return [provider.key]; } },
      adapters: { openai: { id: 'openai', name: 'OpenAI', async execute<TInput, TOutput>() { return { output: { text: '', stopReason: 'tool_calls', toolCalls: [{ id: 'call-1', name: 'email__thread__read', arguments: { threadKey } }] } as TOutput, usage: tokenUsage(10, 4), providerId: 'openai' as const, modelId: model.slug, externalModelId: 'gpt-5.4-mini' }; } } },
      execute: async (action, input) => ({ action, status: 'completed', data: input }),
    });
    expect(output.model).toMatchObject({ actionSlug: 'reason', modelSlug: 'openai.gpt-5.4-mini', providerSlug: 'openai' });
    expect(output.output).toEqual({ action: 'email.thread.read', status: 'completed', data: { threadKey } });
  });
});
