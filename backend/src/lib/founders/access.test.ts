import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { teamSchema, type Team } from '@/lib/db/teams.node';
import { userSchema, type User } from '@/lib/db/users.node';
import { userTeamSchema, type UserTeam } from '@/lib/db/user-team.node';
import { scopeSchema, scopeMemberSchema, scopeScopeSchema, type Scope, type ScopeMember, type ScopeScope } from '@/lib/ai/scopes';
import {
  FoundersAccessError,
  listAccessibleTeams,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireTeamAccess,
  requireScopeAccess,
  type FoundersAccessDataSource,
} from './access';

const now = '2026-07-17T00:00:00.000Z';

interface FixtureState {
  users: User[];
  teams: Team[];
  rootTeam: Team | null;
  memberships: UserTeam[];
  scopes: Scope[];
  relations: ScopeScope[];
  scopeMembers: ScopeMember[];
}

function sourceFor(state: FixtureState): FoundersAccessDataSource {
  return {
    async getUser(key) { return state.users.find((user) => user.key === key) ?? null; },
    async getRootTeam() { return state.rootTeam; },
    async getTeam(key) { return state.teams.find((team) => team.key === key) ?? null; },
    async getMembership(teamKey, userId) {
      return state.memberships.find((membership) => membership.teamKey === teamKey && membership.userId === userId) ?? null;
    },
    async listActiveMemberships(userId) {
      return state.memberships.filter((membership) => membership.userId === userId && membership.status === 'active');
    },
    async listScopes(teamKey) {
      return [...state.scopes.filter((scope) => scope.teamKey === teamKey)]
        .sort((left, right) => left.name.localeCompare(right.name));
    },
    async listChildRelations(parentKey) { return state.relations.filter((relation) => relation.parentKey === parentKey); },
    async getScope(scopeKey) { return state.scopes.find((scope) => scope.key === scopeKey) ?? null; },
    async listScopeMembers(scopeKey) { return state.scopeMembers.filter((member) => member.scopeKey === scopeKey); },
  };
}

function fixture() {
  const rootTeam = teamSchema.parse({ key: newId(), name: 'Vorinthex AI', is_root: true, createdAt: now, updatedAt: now });
  const otherTeam = teamSchema.parse({ key: newId(), name: 'Acme Labs', slug: 'acme', createdAt: now, updatedAt: now });
  const founder = userSchema.parse({ key: newId(), teamKey: rootTeam.key, currentScopeKey: newId(), email: 'founder@example.com', emailHash: 'h1', name: 'Founder One', createdAt: now, updatedAt: now });
  const outsider = userSchema.parse({ key: newId(), teamKey: otherTeam.key, currentScopeKey: newId(), email: 'outsider@example.com', emailHash: 'h2', createdAt: now, updatedAt: now });
  const founderRootMembership = userTeamSchema.parse({ key: newId(), teamKey: rootTeam.key, userId: founder.key, teamRole: 'owner', teamTitle: 'CEO', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
  const outsiderMembership = userTeamSchema.parse({ key: newId(), teamKey: otherTeam.key, userId: outsider.key, teamRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });

  const nexus = scopeSchema.parse({ key: newId(), teamKey: rootTeam.key, slug: 'nexus', name: 'Nexus', summary: 'Root scope', description: 'Root scope', position: 1 });
  const core = scopeSchema.parse({ key: newId(), teamKey: rootTeam.key, slug: 'core', name: 'Core', summary: 'Core scope', description: 'Core scope', position: 2 });
  const launch = scopeSchema.parse({ key: newId(), teamKey: rootTeam.key, slug: 'launch', name: 'Launch', summary: 'Launch scope', description: 'Launch scope', position: 3 });
  const agentBuilder = scopeSchema.parse({ key: newId(), teamKey: rootTeam.key, slug: 'agent-builder', name: 'Agent Builder', summary: 'Legacy agent builder scope', description: 'Legacy agent builder scope', position: 4 });
  const foreignScope = scopeSchema.parse({ key: newId(), teamKey: otherTeam.key, slug: 'ops', name: 'Ops', summary: 'Foreign scope', description: 'Foreign scope', position: 1 });
  const relations = [
    scopeScopeSchema.parse({ key: newId(), parentKey: nexus.key, childKey: core.key }),
    scopeScopeSchema.parse({ key: newId(), parentKey: nexus.key, childKey: launch.key }),
    scopeScopeSchema.parse({ key: newId(), parentKey: nexus.key, childKey: agentBuilder.key }),
  ];

  const state: FixtureState = {
    users: [founder, outsider],
    teams: [rootTeam, otherTeam],
    rootTeam,
    memberships: [founderRootMembership, outsiderMembership],
    scopes: [nexus, core, launch, agentBuilder, foreignScope],
    relations,
    scopeMembers: [],
  };
  return { state, source: sourceFor(state), rootTeam, otherTeam, founder, outsider, founderRootMembership, outsiderMembership, nexus, core, launch, agentBuilder, foreignScope };
}

describe('requireFoundersGateAccess', () => {
  test('grants access to an active root-team member', async () => {
    const f = fixture();
    const access = await requireFoundersGateAccess(f.founder.key, f.source);
    expect(access.user.key).toBe(f.founder.key);
    expect(access.rootTeam.key).toBe(f.rootTeam.key);
    expect(access.rootMembership.teamRole).toBe('owner');
  });

  test('rejects a user with no root-team membership', async () => {
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

describe('listAccessibleTeams', () => {
  test('lists only teams with an active membership', async () => {
    const f = fixture();
    const membership = userTeamSchema.parse({ key: newId(), teamKey: f.otherTeam.key, userId: f.founder.key, teamRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(membership);
    const options = await listAccessibleTeams(f.founder.key, f.source);
    expect(options.map(({ key }) => key).sort()).toEqual([f.rootTeam.key, f.otherTeam.key].sort());
    expect(options.find(({ key }) => key === f.otherTeam.key)?.alias).toBe('acme');
  });

  test('omits suspended memberships and inactive teams', async () => {
    const f = fixture();
    f.state.teams = f.state.teams.map((team) =>
      team.key === f.rootTeam.key ? { ...team, isActive: false } : team);
    const options = await listAccessibleTeams(f.founder.key, f.source);
    expect(options).toEqual([]);
  });
});

describe('requireTeamAccess', () => {
  test('rejects a user who is not a member of the team', async () => {
    const f = fixture();
    await expect(requireTeamAccess(f.founder.key, f.otherTeam.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);
  });

  test('accepts an active member and returns canonical records', async () => {
    const f = fixture();
    const access = await requireTeamAccess(f.founder.key, f.rootTeam.key, f.source);
    expect(access.team.key).toBe(f.rootTeam.key);
    expect(access.membership.key).toBe(f.founderRootMembership.key);
  });
});

describe('requireScopeAccess', () => {
  test('an owner may access every scope in their team', async () => {
    const f = fixture();
    const access = await requireScopeAccess(f.founderRootMembership, f.core.key, f.source);
    expect(access.scope.key).toBe(f.core.key);
  });

  test('rejects a scope belonging to another team', async () => {
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
    const memberMembership = userTeamSchema.parse({ key: newId(), teamKey: f.rootTeam.key, userId: f.outsider.key, teamRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    await expect(requireScopeAccess(memberMembership, f.core.key, f.source)).rejects.toBeInstanceOf(FoundersAccessError);

    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.core.key, userTeamKey: memberMembership.key, role: 'viewer' }));
    const access = await requireScopeAccess(memberMembership, f.core.key, f.source);
    expect(access.scope.key).toBe(f.core.key);
  });
});

describe('listAccessibleScopes', () => {
  test('an owner sees every scope in hierarchy order with paths', async () => {
    const f = fixture();
    const options = await listAccessibleScopes(f.founderRootMembership, f.source);
    expect(options.map(({ key }) => key)).toEqual([f.nexus.key, f.core.key, f.launch.key]);
    expect(options[0]).toMatchObject({ parentKey: null, path: ['Nexus'] });
    expect(options[1]).toMatchObject({ parentKey: f.nexus.key, path: ['Nexus', 'Core'] });
    expect(options[2]).toMatchObject({ parentKey: f.nexus.key, path: ['Nexus', 'Launch'] });
  });

  test('omits the legacy Agent Builder scope', async () => {
    const f = fixture();

    expect((await listAccessibleScopes(f.founderRootMembership, f.source)).map(({ key }) => key)).not.toContain(f.agentBuilder.key);
  });

  test('exposes a parent when a plain member is assigned to it', async () => {
    const f = fixture();
    const memberMembership = userTeamSchema.parse({ key: newId(), teamKey: f.rootTeam.key, userId: f.outsider.key, teamRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.nexus.key, userTeamKey: memberMembership.key, role: 'viewer' }));
    expect((await listAccessibleScopes(memberMembership, f.source)).map(({ key }) => key)).toEqual([f.nexus.key]);
  });

  test('a plain member sees only scopes they were explicitly added to', async () => {
    const f = fixture();
    const memberMembership = userTeamSchema.parse({ key: newId(), teamKey: f.rootTeam.key, userId: f.outsider.key, teamRole: 'member', status: 'active', joinedAt: now, createdAt: now, updatedAt: now });
    f.state.memberships.push(memberMembership);
    f.state.scopeMembers.push(scopeMemberSchema.parse({ key: newId(), scopeKey: f.launch.key, userTeamKey: memberMembership.key, role: 'viewer' }));
    const options = await listAccessibleScopes(memberMembership, f.source);
    expect(options.map(({ key }) => key)).toEqual([f.launch.key]);
    expect(options[0]?.path).toEqual(['Nexus', 'Launch']);
  });

  test('returns an empty list when the team has no scopes', async () => {
    const f = fixture();
    f.state.scopes = [];
    const options = await listAccessibleScopes(f.founderRootMembership, f.source);
    expect(options).toEqual([]);
  });
});
