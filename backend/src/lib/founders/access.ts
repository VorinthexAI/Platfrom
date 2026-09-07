import { getRootTeam, getTeamById, type Team } from '@/lib/db/teams.node';
import { getUserById, type User } from '@/lib/db/users.node';
import {
  getUserTeamByTeamAndUser,
  listActiveUserTeamsByUser,
  type UserTeam,
} from '@/lib/db/user-team.node';
import {
  getDefaultScopeMemberRepository,
  getDefaultScopeRepository,
  type Scope,
  type ScopeMember,
  type ScopeScope,
} from '@/lib/ai/scopes';

/**
 * Founders Gate authorization. One canonical rule set, resolved entirely
 * from persisted database state — no client-supplied team, scope,
 * role, or membership claim is ever trusted:
 *
 *   1. The user must hold an ACTIVE membership in the root team
 *      (`is_root == true`) to enter Founders Gate at all.
 *   2. Every team they interact with requires its own active
 *      membership.
 *   3. A scope is accessible when the membership's team role is
 *      owner/admin (team-wide stewardship) or the membership is an
 *      explicit scope member.
 */

export type FoundersAccessDenialCode =
  | 'user_not_found'
  | 'not_root_member'
  | 'team_forbidden'
  | 'scope_forbidden';

export class FoundersAccessError extends Error {
  constructor(readonly code: FoundersAccessDenialCode, message: string) {
    super(message);
    this.name = 'FoundersAccessError';
  }
}

export interface FoundersAccessDataSource {
  getUser(key: string): Promise<User | null>;
  getRootTeam(): Promise<Team | null>;
  getTeam(key: string): Promise<Team | null>;
  getMembership(teamKey: string, userId: string): Promise<UserTeam | null>;
  listActiveMemberships(userId: string): Promise<UserTeam[]>;
  listScopes(teamKey: string): Promise<readonly Scope[]>;
  listChildRelations(parentKey: string): Promise<readonly ScopeScope[]>;
  getScope(scopeKey: string): Promise<Scope | null>;
  listScopeMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
}

const defaultDataSource: FoundersAccessDataSource = {
  getUser: getUserById,
  getRootTeam,
  getTeam: getTeamById,
  getMembership: getUserTeamByTeamAndUser,
  listActiveMemberships: listActiveUserTeamsByUser,
  listScopes: (teamKey) => getDefaultScopeRepository().listScopes(teamKey),
  listChildRelations: (parentKey) => getDefaultScopeRepository().listChildRelations(parentKey),
  getScope: (scopeKey) => getDefaultScopeRepository().getScopeByKey(scopeKey),
  listScopeMembers: (scopeKey) => getDefaultScopeMemberRepository().listMembers(scopeKey),
};

export interface FoundersGateAccess {
  user: User;
  rootTeam: Team;
  rootMembership: UserTeam;
}

/** Gate check: authenticated user must be an active root-team member. */
export async function requireFoundersGateAccess(
  userId: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<FoundersGateAccess> {
  const user = await source.getUser(userId);
  if (!user) throw new FoundersAccessError('user_not_found', `user ${userId} was not found`);
  const rootTeam = await source.getRootTeam();
  if (!rootTeam || rootTeam.isActive === false) {
    throw new FoundersAccessError('not_root_member', 'no active root team exists');
  }
  const rootMembership = await source.getMembership(rootTeam.key, user.key);
  if (!rootMembership || rootMembership.status !== 'active') {
    throw new FoundersAccessError('not_root_member', `user ${userId} has no active root team membership`);
  }
  return { user, rootTeam, rootMembership };
}

export interface AccessibleTeamOption {
  key: string;
  name: string;
  alias: string | null;
  role: UserTeam['teamRole'];
}

/** Teams the user may select: their own active memberships only. */
export async function listAccessibleTeams(
  userId: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<AccessibleTeamOption[]> {
  const memberships = await source.listActiveMemberships(userId);
  const options: AccessibleTeamOption[] = [];
  for (const membership of memberships) {
    const team = await source.getTeam(membership.teamKey);
    if (!team || team.isActive === false) continue;
    options.push({
      key: team.key,
      name: team.name,
      alias: team.slug ?? null,
      role: membership.teamRole,
    });
  }
  options.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
  return options;
}

export interface TeamAccess {
  team: Team;
  membership: UserTeam;
}

/** The selected team must be active and hold an active membership for the user. */
export async function requireTeamAccess(
  userId: string,
  teamKey: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<TeamAccess> {
  const membership = await source.getMembership(teamKey, userId);
  const team = membership ? await source.getTeam(teamKey) : null;
  if (!membership || membership.status !== 'active' || !team || team.isActive === false) {
    throw new FoundersAccessError('team_forbidden', `user ${userId} may not access team ${teamKey}`);
  }
  return { team, membership };
}

function membershipStewardsTeam(membership: UserTeam): boolean {
  return membership.teamRole === 'owner' || membership.teamRole === 'admin';
}

async function membershipCanAccessScope(
  membership: UserTeam,
  scope: Scope,
  source: FoundersAccessDataSource,
): Promise<boolean> {
  if (scope.teamKey !== membership.teamKey) return false;
  if (membershipStewardsTeam(membership)) return true;
  const members = await source.listScopeMembers(scope.key);
  return members.some((member) => member.userTeamKey === membership.key);
}

export interface ScopeAccess {
  scope: Scope;
}

/** The selected scope must belong to the selected team and be accessible. */
export async function requireScopeAccess(
  membership: UserTeam,
  scopeKey: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<ScopeAccess> {
  const scope = await source.getScope(scopeKey);
  // Missing and forbidden scopes return the same denial so nothing leaks.
  if (!scope || !(await membershipCanAccessScope(membership, scope, source))) {
    throw new FoundersAccessError('scope_forbidden', `membership ${membership.key} may not access scope ${scopeKey}`);
  }
  return { scope };
}

export interface AccessibleScopeOption {
  key: string;
  name: string;
  position: number;
  level: number;
  parentKey: string | null;
  path: string[];
}

/**
 * Accessible scopes for the membership's team, ordered by hierarchy
 * (depth-first from the roots) then position then name.
 */
export async function listAccessibleScopes(
  membership: UserTeam,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<AccessibleScopeOption[]> {
  const scopes = await source.listScopes(membership.teamKey);
  if (scopes.length === 0) return [];
  const scopeKeys = new Set(scopes.map((scope) => scope.key));
  const parentByChild = new Map<string, string>();
  for (const scope of scopes) {
    for (const relation of await source.listChildRelations(scope.key)) {
      if (scopeKeys.has(relation.childKey)) {
        parentByChild.set(relation.childKey, relation.parentKey);
      }
    }
  }

  const byKey = new Map(scopes.map((scope) => [scope.key, scope]));
  const childrenOf = (parentKey: string | null) => scopes
    .filter((scope) => (parentByChild.get(scope.key) ?? null) === parentKey)
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name) || left.key.localeCompare(right.key));

  const pathOf = (scope: Scope): string[] => {
    const names: string[] = [];
    let current: Scope | undefined = scope;
    const seen = new Set<string>();
    while (current && !seen.has(current.key)) {
      seen.add(current.key);
      names.unshift(current.name);
      const parentKey = parentByChild.get(current.key);
      current = parentKey ? byKey.get(parentKey) : undefined;
    }
    return names;
  };

  const ordered: Scope[] = [];
  const visit = (parentKey: string | null) => {
    for (const scope of childrenOf(parentKey)) {
      ordered.push(scope);
      visit(scope.key);
    }
  };
  visit(null);
  // Any scope disconnected by a dangling relation still gets listed.
  for (const scope of scopes) if (!ordered.includes(scope)) ordered.push(scope);

  const stewards = membershipStewardsTeam(membership);
  const accessibleKeys = new Set<string>();
  if (!stewards) {
    for (const scope of ordered) {
      const members = await source.listScopeMembers(scope.key);
      if (members.some((member) => member.userTeamKey === membership.key)) accessibleKeys.add(scope.key);
    }
  }

  return ordered
    .filter((scope) => scope.slug !== 'agent-builder' && (stewards || accessibleKeys.has(scope.key)))
    .map((scope) => ({
      key: scope.key,
      name: scope.name,
      position: scope.position,
      level: scope.level,
      parentKey: parentByChild.get(scope.key) ?? null,
      path: pathOf(scope),
    }));
}
