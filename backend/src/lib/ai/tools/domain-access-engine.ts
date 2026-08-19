import { db } from '@/lib/db/client';
import { ToolExecutionError, type ToolContext } from './tool-context';

export const accessRoleRank = { owner: 4, admin: 3, moderator: 2, viewer: 1 } as const;
export type AccessRole = keyof typeof accessRoleRank;
export const rankAccessRole = (role: unknown) => typeof role === 'string' && role in accessRoleRank ? accessRoleRank[role as AccessRole] : 0;

export interface OrganizationRecord { key: string; name: string; slug: string | null; description: string | null; is_root: boolean; isActive: boolean; createdAt: string; updatedAt: string; metadata: Record<string, unknown> }
export interface MembershipRecord { key: string; organizationId: string; userId: string; orgRole: string; status: string; user: { key: string; name: string | null; email: string; alias: string | null } }
export interface ScopeRecord { key: string; organizationKey: string; slug: string; name: string }

export type OrganizationDecisionReason = 'ALLOWED' | 'UNAUTHENTICATED' | 'MEMBERSHIP_NOT_FOUND' | 'MEMBERSHIP_SUSPENDED' | 'ORGANIZATION_ARCHIVED' | 'INSUFFICIENT_ROLE' | 'ACTION_DENIED';
export interface OrganizationAccessDecision { allowed: boolean; reason: OrganizationDecisionReason; effectiveRole: AccessRole | null; organization: OrganizationRecord; membership: MembershipRecord | null }
export interface ScopeAccessDecision { allowed: boolean; reason: string; effectiveRole: AccessRole | null; accessSources: Array<'organization-role' | 'direct-scope-membership' | 'inherited-scope-membership'>; organizationDecision: OrganizationAccessDecision; scope: ScopeRecord }

async function one<T>(query: string, bindVars: Record<string, unknown>): Promise<T | null> {
  const cursor = await db.query<T>(query, bindVars);
  return await cursor.next() ?? null;
}

export async function getActiveOrganization(context: ToolContext): Promise<OrganizationRecord> {
  const organization = await one<OrganizationRecord>('FOR organization IN organizations FILTER organization._key == @key LIMIT 1 RETURN MERGE(organization, { key: organization._key })', { key: context.organizationKey });
  if (!organization) throw new ToolExecutionError('organization_not_found', 'The active organization no longer exists');
  return organization;
}

export async function resolveMembership(context: ToolContext, reference?: string): Promise<MembershipRecord | null> {
  const membershipKey = reference ?? (context.principal.kind === 'member' ? context.principal.userOrganization.key : null);
  if (!membershipKey) return null;
  const needle = membershipKey.toLocaleLowerCase();
  const cursor = await db.query<MembershipRecord>(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @organizationKey
      FOR user IN users FILTER user._key == membership.userId
      FILTER membership._key == @reference || user._key == @reference || LOWER(user.email) == @needle || LOWER(user.name) == @needle || LOWER(user.alias) == @needle || user.alias_slug == @needle
      RETURN { key: membership._key, organizationId: membership.organizationId, userId: membership.userId, orgRole: membership.orgRole, status: membership.status, user: { key: user._key, name: user.name, email: user.email, alias: user.alias } }
  `, { organizationKey: context.organizationKey, reference: membershipKey, needle });
  const matches = await cursor.all();
  if (matches.length > 1) throw new ToolExecutionError('member_ambiguous', `${reference} resolved to multiple organization members`);
  return matches[0] ?? null;
}

export async function resolveScope(context: ToolContext, reference: string): Promise<ScopeRecord> {
  const needle = reference.toLocaleLowerCase();
  const cursor = await db.query<ScopeRecord>('FOR scope IN scopes FILTER scope.organizationKey == @organizationKey FILTER scope._key == @reference || LOWER(scope.slug) == @needle || LOWER(scope.name) == @needle RETURN MERGE(scope, { key: scope._key })', { organizationKey: context.organizationKey, reference, needle });
  const matches = await cursor.all();
  if (matches.length !== 1) throw new ToolExecutionError(matches.length ? 'scope_ambiguous' : 'scope_not_found', `${reference} resolved to ${matches.length} scopes`);
  return matches[0]!;
}

function organizationActionAllowed(role: AccessRole, action?: string) {
  if (!action || action.endsWith('.read') || action.endsWith('.list') || action.includes('.evaluate') || action.includes('.explain')) return true;
  if (action.startsWith('organization.provider.')) return role === 'owner';
  if (action === 'organization.archive' || action === 'organization.restore' || action.endsWith('.remove')) return role === 'owner';
  return role === 'owner' || role === 'admin';
}

export async function evaluateOrganizationAccess(context: ToolContext, input: { organization?: string; member?: string; action?: string }): Promise<OrganizationAccessDecision> {
  const organization = await getActiveOrganization(context);
  if (input.organization && ![organization.key, organization.name.toLocaleLowerCase(), organization.slug?.toLocaleLowerCase()].includes(input.organization.toLocaleLowerCase())) throw new ToolExecutionError('organization_forbidden', 'Only the active organization may be evaluated');
  const membership = await resolveMembership(context, input.member);
  if (!membership) return { allowed: false, reason: input.member ? 'MEMBERSHIP_NOT_FOUND' : 'UNAUTHENTICATED', effectiveRole: null, organization, membership: null };
  const role = membership.orgRole === 'member' ? 'viewer' : membership.orgRole as AccessRole;
  if (membership.status !== 'active') return { allowed: false, reason: 'MEMBERSHIP_SUSPENDED', effectiveRole: role, organization, membership };
  if (!organization.isActive) return { allowed: false, reason: 'ORGANIZATION_ARCHIVED', effectiveRole: role, organization, membership };
  if (!rankAccessRole(role)) return { allowed: false, reason: 'INSUFFICIENT_ROLE', effectiveRole: null, organization, membership };
  if (!organizationActionAllowed(role, input.action)) return { allowed: false, reason: 'ACTION_DENIED', effectiveRole: role, organization, membership };
  return { allowed: true, reason: 'ALLOWED', effectiveRole: role, organization, membership };
}

function scopeActionAllowed(role: AccessRole, action?: string) {
  if (!action || action === 'read' || action.endsWith('.read') || action.endsWith('.list')) return true;
  if (action === 'scope.remove') return role === 'owner';
  if (action.includes('archive') || action.includes('restore') || action.includes('move') || action.includes('agent.') || action.includes('scope.member.')) return rankAccessRole(role) >= accessRoleRank.admin;
  return rankAccessRole(role) >= accessRoleRank.moderator;
}

export async function evaluateScopeAccess(context: ToolContext, input: { scope: string; member?: string; action?: string }): Promise<ScopeAccessDecision> {
  const scope = await resolveScope(context, input.scope);
  const organizationDecision = await evaluateOrganizationAccess(context, { member: input.member });
  if (!organizationDecision.allowed) return { allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED', effectiveRole: organizationDecision.effectiveRole, accessSources: [], organizationDecision, scope };
  const membership = organizationDecision.membership!;
  if (organizationDecision.effectiveRole === 'owner' || organizationDecision.effectiveRole === 'admin') {
    const role = organizationDecision.effectiveRole;
    return { allowed: scopeActionAllowed(role, input.action), reason: scopeActionAllowed(role, input.action) ? 'ALLOWED' : 'ACTION_DENIED', effectiveRole: role, accessSources: ['organization-role'], organizationDecision, scope };
  }
  const hierarchy = await one<{ members: Array<{ scopeKey: string; role: AccessRole }>; relations: Array<{ parentKey: string; childKey: string }> }>('RETURN { members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }', { membershipKey: membership.key });
  const parentByChild = new Map((hierarchy?.relations ?? []).map((relation) => [relation.childKey, relation.parentKey]));
  const ancestors = new Set<string>([scope.key]);
  let parent = parentByChild.get(scope.key);
  while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
  const grants = (hierarchy?.members ?? []).filter((member) => ancestors.has(member.scopeKey)).map((member) => ({ role: member.role, direct: member.scopeKey === scope.key }));
  grants.sort((a, b) => rankAccessRole(b.role) - rankAccessRole(a.role));
  const effective = grants[0]?.role ?? null;
  const sources: ScopeAccessDecision['accessSources'] = [];
  if (grants.some((grant) => grant.direct)) sources.push('direct-scope-membership');
  if (grants.some((grant) => !grant.direct)) sources.push('inherited-scope-membership');
  if (!effective) return { allowed: false, reason: 'SCOPE_MEMBERSHIP_NOT_FOUND', effectiveRole: null, accessSources: sources, organizationDecision, scope };
  const allowed = scopeActionAllowed(effective, input.action);
  return { allowed, reason: allowed ? 'ALLOWED' : 'ACTION_DENIED', effectiveRole: effective, accessSources: sources, organizationDecision, scope };
}
