import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import { agentSchema } from '@/lib/db/agents.node';
import { scopeAgentSchema } from '@/lib/db/scope-agents.node';
import { agentMemberSchema } from '@/lib/db/agent-members.node';
import type { AgentRuntimeContext } from './runtime';
import { AgentExecutionAccessError, authorizeAgentExecution, type ExecutionAccessDataSource } from './access';

const now = '2026-07-16T00:00:00.000Z';

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'platform', name: 'Platform', summary: 'Platform scope', description: 'Platform scope', position: 2 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'member@example.com', emailHash: 'hash', createdAt: now, updatedAt: now });
  const userOrganization = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: userOrganization.key, role: 'moderator' });
  const agent = agentSchema.parse({ key: newId(), slug: 'forge', name: 'Forge', title: 'Developer', scopeKey: scope.key });
  const scopeAgent = scopeAgentSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, position: 1, minimumAccessRole: 'moderator', createdAt: now, updatedAt: now });
  const agentMember = agentMemberSchema.parse({ key: newId(), organizationKey: organization.key, scopeKey: scope.key, agentKey: agent.key, scopeAgentKey: scopeAgent.key, userOrganizationKey: userOrganization.key, source: 'inherited', createdAt: now });
  const runtime = { organization, scope, agent } as AgentRuntimeContext;
  const data: ExecutionAccessDataSource = {
    async getUserOrganization(key) { return key === userOrganization.key ? userOrganization : null; },
    async getUser(key) { return key === user.key ? user : null; },
    async listScopeMembers() { return [scopeMember]; },
    async getScopeAgent() { return scopeAgent; },
    async listAgentMembers() { return [agentMember]; },
  };
  return { runtime, data, user, userOrganization, scopeMember, scopeAgent, agentMember };
}

describe('agent execution access', () => {
  test('resolves an active member through userOrganizations and scopeMembers', async () => {
    const f = fixture();
    const principal = await authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, f.data);
    expect(principal).toMatchObject({ kind: 'member', user: { key: f.user.key }, userOrganization: { key: f.userOrganization.key }, scopeMember: { key: f.scopeMember.key, role: 'moderator' } });
  });

  test('rejects suspended, foreign-organization, and unscoped memberships', async () => {
    const suspended = fixture();
    const suspendedLink = userOrganizationSchema.parse({ ...suspended.userOrganization, status: 'suspended' });
    await expect(authorizeAgentExecution(suspended.runtime, { kind: 'member', userOrganizationKey: suspendedLink.key }, { ...suspended.data, async getUserOrganization() { return suspendedLink; } })).rejects.toBeInstanceOf(AgentExecutionAccessError);

    const foreign = fixture();
    const foreignLink = userOrganizationSchema.parse({ ...foreign.userOrganization, organizationId: newId() });
    await expect(authorizeAgentExecution(foreign.runtime, { kind: 'member', userOrganizationKey: foreignLink.key }, { ...foreign.data, async getUserOrganization() { return foreignLink; } })).rejects.toThrow('another organization');

    const unscoped = fixture();
    await expect(authorizeAgentExecution(unscoped.runtime, { kind: 'member', userOrganizationKey: unscoped.userOrganization.key }, { ...unscoped.data, async listScopeMembers() { return []; } })).rejects.toThrow('not assigned to scope');
  });

  test('allows an explicit trusted system principal without user data', async () => {
    const f = fixture();
    expect(await authorizeAgentExecution(f.runtime, { kind: 'system' }, f.data)).toEqual({ kind: 'system' });
  });

  test('blocks member and delegated system execution in archived scopes', async () => {
    const f = fixture();
    const archived = { ...f.runtime, scope: { ...f.runtime.scope, deletedAt: '2026-07-18T00:00:00.000Z' } };
    await expect(authorizeAgentExecution(archived, { kind: 'member', userOrganizationKey: f.userOrganization.key }, f.data)).rejects.toThrow('archived');
    await expect(authorizeAgentExecution(archived, { kind: 'system' }, f.data)).rejects.toThrow('archived');
  });

  test('blocks archived scope-agent relations and missing agent grants', async () => {
    const archived = fixture();
    await expect(authorizeAgentExecution(archived.runtime, { kind: 'member', userOrganizationKey: archived.userOrganization.key }, { ...archived.data, async getScopeAgent() { return { ...archived.scopeAgent, status: 'archived' as const }; } })).rejects.toThrow('scope agent');
    const missing = fixture();
    await expect(authorizeAgentExecution(missing.runtime, { kind: 'member', userOrganizationKey: missing.userOrganization.key }, { ...missing.data, async listAgentMembers() { return []; } })).rejects.toThrow('no agent grant');
  });

  test('enforces the shared agent evaluator before a member AgentRun', async () => {
    const f = fixture();
    await expect(authorizeAgentExecution(f.runtime, { kind: 'member', userOrganizationKey: f.userOrganization.key }, { ...f.data, async evaluateAgentAccess() { return { allowed: false, reason: 'ACTION_DENIED' }; } })).rejects.toThrow('ACTION_DENIED');
  });

  test('allows active members to invoke only the canonical Beacon orchestration boundary', async () => {
    const f = fixture();
    const viewerMembership = userOrganizationSchema.parse({ ...f.userOrganization, orgRole: 'viewer' });
    const beaconRuntime = { ...f.runtime, agent: { ...f.runtime.agent, slug: 'beacon', name: 'Beacon', title: 'AI Coordinator' } };
    const resolved = await authorizeAgentExecution(beaconRuntime, { kind: 'member', userOrganizationKey: viewerMembership.key }, { ...f.data, async getUserOrganization() { return viewerMembership; }, async getScopeAgent() { throw new Error('Beacon orchestration must not depend on a target scopeAgent relation'); } }, { serviceDelegation: { agentSlug: 'beacon', requiredOrganizationRole: null } });
    expect(resolved).toMatchObject({ kind: 'member', userOrganization: { orgRole: 'viewer' }, scopeMember: null });
  });

  test('preserves legacy membership keys through Beacon delegation', async () => {
    const f = fixture();
    const legacyMembership = userOrganizationSchema.parse({ ...f.userOrganization, key: 'legacy-membership-key', orgRole: 'owner' });
    const beaconRuntime = { ...f.runtime, agent: { ...f.runtime.agent, slug: 'beacon', name: 'Beacon', title: 'AI Coordinator' } };
    const resolved = await authorizeAgentExecution(beaconRuntime, { kind: 'member', userOrganizationKey: legacyMembership.key }, { ...f.data, async getUserOrganization(key) { return key === legacyMembership.key ? legacyMembership : null; } }, { serviceDelegation: { agentSlug: 'beacon', requiredOrganizationRole: null } });
    expect(resolved).toMatchObject({ kind: 'member', userOrganization: { key: 'legacy-membership-key' } });
  });
});
