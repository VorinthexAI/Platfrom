import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeMemberSchema, scopeSchema } from '@/lib/ai/scopes';
import type { AgentRuntimeContext } from './runtime';
import { AgentExecutionAccessError, authorizeAgentExecution, type ExecutionAccessDataSource } from './access';

const now = '2026-07-16T00:00:00.000Z';

function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Vorinthex', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'platform', name: 'Platform', description: 'Platform scope' });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'member@example.com', emailHash: 'hash', createdAt: now, updatedAt: now });
  const userOrganization = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const scopeMember = scopeMemberSchema.parse({ key: newId(), scopeKey: scope.key, userOrganizationKey: userOrganization.key, role: 'moderator' });
  const runtime = { organization, scope } as AgentRuntimeContext;
  const data: ExecutionAccessDataSource = {
    async getUserOrganization(key) { return key === userOrganization.key ? userOrganization : null; },
    async getUser(key) { return key === user.key ? user : null; },
    async listScopeMembers() { return [scopeMember]; },
  };
  return { runtime, data, user, userOrganization, scopeMember };
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
});
