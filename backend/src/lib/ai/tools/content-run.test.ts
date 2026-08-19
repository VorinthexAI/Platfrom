import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema } from '@/lib/db/organizations.node';
import { userSchema } from '@/lib/db/users.node';
import { userOrganizationSchema } from '@/lib/db/user-organization.node';
import { scopeSchema } from '@/lib/ai/scopes';
import { runAuthenticatedContentTool } from './content-run';

const now = '2026-07-22T00:00:00.000Z';
function fixture() {
  const organization = organizationSchema.parse({ key: newId(), name: 'Acme', createdAt: now, updatedAt: now });
  const scope = scopeSchema.parse({ key: newId(), organizationKey: organization.key, slug: 'content', name: 'Content', summary: 'Content', description: 'Content', position: 1 });
  const user = userSchema.parse({ key: newId(), organizationId: organization.key, email: 'owner@acme.test', emailHash: 'hash', createdAt: now, updatedAt: now });
  const membership = userOrganizationSchema.parse({ key: newId(), organizationId: organization.key, userId: user.key, orgRole: 'owner', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const organizationDecision = { allowed: true, reason: 'ALLOWED' as const, effectiveRole: 'owner' as const, organization: {} as never, membership: {} as never };
  const scopeDecision = { allowed: true, reason: 'ALLOWED', effectiveRole: 'owner' as const, accessSources: ['organization-role' as const], organizationDecision, scope: { key: scope.key } as never };
  const options = {
    authenticatedUserKey: user.key,
    resolveMembership: async (organizationKey: string, userKey: string) => organizationKey === organization.key && userKey === user.key ? membership : null,
    resolveUser: async (userKey: string) => userKey === user.key ? user : null,
    authorizeScope: async () => scopeDecision,
  };
  return { organization, scope, user, membership, options, scopeDecision };
}

describe('runAuthenticatedContentTool', () => {
  test('derives the principal from the authenticated user and dispatches', async () => {
    const f = fixture(); let received: any;
    const output = await runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: { scopeKey: f.scope.key } }, {
      ...f.options,
      execute: (async (tool: any, input: any, context: any) => { received = { tool, input, context }; return { folders: [] }; }) as any,
    });
    expect(output).toEqual({ folders: [] });
    expect(received).toMatchObject({ tool: 'folder.list', context: { organizationKey: f.organization.key, runtimeScopeKey: f.scope.key, principal: { kind: 'member', user: { key: f.user.key }, userOrganization: { key: f.membership.key } } } });
  });

  test('rejects inactive, foreign-user, and unauthorized scope memberships', async () => {
    const f = fixture();
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: {} }, { ...f.options, resolveMembership: async () => ({ ...f.membership, status: 'suspended' as const }) })).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: {} }, { ...f.options, authenticatedUserKey: newId(), resolveMembership: async () => f.membership })).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: {} }, { ...f.options, authorizeScope: async () => ({ ...f.scopeDecision, allowed: false, reason: 'SCOPE_MEMBERSHIP_NOT_FOUND' }) })).rejects.toMatchObject({ code: 'CONTENT_FORBIDDEN' });
  });

  test('preserves execution failures and strict caller contracts', async () => {
    const f = fixture();
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: {} }, { ...f.options, execute: (async () => { throw new Error('provider failed'); }) as any })).rejects.toThrow('provider failed');
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'unknown', input: {} } as any, f.options)).rejects.toThrow();
    await expect(runAuthenticatedContentTool({ organizationKey: f.organization.key, scopeKey: f.scope.key, tool: 'folder.list', input: {}, membershipKey: f.membership.key } as any, f.options)).rejects.toThrow();
  });
});
