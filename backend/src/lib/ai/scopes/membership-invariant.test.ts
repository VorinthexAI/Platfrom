import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { reconcileOrganizationInheritedAgentMemberships, reconcileOrganizationScopeMemberships, scopeRoleForOrganizationRole } from './membership-invariant';

type OrganizationMembership = { key: string; organizationId: string; orgRole: string; status: string };
type Scope = { key: string; organizationKey: string };
type ScopeMembership = { key: string; scopeKey: string; userOrganizationKey: string; role: string; status: string; source?: 'explicit' | 'organization' };

function fakeDatabase(input: {
  memberships: OrganizationMembership[];
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
          const existing = scopeMembers.find((row) => row.scopeKey === document.scopeKey && row.userOrganizationKey === document.userOrganizationKey);
          if (!existing) scopeMembers.push({ ...document, status: 'active', source: 'organization' });
        }
        return { all: async () => [] as T[] };
      }
      if (query.includes('FILTER member.source == "organization"')) {
        for (const document of bindVars.documents as ScopeMembership[]) {
          const existing = scopeMembers.find((row) => row.scopeKey === document.scopeKey && row.userOrganizationKey === document.userOrganizationKey);
          if (existing?.source === 'organization') Object.assign(existing, { role: document.role, status: 'active' });
        }
        return { all: async () => [] as T[] };
      }

      const scopeKeys = bindVars.scopeKeys as string[] | null;
      const userOrganizationKeys = bindVars.userOrganizationKeys as string[] | null;
      const missing = input.memberships
        .filter((membership) => membership.organizationId === bindVars.organizationKey && membership.status === 'active')
        .filter((membership) => userOrganizationKeys === null || userOrganizationKeys.includes(membership.key))
        .flatMap((membership) => input.scopes
          .filter((scope) => scope.organizationKey === bindVars.organizationKey)
          .filter((scope) => scopeKeys === null || scopeKeys.includes(scope.key))
          .map((scope) => {
            const existing = scopeMembers.find((row) => row.scopeKey === scope.key && row.userOrganizationKey === membership.key);
            return { scopeKey: scope.key, userOrganizationKey: membership.key, orgRole: membership.orgRole, existing: existing ? { _key: existing.key } : null };
          }));
      return { all: async () => missing as T[] };
    },
  };
  return { database, scopeMembers, queries };
}

describe('organization scope membership invariant', () => {
  test('wires targeted reconciliation before inherited grant synchronization in domain mutations', async () => {
    const source = await Bun.file(new URL('../tools/domain-execute.ts', import.meta.url)).text();
    const add = source.indexOf('userOrganizationKeys: [key]');
    const activate = source.indexOf('userOrganizationKeys: keys');
    const create = source.indexOf('scopeKeys: [key]');
    expect(add).toBeGreaterThan(-1);
    expect(source.indexOf('syncOrganizationAgentMembers(context)', add)).toBeGreaterThan(add);
    expect(activate).toBeGreaterThan(add);
    expect(source.indexOf('syncOrganizationAgentMembers(context)', activate)).toBeGreaterThan(activate);
    expect(create).toBeGreaterThan(activate);
    expect(source.indexOf('syncOrganizationAgentMembers(context)', create)).toBeGreaterThan(create);
  });

  test('scope member mutations preserve provenance and the organization baseline', async () => {
    const source = await Bun.file(new URL('../tools/domain-execute-access-domains.ts', import.meta.url)).text();
    expect(source).toContain('member.source == "explicit" || !HAS(member, "source")');
    expect(source).toContain('source: \'explicit\'');
    expect(source).toContain('source: "organization"');
    expect(source).toContain('UPDATE document.key WITH { role: document.role, status: "active", source: "organization" }');
  });

  test('maps every organization role to the required scope role', () => {
    expect(['owner', 'admin', 'moderator', 'member', 'viewer'].map(scopeRoleForOrganizationRole))
      .toEqual(['owner', 'admin', 'moderator', 'viewer', 'viewer']);
  });

  test('backfills the active organization membership and scope cross-product only', async () => {
    const organizationKey = newId();
    const foreignOrganizationKey = newId();
    const activeRoles = ['owner', 'admin', 'moderator', 'member', 'viewer'];
    const memberships = activeRoles.map((orgRole) => ({ key: newId(), organizationId: organizationKey, orgRole, status: 'active' }));
    memberships.push({ key: newId(), organizationId: organizationKey, orgRole: 'admin', status: 'suspended' });
    memberships.push({ key: newId(), organizationId: foreignOrganizationKey, orgRole: 'owner', status: 'active' });
    const scopes = [
      { key: newId(), organizationKey },
      { key: newId(), organizationKey },
      { key: newId(), organizationKey: foreignOrganizationKey },
    ];
    const fixture = fakeDatabase({ memberships, scopes });

    const result = await reconcileOrganizationScopeMemberships(organizationKey, {}, fixture.database);

    expect(result.created).toHaveLength(activeRoles.length * 2);
    expect(new Set(result.created.map(({ scopeKey }) => scopeKey))).toEqual(new Set(scopes.slice(0, 2).map(({ key }) => key)));
    expect(result.created.map(({ role }) => role).sort()).toEqual(['admin', 'admin', 'moderator', 'moderator', 'owner', 'owner', 'viewer', 'viewer', 'viewer', 'viewer']);
    expect(fixture.scopeMembers.every(({ status }) => status === 'active')).toBe(true);
    expect(fixture.scopeMembers.every(({ source }) => source === 'organization')).toBe(true);
  });

  test('preserves explicit rows, supports targeted materialization, and is idempotent', async () => {
    const organizationKey = newId();
    const owner = { key: newId(), organizationId: organizationKey, orgRole: 'owner', status: 'active' };
    const member = { key: newId(), organizationId: organizationKey, orgRole: 'member', status: 'active' };
    const firstScope = { key: newId(), organizationKey };
    const secondScope = { key: newId(), organizationKey };
    const explicit = { key: newId(), scopeKey: firstScope.key, userOrganizationKey: owner.key, role: 'viewer', status: 'suspended', source: 'explicit' as const };
    const fixture = fakeDatabase({ memberships: [owner, member], scopes: [firstScope, secondScope], scopeMembers: [explicit] });

    const targeted = await reconcileOrganizationScopeMemberships(
      organizationKey,
      { scopeKeys: [firstScope.key], userOrganizationKeys: [owner.key, member.key] },
      fixture.database,
    );
    expect(targeted.created).toEqual([expect.objectContaining({ scopeKey: firstScope.key, userOrganizationKey: member.key, role: 'viewer' })]);
    expect(fixture.scopeMembers.find(({ key }) => key === explicit.key)).toEqual(explicit);

    const full = await reconcileOrganizationScopeMemberships(organizationKey, {}, fixture.database);
    expect(full.created).toHaveLength(2);
    const rerun = await reconcileOrganizationScopeMemberships(organizationKey, {}, fixture.database);
    expect(rerun.created).toEqual([]);
    expect(fixture.scopeMembers).toHaveLength(4);
  });

  test('uses separate parse-safe insert and organization refresh queries', async () => {
    const organizationKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, orgRole: 'admin', status: 'active' };
    const scope = { key: newId(), organizationKey };
    const fixture = fakeDatabase({ memberships: [membership], scopes: [scope] });

    await reconcileOrganizationScopeMemberships(organizationKey, {}, fixture.database);

    const modificationQueries = fixture.queries.slice(1).map(({ query }) => query);
    expect(modificationQueries).toHaveLength(2);
    expect(modificationQueries[0]).toContain('UPSERT { scopeKey: document.scopeKey, userOrganizationKey: document.userOrganizationKey }');
    expect(modificationQueries[0]).toContain('UPDATE {}');
    expect(modificationQueries[0]).not.toMatch(/UPDATE\s+[^\n]*\?/);
    expect(modificationQueries[1]).toContain('FILTER member.source == "organization"');
    expect(modificationQueries[1]).toContain('UPDATE member WITH { role: document.role, status: "active" }');
    expect(modificationQueries[1]).not.toContain('UPSERT');
  });

  test('demotes and reactivates organization rows without changing explicit rows', async () => {
    const organizationKey = newId();
    const membership = { key: newId(), organizationId: organizationKey, orgRole: 'admin', status: 'active' };
    const first = { key: newId(), organizationKey };
    const second = { key: newId(), organizationKey };
    const inherited = { key: newId(), scopeKey: first.key, userOrganizationKey: membership.key, role: 'admin', status: 'suspended', source: 'organization' as const };
    const explicit = { key: newId(), scopeKey: second.key, userOrganizationKey: membership.key, role: 'moderator', status: 'suspended', source: 'explicit' as const };
    const fixture = fakeDatabase({ memberships: [membership], scopes: [first, second], scopeMembers: [inherited, explicit] });

    membership.orgRole = 'member';
    expect((await reconcileOrganizationScopeMemberships(organizationKey, { userOrganizationKeys: [membership.key] }, fixture.database)).created).toEqual([]);
    expect(inherited).toMatchObject({ role: 'viewer', status: 'active', source: 'organization' });
    expect(explicit).toMatchObject({ role: 'moderator', status: 'suspended', source: 'explicit' });
  });

  test('reconciles inherited agent grants from effective hierarchical scope roles', async () => {
    const organizationKey = newId();
    const parentKey = newId();
    const childKey = newId();
    const scopeAgentKey = newId();
    const ownerKey = newId();
    const moderatorKey = newId();
    const viewerKey = newId();
    const staleGrantKey = newId();
    const inserted: Array<Record<string, unknown>> = [];
    const removed: string[] = [];
    const data = {
      memberships: [
        { key: ownerKey, orgRole: 'owner' },
        { key: moderatorKey, orgRole: 'member' },
        { key: viewerKey, orgRole: 'viewer' },
      ],
      scopes: [{ key: parentKey, deletedAt: null }, { key: childKey, deletedAt: null }],
      scopeMembers: [
        { scopeKey: parentKey, userOrganizationKey: moderatorKey, role: 'moderator' },
        { scopeKey: childKey, userOrganizationKey: viewerKey, role: 'viewer' },
      ],
      relations: [{ parentKey, childKey }],
      scopeAgents: [{ key: scopeAgentKey, scopeKey: childKey, agentKey: newId(), minimumAccessRole: 'moderator' }],
      inheritedGrants: [{ key: staleGrantKey, scopeAgentKey, userOrganizationKey: viewerKey }],
    };
    const database = {
      transactionCalls: 0,
      async atomic<T>(_collections: string[], operation: (database: any) => Promise<T>) { this.transactionCalls++; return operation(this); },
      async query<T>(query: string, bindVars: Record<string, unknown> = {}) {
        if (query.includes('RETURN {')) return { all: async () => [data] as T[] };
        if (Array.isArray(bindVars.removed)) removed.push(...bindVars.removed as string[]);
        if (Array.isArray(bindVars.documents)) inserted.push(...bindVars.documents as Array<Record<string, unknown>>);
        return { all: async () => [] as T[] };
      },
    };

    const result = await reconcileOrganizationInheritedAgentMemberships(organizationKey, database);

    expect(result.removed).toEqual([staleGrantKey]);
    expect(result.created.map(({ userOrganizationKey }) => userOrganizationKey).sort()).toEqual([moderatorKey, ownerKey].sort());
    expect(inserted).toHaveLength(2);
    expect(removed).toEqual([staleGrantKey]);
    expect(database.transactionCalls).toBe(1);
  });
});
