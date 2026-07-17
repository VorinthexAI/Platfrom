import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { agentSchema } from '@/lib/db/agents.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema, type AgentMember } from '@/lib/db/agent-members.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import type { AgentRuntimeContext } from './runtime';
import { AgentExecutionAccessError, authorizeAgentExecution, type ExecutionAccessDataSource } from './access';

const now = '2026-07-16T00:00:00.000Z';

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'platform', name: 'Platform', description: 'Platform scope', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'member@example.com', emailHash: 'hash', createdAt: now, updatedAt: now });
  const userOrganization = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: userOrganization.key, role: 'moderator' });
  const agent = agentSchema.parse({ key: newId(), slug: 'forge', name: 'Forge', title: 'Backend Developer', scopeKey: scope.key });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), scopeKey: scope.key, agentKey: agent.key, minimumAccessRole: 'moderator', createdAt: now, updatedAt: now });
  const inheritedGrant = agentMemberSchema.parse({ key: newId(), agentKey: agent.key, userOrganizationKey: userOrganization.key, source: 'inherited', scopeAgentKey: scopeAgent.key, createdAt: now });
  const grants: AgentMember[] = [inheritedGrant];
  const runtime = { organization, scope, agent } as AgentRuntimeContext;
  const data: ExecutionAccessDataSource = {
    async getUserOrganization(key) { return key === userOrganization.key ? userOrganization : null; },
    async getUser(key) { return key === user.key ? user : null; },
    async listScopeMembers() { return [scopeMember]; },
    async getScopeAgent(scopeKey, agentKey) { return scopeKey === scope.key && agentKey === agent.key ? scopeAgent : null; },
    async listGrants(agentKey, membershipKey) { return agentKey === agent.key && membershipKey === userOrganization.key ? grants : []; },
  };
  return { runtime, data, user, userOrganization, scopeMember, agent, scopeAgent, inheritedGrant, grants };
}

describe('agent execution access', () => {
  test('resolves an active member holding a valid inherited grant', async () => {
    const f = fixture();
    const principal = await authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, f.data);
    expect(principal).toMatchObject({
      kind: 'member',
      user: { key: f.user.key },
      userOrganization: { key: f.userOrganization.key },
      scopeMember: { key: f.scopeMember.key, role: 'moderator' },
      effectiveRole: 'moderator',
      scopeAgentKey: f.scopeAgent.key,
      grantSources: ['inherited'],
    });
  });

  test('rejects suspended, foreign-organization, and unscoped memberships', async () => {
    const suspended = fixture();
    const suspendedLink = userOrganizationSchema.parse({ ...suspended.userOrganization, status: 'suspended' });
    await expect(authorizeAgentExecution(suspended.runtime, { kind: 'member', userOrganizationKey: suspendedLink.key }, { ...suspended.data, async getUserOrganization() { return suspendedLink; } })).rejects.toBeInstanceOf(AgentExecutionAccessError);

    const foreign = fixture();
    const foreignLink = userOrganizationSchema.parse({ ...foreign.userOrganization, organizationId: newId() });
    await expect(authorizeAgentExecution(foreign.runtime, { kind: 'member', userOrganizationKey: foreignLink.key }, { ...foreign.data, async getUserOrganization() { return foreignLink; } })).rejects.toThrow('another organization');

    const unscoped = fixture();
    await expect(authorizeAgentExecution(unscoped.runtime, { kind: 'member', userOrganizationKey: unscoped.userOrganization.key }, { ...unscoped.data, async listScopeMembers() { return []; } })).rejects.toThrow('SCOPE_ACCESS_DENIED');
  });

  test('scope membership alone is not enough — a grant is required', async () => {
    const f = fixture();
    await expect(authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, { ...f.data, async listGrants() { return []; } })).rejects.toThrow('AGENT_ACCESS_DENIED');
  });

  test('an inherited grant stops working the moment the role drops below the threshold', async () => {
    const f = fixture();
    const demoted = scopeMemberSchema.parse({ ...f.scopeMember, role: 'viewer' });
    await expect(authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, { ...f.data, async listScopeMembers() { return [demoted]; } })).rejects.toThrow('AGENT_ACCESS_DENIED');
  });

  test('an explicit grant survives demotion below the inherited threshold', async () => {
    const f = fixture();
    const demoted = scopeMemberSchema.parse({ ...f.scopeMember, role: 'viewer' });
    const explicitGrant = agentMemberSchema.parse({ key: newId(), agentKey: f.agent.key, userOrganizationKey: f.userOrganization.key, source: 'explicit', scopeAgentKey: f.scopeAgent.key, createdByUserOrganizationKey: newId(), createdAt: now });
    const principal = await authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, {
      ...f.data,
      async listScopeMembers() { return [demoted]; },
      async listGrants() { return [f.inheritedGrant, explicitGrant]; },
    });
    expect(principal).toMatchObject({ kind: 'member', effectiveRole: 'viewer', grantSources: ['explicit'] });
  });

  test('organization owners and admins get scope access without a scopeMembers row, but still need a grant', async () => {
    const f = fixture();
    const ownerLink = userOrganizationSchema.parse({ ...f.userOrganization, orgRole: 'owner' });
    const data: ExecutionAccessDataSource = {
      ...f.data,
      async getUserOrganization() { return ownerLink; },
      async listScopeMembers() { return []; },
    };
    const principal = await authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: ownerLink.key }, data);
    expect(principal).toMatchObject({ kind: 'member', effectiveRole: 'owner', scopeMember: null, grantSources: ['inherited'] });

    await expect(authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: ownerLink.key }, { ...data, async listGrants() { return []; } })).rejects.toThrow('AGENT_ACCESS_DENIED');
  });

  test('an agent unlinked from the scope cannot be executed even with stale grants', async () => {
    const f = fixture();
    await expect(authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, { ...f.data, async getScopeAgent() { return null; } })).rejects.toThrow('is not linked to scope');
  });

  test('delegation is denied when the target agent forbids it', async () => {
    const f = fixture();
    const genesisAgent = agentSchema.parse({ ...f.agent, slug: 'genesis' });
    const runtime = { ...f.runtime, agent: genesisAgent } as AgentRuntimeContext;
    await expect(authorizeAgentExecution(runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key, delegatedViaAgentKey: newId() }, f.data)).rejects.toThrow('AGENT_ACCESS_DENIED');
  });

  test('allows an explicit trusted system principal without user data', async () => {
    const f = fixture();
    expect(await authorizeAgentExecution(f.runtime, { kind: 'system' }, f.data)).toEqual({ kind: 'system' });
  });
});
