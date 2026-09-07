import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import { createScopeService, ScopeServiceError } from './service';
import type { Scope } from './schema';

const teamKey = newId();
const userKey = newId();
const teamMembershipKey = newId();
const currentScopeKey = newId();
const context = {
  teamKey,
  runtimeScopeKey: currentScopeKey,
  principal: {
    kind: 'member',
    user: { key: userKey, currentScopeKey },
    userTeam: { key: teamMembershipKey, teamKey: teamKey, userId: userKey, teamRole: 'owner', status: 'active' },
    scopeMember: null,
  },
} as unknown as ToolContext;

const scope = (overrides: Partial<Scope> = {}): Scope => ({
  key: newId(), teamKey, slug: 'plans', name: 'Plans', summary: 'Team plans', description: 'Team plans', position: 2, level: 1, embedding: [0.1], ...overrides,
});

const teamDecision = (role: 'owner' | 'admin' | 'viewer' = 'owner') => ({ allowed: true, reason: 'ALLOWED', effectiveRole: role, team: {}, membership: {} }) as never;
const scopeDecision = (allowed = true, role: 'owner' | 'admin' | 'viewer' = 'owner') => ({ allowed, reason: allowed ? 'ALLOWED' : 'SCOPE_MEMBERSHIP_NOT_FOUND', effectiveRole: allowed ? role : null, accessSources: [], teamDecision: teamDecision(role), scope: {} }) as never;

describe('canonical scope service', () => {
  test('lists only authorized scopes through the access engine and never projects embeddings', async () => {
    const visible = scope({ key: currentScopeKey });
    const hidden = scope({ slug: 'hidden', name: 'Hidden' });
    const accessOrder: string[] = [];
    const service = createScopeService({
      listScopes: async () => [visible, hidden],
      authorizeTeam: async () => teamDecision(),
      authorizeScope: async (_context, key) => { accessOrder.push(`authorize:${key}`); return scopeDecision(key === visible.key); },
      materializeMemberships: async () => { accessOrder.push('materialize'); },
    });
    const result = await service.list({}, context);
    expect(result.scopes).toEqual([{ key: visible.key, slug: 'plans', name: 'Plans', summary: 'Team plans', description: 'Team plans', position: 2, level: 1, role: 'owner', isCurrent: true }]);
    expect(JSON.stringify(result)).not.toContain('embedding');
    expect(accessOrder).toEqual(['materialize', `authorize:${visible.key}`, `authorize:${hidden.key}`]);
  });

  test('allows only owners/admins to create and injects trusted identity and idempotency', async () => {
    const calls: unknown[] = [];
    const created = scope();
    const service = createScopeService({ authorizeTeam: async () => teamDecision('admin'), createInTransaction: async (input) => { calls.push(input); return { scope: created, role: 'admin', currentScopeKey }; } });
    await expect(service.create({ name: ' Plans ', description: ' Team plans ' }, context, 'request-1')).resolves.toMatchObject({ key: created.key, role: 'admin', isCurrent: false });
    expect(calls).toEqual([{ teamKey, userKey, name: 'Plans', description: 'Team plans', idempotencyKey: 'scope.create:request-1' }]);
    const denied = createScopeService({ authorizeTeam: async () => teamDecision('viewer'), createInTransaction: async () => ({ scope: created, role: 'viewer', currentScopeKey }) });
    await expect(denied.create({ name: 'No' }, context, 'request-2')).rejects.toBeInstanceOf(ScopeServiceError);
  });

  test('authorizes selection and transactionally targets only the authenticated user', async () => {
    const target = scope();
    const calls: unknown[] = [];
    const service = createScopeService({ materializeMemberships: async () => {}, authorizeScope: async () => scopeDecision(), selectInTransaction: async (input) => { calls.push(input); return { scope: target, role: 'admin' }; } });
    await expect(service.select({ targetScopeKey: target.key }, context)).resolves.toMatchObject({ key: target.key, role: 'admin', isCurrent: true });
    expect(calls).toEqual([{ teamKey, userKey, teamMembershipKey, targetScopeKey: target.key }]);
    const denied = createScopeService({ materializeMemberships: async () => {}, authorizeScope: async () => scopeDecision(false), selectInTransaction: async () => { throw new Error('must not run'); } });
    await expect(denied.select({ targetScopeKey: target.key }, context)).rejects.toBeInstanceOf(ScopeServiceError);
  });

  test('returns controlled authorization errors for lookup failures and transaction-time demotion', async () => {
    const target = scope();
    const lookupFailure = createScopeService({ materializeMemberships: async () => {}, authorizeScope: async () => { throw new Error('missing scope'); } });
    await expect(lookupFailure.select({ targetScopeKey: target.key }, context)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const demoted = createScopeService({
      authorizeTeam: async () => teamDecision('admin'),
      createInTransaction: async () => { throw new ScopeServiceError('FORBIDDEN', 'Only active team owners and admins may create scopes.'); },
    });
    await expect(demoted.create({ name: 'Plans' }, context, 'request-race')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('default persistence encodes idempotency, concurrency, membership, and selection invariants', async () => {
    const source = await Bun.file(new URL('./service.ts', import.meta.url)).text();
    const accessSource = await Bun.file(new URL('../tools/domain-access-engine.ts', import.meta.url)).text();
    expect(source).toContain("read: ['users', 'userTeams'], write: ['scopes', 'scopeMembers', 'emailTones']");
    expect(source).toContain("['scope.create', teamKey, userKey, idempotencyKey]");
    expect(source).toContain('existing.name !== input.name || existing.description !== input.description');
    expect(source).toContain('reconcileTeamScopeMemberships(input.teamKey, { scopeKeys: [created.key] }, database)');
    expect(source).toContain('Math.max(0, ...scopes.map(({ position }) => position)) + 1');
    expect(source).toContain('scopeMembership.status == "active"');
    expect(source).toContain('membership.userId == @userKey');
    expect(source).toContain('UPDATE user WITH { currentScopeKey: scope._key');
    expect(accessSource.indexOf("directMembership?.status === 'suspended'")).toBeLessThan(accessSource.indexOf("teamDecision.effectiveRole === 'owner'"));
  });
});
