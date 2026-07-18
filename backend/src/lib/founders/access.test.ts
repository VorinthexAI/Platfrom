import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { organizationSchema, type Organization } from '@/lib/db/organizations.node';
import { userSchema, type User } from '@/lib/db/users.node';
import { userOrganizationSchema, type UserOrganization } from '@/lib/db/user-organization.node';
import { scopeSchema, scopeMemberSchema, scopeScopeSchema, type Scope, type ScopeMember, type ScopeScope } from '@/lib/ai/scopes';
import {
  FoundersAccessError,
  listAccessibleOrganizations,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireOrganizationAccess,
  requireScopeAccess,
  type FoundersAccessDataSource,
} from './access';

const now = '2026-07-17T00:00:00.000Z';

interface FixtureState {
  users: User[];
  organizations: Organization[];
  rootOrganization: Organization | null;
  memberships: UserOrganization[];
  scopes: Scope[];
  relations: ScopeScope[];
  scopeMembers: ScopeMember[];
}

function sourceFor(state: FixtureState): FoundersAccessDataSource {
  return {
    async getUser(key) { return state.users.find((user) => user.key === key) ?? null; },
    async getRootOrganization() { return state.rootOrganization; },
    async getOrganization(key) { return state.organizations.find((organization) => organization.key === key) ?? null; },
    async getMembership(organizationKey, userId) {
      return state.memberships.find((membership) => membership.organizationId === organizationKey && membership.userId === userId) ?? null;
    },
    async listActiveMemberships(userId) {
      return state.memberships.filter((membership) => membership.userId === userId && membership.status === 'active');
    },
    async listScopes(organizationKey) {
      return [...state.scopes.filter((scope) => scope.organizationKey === organizationKey)]
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async listChildRelations(parentKey) { return state.relations.filter((relation) => relation.parentKey === parentKey); },
    async getScope(scopeKey) { return state.scopes.find((scope) => scope.key === scopeKey) ?? null; },
    async listScopeMembers(scopeKey) { return state.scopeMembers.filter((member) => member.scopeKey === scopeKey); },
  };
}

function fixture() {
  const rootOrganization = organizationSchema.parse({ key: newId(), name: 'Vorinthex AI', is_root: true, createdAt: now, updatedAt: now });
  const otherOrganization = organizationSchema.parse({ key: newId(), name: 'Acme Labs', slug: 'acme', createdAt: now, updatedAt: now });
  const founder = userSchema.parse({ key: newId(), organizationId: rootOrganization.key, email: 'founder@example.com', emailHash: 'h1', name: 'Founder One', createdAt: now, updatedAt: now });
  const outsider = userSchema.parse({ key: newId(), organizationId: otherOrganization.key, email: 'outsider@example.com', emailHash: 'h2', createdAt: now, updatedAt: now });
  const founderRootMembership = userOrganizationSchema.parse({ key: newId(), organizationId: rootOrganization.key, userId: founder.key, orgRole: 'owner', orgTitle: 'CEO', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const outsiderMembership = userOrganizationSchema.parse({ key: newId(), organizationId: otherOrganization.key, userId: outsider.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });

  const nexus = scopeSchema.parse({ key: newId(), organizationKey: rootOrganization.key, slug: 'nexus', name: 'Nexus', summary: 'Root scope', description: 'Root scope', position: 1 });
  const core = scopeSchema.parse({ key: newId(), organizationKey: rootOrganization.key, slug: 'core', name: 'Core', summary: 'Core scope', description: 'Core scope', position: 2 });
  const launch = scopeSchema.parse({ key: newId(), organizationKey: rootOrganization.key, slug: 'launch', name: 'Launch', summary: 'Launch scope', description: 'Launch scope', position: 3 });
  const foreignScope = scopeSchema.parse({ key: newId(), organizationKey: otherOrganization.key, slug: 'ops', name: 'Ops', summary: 'Foreign scope', description: 'Foreign scope', position: 1 });
  const relations = [
    scopeScopeSchema.parse({ key: newId(), parentKey: nexus.key, childKey: core.key }),
    scopeScopeSchema.parse({ key: newId(), parentKey: nexus.key, childKey: launch.key }),
  ];

  const state: FixtureState = {
    users: [founder, outsider],
    organizations: [rootOrganization, otherOrganization],
    rootOrganization,
    memberships: [founderRootMembership, outsiderMembership],
    scopes: [nexus, core, launch, foreignScope],
    relations,
    scopeMembers: [],
  };
  return { state, source: sourceFor(state), rootOrganization, otherOrganization, founder, outsider, founderRootMembership, outsiderMembership, nexus, core, launch, foreignScope };
}

describe('requireFoundersGateAccess', () => {
  test('grants access to an active root-organization member', async () => {
    const f = fixture();
    const access = await requireFoundersGateAccess(f.founder.key, f.source);
    expect(access.user.key).toBe(f.founder.key);
    expect(access.rootOrganization.key).toBe(f.rootOrganization.key);
    expect(access.rootMembership.orgRole).toBe('owner');
  });

  test('rejects a user with no root-organization membership', async () => {
    const f = fixture();
    await expect(requireFoundersGateAccess(f.outsider.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });

  test('rejects an inactive root membership', async () => {
    const f = fixture();
    f.state.memberships = f.state.memberships.map((membership) =>
      membership.key === f.founderRootMembership.key ? { ...membership, status: 'suspended' as const } : membership);
    await expect(requireFoundersGateAccess(f.founder.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });

  test('rejects an unknown user', async () => {
    const f = fixture();
    await expect(requireFoundersGateAccess(newId(), f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });
});

describe('listAccessibleOrganizations', () => {
  test('lists only organizations with an active membership', async () => {
    const f = fixture();
    const membership = userOrganizationSchema.parse({ key: newId(), organizationId: f.otherOrganization.key, userId: f.founder.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(membership);
    const options = await listAccessibleOrganizations(f.founder.key, f.source);
    expect(options.map(({ key }) => key).sort()).toEqual([f.rootOrganization.key, f.otherOrganization.key].sort());
    expect(options.find(({ key }) => key === f.otherOrganization.key)?.alias).toBe('acme');
  });

  test('omits suspended memberships and inactive organizations', async () => {
    const f = fixture();
    f.state.organizations = f.state.organizations.map((organization) =>
      organization.key === f.rootOrganization.key ? { ...organization, isActive: false } : organization);
    const options = await listAccessibleOrganizations(f.founder.key, f.source);
    expect(options).toEqual([]);
  });
});

describe('requireOrganizationAccess', () => {
  test('rejects a user who is not a member of the organization', async () => {
    const f = fixture();
    await expect(requireOrganizationAccess(f.founder.key, f.otherOrganization.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });

  test('accepts an active member and returns canonical records', async () => {
    const f = fixture();
    const access = await requireOrganizationAccess(f.founder.key, f.rootOrganization.key, f.source);
    expect(access.organization.key).toBe(f.rootOrganization.key);
    expect(access.membership.key).toBe(f.founderRootMembership.key);
  });
});

describe('requireScopeAccess', () => {
  test('an owner may access every scope in their organization', async () => {
    const f = fixture();
    const access = await requireScopeAccess(f.founderRootMembership, f.core.key, f.source);
    expect(access.scope.key).toBe(f.core.key);
  });

  test('rejects a scope belonging to another organization', async () => {
    const f = fixture();
    await expect(requireScopeAccess(f.founderRootMembership, f.foreignScope.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });

  test('rejects an unknown scope with the same denial as a forbidden one', async () => {
    const f = fixture();
    const missing = await requireScopeAccess(f.founderRootMembership, newId(), f.source).catch((error) => error);
    const foreign = await requireScopeAccess(f.founderRootMembership, f.foreignScope.key, f.source).catch((error) => error);
    expect(missing).toBeInstanceOf(FoundersAccessError);
    expect((missing as FoundersAccessError).code).toBe((foreign as FoundersAccessError).code);
  });

  test('a plain member needs an explicit scope membership', async () => {
    const f = fixture();
    const memberMembership = userOrganizationSchema.parse({ key: newId(), organizationId: f.rootOrganization.key, userId: f.outsider.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    await expect(requireScopeAccess(memberMembership, f.core.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);

    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.core.key, userOrganizationKey: memberMembership.key, role: 'viewer' }));
    const access = await requireScopeAccess(memberMembership, f.core.key, f.source);
    expect(access.scope.key).toBe(f.core.key);
  });
});

describe('listAccessibleScopes', () => {
  test('an owner sees only leaf scopes in hierarchy order with paths', async () => {
    const f = fixture();
    const options = await listAccessibleScopes(f.founderRootMembership, f.source);
    expect(options.map(({ key }) => key)).toEqual([f.core.key, f.launch.key]);
    expect(options[0]).toMatchObject({ parentKey: f.nexus.key, path: ['Nexus', 'Core'] });
    expect(options[1]).toMatchObject({ parentKey: f.nexus.key, path: ['Nexus', 'Launch'] });
  });

  test('does not expose a parent even when a plain member is assigned to it', async () => {
    const f = fixture();
    const memberMembership = userOrganizationSchema.parse({ key: newId(), organizationId: f.rootOrganization.key, userId: f.outsider.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.nexus.key, userOrganizationKey: memberMembership.key, role: 'viewer' }));
    expect(await listAccessibleScopes(memberMembership, f.source)).toEqual([]);
  });

  test('a plain member sees only scopes they were explicitly added to', async () => {
    const f = fixture();
    const memberMembership = userOrganizationSchema.parse({ key: newId(), organizationId: f.rootOrganization.key, userId: f.outsider.key, orgRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.launch.key, userOrganizationKey: memberMembership.key, role: 'viewer' }));
    const options = await listAccessibleScopes(memberMembership, f.source);
    expect(options.map(({ key }) => key)).toEqual([f.launch.key]);
    expect(options[0]?.path).toEqual(['Nexus', 'Launch']);
  });

  test('returns an empty list when the organization has no scopes', async () => {
    const f = fixture();
    f.state.scopes = [];
    const options = await listAccessibleScopes(f.founderRootMembership, f.source);
    expect(options).toEqual([]);
  });
});
