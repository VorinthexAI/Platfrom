import { getRootOrganization, getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getUserById, type User } from '@/lib/db/users.node';
import {
  getUserOrganizationByOrganizationAndUser,
  listActiveUserOrganizationsByUser,
  type UserOrganization,
} from '@/lib/db/user-organization.node';
import {
  getDefaultScopeMemberRepository,
  getDefaultScopeRepository,
  type Scope,
  type ScopeMember,
  type ScopeScope,
} from '@/lib/ai/scopes';

/**
 * Founders Gate authorization. One canonical rule set, resolved entirely
 * from persisted database state — no client-supplied organization, scope,
 * role, or membership claim is ever trusted:
 *
 *   1. The user must hold an ACTIVE membership in the root organization
 *      (`is_root == true`) to enter Founders Gate at all.
 *   2. Every organization they interact with requires its own active
 *      membership.
 *   3. A scope is accessible when the membership's organization role is
 *      owner/admin (organization-wide stewardship) or the membership is an
 *      explicit scope member.
 */

export type FoundersAccessDenialCode =
  | 'user_not_found'
  | 'not_root_member'
  | 'organization_forbidden'
  | 'scope_forbidden';

export class FoundersAccessError extends Error {
  constructor(readonly code: FoundersAccessDenialCode, message: string) {
    super(message);
    this.name = 'FoundersAccessError';
  }
}

export interface FoundersAccessDataSource {
  getUser(key: string): Promise<User | null>;
  getRootOrganization(): Promise<Organization | null>;
  getOrganization(key: string): Promise<Organization | null>;
  getMembership(organizationKey: string, userId: string): Promise<UserOrganization | null>;
  listActiveMemberships(userId: string): Promise<UserOrganization[]>;
  listScopes(organizationKey: string): Promise<readonly Scope[]>;
  listChildRelations(parentKey: string): Promise<readonly ScopeScope[]>;
  getScope(scopeKey: string): Promise<Scope | null>;
  listScopeMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
}

const defaultDataSource: FoundersAccessDataSource = {
  getUser: getUserById,
  getRootOrganization,
  getOrganization: getOrganizationById,
  getMembership: getUserOrganizationByOrganizationAndUser,
  listActiveMemberships: listActiveUserOrganizationsByUser,
  listScopes: (organizationKey) => getDefaultScopeRepository().listScopes(organizationKey),
  listChildRelations: (parentKey) => getDefaultScopeRepository().listChildRelations(parentKey),
  getScope: (scopeKey) => getDefaultScopeRepository().getScopeByKey(scopeKey),
  listScopeMembers: (scopeKey) => getDefaultScopeMemberRepository().listMembers(scopeKey),
};

export interface FoundersGateAccess {
  user: User;
  rootOrganization: Organization;
  rootMembership: UserOrganization;
}

/** Gate check: authenticated user must be an active root-organization member. */
export async function requireFoundersGateAccess(
  userId: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<FoundersGateAccess> {
  const user = await source.getUser(userId);
  if (!user) throw new FoundersAccessError('user_not_found', `user ${userId} was not found`);
  const rootOrganization = await source.getRootOrganization();
  if (!rootOrganization || rootOrganization.isActive === false) {
    throw new FoundersAccessError('not_root_member', 'no active root organization exists');
  }
  const rootMembership = await source.getMembership(rootOrganization.key, user.key);
  if (!rootMembership || rootMembership.status !== 'active') {
    throw new FoundersAccessError('not_root_member', `user ${userId} has no active root organization membership`);
  }
  return { user, rootOrganization, rootMembership };
}

export interface AccessibleOrganizationOption {
  key: string;
  name: string;
  alias: string | null;
}

/** Organizations the user may select: their own active memberships only. */
export async function listAccessibleOrganizations(
  userId: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<AccessibleOrganizationOption[]> {
  const memberships = await source.listActiveMemberships(userId);
  const options: AccessibleOrganizationOption[] = [];
  for (const membership of memberships) {
    const organization = await source.getOrganization(membership.organizationId);
    if (!organization || organization.isActive === false) continue;
    options.push({ key: organization.key, name: organization.name, alias: organization.slug ?? null });
  }
  options.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
  return options;
}

export interface OrganizationAccess {
  organization: Organization;
  membership: UserOrganization;
}

/** The selected organization must be active and hold an active membership for the user. */
export async function requireOrganizationAccess(
  userId: string,
  organizationKey: string,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<OrganizationAccess> {
  const membership = await source.getMembership(organizationKey, userId);
  const organization = membership ? await source.getOrganization(organizationKey) : null;
  if (!membership || membership.status !== 'active' || !organization || organization.isActive === false) {
    throw new FoundersAccessError('organization_forbidden', `user ${userId} may not access organization ${organizationKey}`);
  }
  return { organization, membership };
}

function membershipStewardsOrganization(membership: UserOrganization): boolean {
  return membership.orgRole === 'owner' || membership.orgRole === 'admin';
}

async function membershipCanAccessScope(
  membership: UserOrganization,
  scope: Scope,
  source: FoundersAccessDataSource,
): Promise<boolean> {
  if (scope.organizationKey !== membership.organizationId) return false;
  if (membershipStewardsOrganization(membership)) return true;
  const members = await source.listScopeMembers(scope.key);
  return members.some((member) => member.userOrganizationKey === membership.key);
}

export interface ScopeAccess {
  scope: Scope;
}

/** The selected scope must belong to the selected organization and be accessible. */
export async function requireScopeAccess(
  membership: UserOrganization,
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
  parentKey: string | null;
  path: string[];
}

/**
 * Accessible leaf scopes for the membership's organization, ordered by
 * hierarchy (depth-first from the roots) then position then name. Parent
 * scopes organize the tree but are not selectable execution contexts.
 */
export async function listAccessibleScopes(
  membership: UserOrganization,
  source: FoundersAccessDataSource = defaultDataSource,
): Promise<AccessibleScopeOption[]> {
  const scopes = await source.listScopes(membership.organizationId);
  if (scopes.length === 0) return [];
  const scopeKeys = new Set(scopes.map((scope) => scope.key));
  const parentByChild = new Map<string, string>();
  const parentKeys = new Set<string>();
  for (const scope of scopes) {
    for (const relation of await source.listChildRelations(scope.key)) {
      if (scopeKeys.has(relation.childKey)) {
        parentByChild.set(relation.childKey, relation.parentKey);
        parentKeys.add(relation.parentKey);
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

  const stewards = membershipStewardsOrganization(membership);
  const accessibleKeys = new Set<string>();
  if (!stewards) {
    for (const scope of ordered) {
      const members = await source.listScopeMembers(scope.key);
      if (members.some((member) => member.userOrganizationKey === membership.key)) accessibleKeys.add(scope.key);
    }
  }

  return ordered
    .filter((scope) => !parentKeys.has(scope.key) && (stewards || accessibleKeys.has(scope.key)))
    .map((scope) => ({
      key: scope.key,
      name: scope.name,
      position: scope.position,
      parentKey: parentByChild.get(scope.key) ?? null,
      path: pathOf(scope),
    }));
}
