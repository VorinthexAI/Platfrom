import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { reconcileTeamScopeMemberships, scopeRoleForTeamRole } from './membership-invariant';

type TeamMembership = { key: string; teamKey: string; teamRole: string; status: string };
type Scope = { key: string; teamKey: string };
type ScopeMembership = { key: string; scopeKey: string; userTeamKey: string; role: string; status: string; source?: 'explicit' | 'team' };

function fakeDatabase(input: {
  memberships: TeamMembership[];
  scopes: Scope[];
  scopeMembers?: ScopeMembership[];
}) {
  const scopeMembers = [...(input.scopeMembers ?? [])];
  const queries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
  const database = {
    async query<T>(query: string, bindVars: Record<string, unknown> = {}) {
      queries.push({ query, bindVars });
      if (query.includes('UPSERT { scopeKey: document.scopeKey')) {
        for (const document of bindVars.documents as ScopeMembership[]) {
          const existing = scopeMembers.find((row) => row.scopeKey === document.scopeKey && row.userTeamKey === document.userTeamKey);
          if (!existing) scopeMembers.push({ ...document, status: 'active', source: 'team' });
        }
        return { all: async () => [] as T[] };
      }
      if (query.includes('FILTER member.source == "team"')) {
        for (const document of bindVars.documents as ScopeMembership[]) {
          const existing = scopeMembers.find((row) => row.scopeKey === document.scopeKey && row.userTeamKey === document.userTeamKey);
          if (existing?.source === 'team') Object.assign(existing, { role: document.role, status: 'active' });
        }
        return { all: async () => [] as T[] };
      }

      const scopeKeys = bindVars.scopeKeys as string[] | null;
      const userTeamKeys = bindVars.userTeamKeys as string[] | null;
      const missing = input.memberships
        .filter((membership) => membership.teamKey === bindVars.teamKey && membership.status === 'active')
        .filter((membership) => userTeamKeys === null || userTeamKeys.includes(membership.key))
        .flatMap((membership) => input.scopes
          .filter((scope) => scope.teamKey === bindVars.teamKey)
          .filter((scope) => scopeKeys === null || scopeKeys.includes(scope.key))
          .map((scope) => {
            const existing = scopeMembers.find((row) => row.scopeKey === scope.key && row.userTeamKey === membership.key);
            return { scopeKey: scope.key, userTeamKey: membership.key, teamRole: membership.teamRole, existing: existing ? { _key: existing.key } : null };
          }));
      return { all: async () => missing as T[] };
    },
  };
  return { database, scopeMembers, queries };
}

describe('team scope membership invariant', () => {
  test('maps every team role to the required scope role', () => {
    expect(['owner', 'admin', 'moderator', 'member', 'viewer'].map(scopeRoleForTeamRole))
      .toEqual(['owner', 'admin', 'moderator', 'viewer', 'viewer']);
  });

  test('backfills the active team membership and scope cross-product only', async () => {
    const teamKey = newId();
    const foreignTeamKey = newId();
    const activeRoles = ['owner', 'admin', 'moderator', 'member', 'viewer'];
    const memberships = activeRoles.map((teamRole) => ({ key: newId(), teamKey: teamKey, teamRole, status: 'active' }));
    memberships.push({ key: newId(), teamKey: teamKey, teamRole: 'admin', status: 'suspended' });
    memberships.push({ key: newId(), teamKey: foreignTeamKey, teamRole: 'owner', status: 'active' });
    const scopes = [
      { key: newId(), teamKey },
      { key: newId(), teamKey },
      { key: newId(), teamKey: foreignTeamKey },
    ];
    const fixture = fakeDatabase({ memberships, scopes });

    const result = await reconcileTeamScopeMemberships(teamKey, {}, fixture.database);

    expect(result.created).toHaveLength(activeRoles.length * 2);
    expect(new Set(result.created.map(({ scopeKey }) => scopeKey))).toEqual(new Set(scopes.slice(0, 2).map(({ key }) => key)));
    expect(result.created.map(({ role }) => role).sort()).toEqual(['admin', 'admin', 'moderator', 'moderator', 'owner', 'owner', 'viewer', 'viewer', 'viewer', 'viewer']);
    expect(fixture.scopeMembers.every(({ status }) => status === 'active')).toBe(true);
    expect(fixture.scopeMembers.every(({ source }) => source === 'team')).toBe(true);
  });

  test('preserves explicit rows, supports targeted materialization, and is idempotent', async () => {
    const teamKey = newId();
    const owner = { key: newId(), teamKey: teamKey, teamRole: 'owner', status: 'active' };
    const member = { key: newId(), teamKey: teamKey, teamRole: 'member', status: 'active' };
    const firstScope = { key: newId(), teamKey };
    const secondScope = { key: newId(), teamKey };
    const explicit = { key: newId(), scopeKey: firstScope.key, userTeamKey: owner.key, role: 'viewer', status: 'suspended', source: 'explicit' as const };
    const fixture = fakeDatabase({ memberships: [owner, member], scopes: [firstScope, secondScope], scopeMembers: [explicit] });

    const targeted = await reconcileTeamScopeMemberships(
      teamKey,
      { scopeKeys: [firstScope.key], userTeamKeys: [owner.key, member.key] },
      fixture.database,
    );
    expect(targeted.created).toEqual([expect.objectContaining({ scopeKey: firstScope.key, userTeamKey: member.key, role: 'viewer' })]);
    expect(fixture.scopeMembers.find(({ key }) => key === explicit.key)).toEqual(explicit);

    const full = await reconcileTeamScopeMemberships(teamKey, {}, fixture.database);
    expect(full.created).toHaveLength(2);
    const rerun = await reconcileTeamScopeMemberships(teamKey, {}, fixture.database);
    expect(rerun.created).toEqual([]);
    expect(fixture.scopeMembers).toHaveLength(4);
  });

  test('uses separate parse-safe insert and team refresh queries', async () => {
    const teamKey = newId();
    const membership = { key: newId(), teamKey: teamKey, teamRole: 'admin', status: 'active' };
    const scope = { key: newId(), teamKey };
    const fixture = fakeDatabase({ memberships: [membership], scopes: [scope] });

    await reconcileTeamScopeMemberships(teamKey, {}, fixture.database);

    const modificationQueries = fixture.queries.slice(1).map(({ query }) => query);
    expect(modificationQueries).toHaveLength(2);
    expect(modificationQueries[0]).toContain('UPSERT { scopeKey: document.scopeKey, userTeamKey: document.userTeamKey }');
    expect(modificationQueries[0]).toContain('UPDATE {}');
    expect(modificationQueries[0]).not.toMatch(/UPDATE\s+[^\n]*\?/);
    expect(modificationQueries[1]).toContain('FILTER member.source == "team"');
    expect(modificationQueries[1]).toContain('UPDATE member WITH { role: document.role, status: "active" }');
    expect(modificationQueries[1]).not.toContain('UPSERT');
  });

  test('demotes and reactivates team rows without changing explicit rows', async () => {
    const teamKey = newId();
    const membership = { key: newId(), teamKey: teamKey, teamRole: 'admin', status: 'active' };
    const first = { key: newId(), teamKey };
    const second = { key: newId(), teamKey };
    const inherited = { key: newId(), scopeKey: first.key, userTeamKey: membership.key, role: 'admin', status: 'suspended', source: 'team' as const };
    const explicit = { key: newId(), scopeKey: second.key, userTeamKey: membership.key, role: 'moderator', status: 'suspended', source: 'explicit' as const };
    const fixture = fakeDatabase({ memberships: [membership], scopes: [first, second], scopeMembers: [inherited, explicit] });

    membership.teamRole = 'member';
    expect((await reconcileTeamScopeMemberships(teamKey, { userTeamKeys: [membership.key] }, fixture.database)).created).toEqual([]);
    expect(inherited).toMatchObject({ role: 'viewer', status: 'active', source: 'team' });
    expect(explicit).toMatchObject({ role: 'moderator', status: 'suspended', source: 'explicit' });
  });

});
