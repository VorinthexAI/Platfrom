import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { ScopeMember, ScopeMemberRole } from '@/lib/ai/scopes';

/**
 * The one canonical rank mapping for the owner > admin > moderator > viewer
 * hierarchy. Every comparison in organization, scope, and agent authorization
 * must go through these helpers — never re-declare ranks in a service.
 */
export const roleRank = {
  viewer: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
} as const satisfies Record<ScopeMemberRole, number>;

export type RankedRole = keyof typeof roleRank;

export function roleAtLeast(role: RankedRole, minimum: RankedRole): boolean {
  return roleRank[role] >= roleRank[minimum];
}

export function highestRole(...roles: ReadonlyArray<RankedRole | null | undefined>): RankedRole | null {
  let best: RankedRole | null = null;
  for (const role of roles) {
    if (!role) continue;
    if (!best || roleRank[role] > roleRank[best]) best = role;
  }
  return best;
}

/**
 * Authority an organization role carries inside every scope of that
 * organization. Owners and admins steward the whole organization; plain
 * `member` and `viewer` org roles carry no implicit scope authority — they
 * only act through an explicit scopeMembers row.
 */
export function scopeAuthorityForOrgRole(orgRole: UserOrganization['orgRole']): RankedRole | null {
  if (orgRole === 'owner') return 'owner';
  if (orgRole === 'admin') return 'admin';
  return null;
}

export interface ResolveEffectiveScopeRoleInput {
  /** The caller's organization membership; must belong to the scope's organization. */
  userOrganization: Pick<UserOrganization, 'orgRole' | 'status'>;
  /** The caller's direct membership row in the scope, when one exists. */
  scopeMember: Pick<ScopeMember, 'role'> | null;
}

/**
 * The canonical effective-role resolver. The effective role is the highest
 * valid role granted by the applicable organization and scope relationships:
 *
 * 1. Organization owners remain owners throughout the organization.
 * 2. Organization admins retain admin authority throughout the organization.
 * 3. A scopeMembers row grants its role within that scope.
 * 4. A member with neither has no effective role (no scope access).
 *
 * Suspended memberships never resolve to a role.
 */
export function resolveEffectiveScopeRole(input: ResolveEffectiveScopeRoleInput): RankedRole | null {
  if (input.userOrganization.status !== 'active') return null;
  return highestRole(scopeAuthorityForOrgRole(input.userOrganization.orgRole), input.scopeMember?.role ?? null);
}
