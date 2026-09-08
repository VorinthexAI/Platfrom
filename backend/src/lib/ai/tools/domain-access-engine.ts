import { db } from '@/lib/db/client';
import { ToolExecutionError, type ToolContext } from './tool-context';

export const accessRoleRank = { owner: 4, admin: 3, moderator: 2, viewer: 1 } as const;
export type AccessRole = keyof typeof accessRoleRank;
export const rankAccessRole = (role: unknown) => typeof role === 'string' && role in accessRoleRank ? accessRoleRank[role as AccessRole] : 0;

export function hasExactTeamAssurance(
  context: Pick<ToolContext, 'teamAssurance'>,
  team: Pick<TeamRecord, 'mfa_enabled'>,
  membership: Pick<MembershipRecord, 'key' | 'isMfaEnabled' | 'teamMfaVersion'>,
) {
  return team.mfa_enabled !== true || (
    membership.isMfaEnabled === true
    && context.teamAssurance?.teamMembershipKey === membership.key
    && context.teamAssurance.teamMfaVersion === membership.teamMfaVersion
  );
}

export interface TeamRecord { key: string; name: string; slug: string | null; description: string | null; is_root: boolean; isActive: boolean; mfa_enabled: boolean; createdAt: string; updatedAt: string; metadata: Record<string, unknown> }
export interface MembershipRecord { key: string; teamKey: string; userId: string; teamRole: string; status: string; isMfaEnabled: boolean; teamMfaVersion: number; user: { key: string; name: string | null; email: string; alias: string | null } }
export interface ScopeRecord { key: string; teamKey: string; slug: string; name: string }

export type TeamDecisionReason = 'ALLOWED' | 'UNAUTHENTICATED' | 'MEMBERSHIP_NOT_FOUND' | 'MEMBERSHIP_SUSPENDED' | 'TEAM_ARCHIVED' | 'MFA_REQUIRED' | 'INSUFFICIENT_ROLE' | 'ACTION_DENIED';
export interface TeamAccessDecision { allowed: boolean; reason: TeamDecisionReason; effectiveRole: AccessRole | null; team: TeamRecord; membership: MembershipRecord | null }
export interface ScopeAccessDecision { allowed: boolean; reason: string; effectiveRole: AccessRole | null; accessSources: Array<'team-role' | 'direct-scope-membership' | 'inherited-scope-membership'>; teamDecision: TeamAccessDecision; scope: ScopeRecord }
export type ScopeMembershipAccess = Pick<ScopeAccessDecision, 'effectiveRole' | 'accessSources'> & { suspended: boolean };

export function resolveScopeMembershipAccess(
  scopeKey: string,
  directMembership: { role: AccessRole; status: string } | null,
  hierarchy: { members: Array<{ scopeKey: string; role: AccessRole }>; relations: Array<{ parentKey: string; childKey: string }> },
): ScopeMembershipAccess {
  if (directMembership?.status === 'suspended') return { suspended: true, effectiveRole: null, accessSources: ['direct-scope-membership'] };
  const parentByChild = new Map(hierarchy.relations.map((relation) => [relation.childKey, relation.parentKey]));
  const ancestors = new Set<string>([scopeKey]);
  let parent = parentByChild.get(scopeKey);
  while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
  const grants = hierarchy.members.filter((member) => ancestors.has(member.scopeKey)).map((member) => ({ role: member.role, direct: member.scopeKey === scopeKey }));
  grants.sort((a, b) => rankAccessRole(b.role) - rankAccessRole(a.role));
  const accessSources: ScopeAccessDecision['accessSources'] = [];
  if (grants.some((grant) => grant.direct)) accessSources.push('direct-scope-membership');
  if (grants.some((grant) => !grant.direct)) accessSources.push('inherited-scope-membership');
  return { suspended: false, effectiveRole: grants[0]?.role ?? null, accessSources };
}

async function one<T>(query: string, bindVars: Record<string, unknown>): Promise<T | null> {
  const cursor = await db.query<T>(query, bindVars);
  return await cursor.next() ?? null;
}

export async function getActiveTeam(context: ToolContext): Promise<TeamRecord> {
  const team = await one<TeamRecord>('FOR team IN teams FILTER team._key == @key LIMIT 1 RETURN MERGE(team, { key: team._key })', { key: context.teamKey });
  if (!team) throw new ToolExecutionError('team_not_found', 'The active team no longer exists');
  return team;
}

export async function resolveMembership(context: ToolContext, reference?: string): Promise<MembershipRecord | null> {
  const teamMembershipKey = reference ?? (context.principal.kind === 'member' ? context.principal.userTeam.key : null);
  if (!teamMembershipKey) return null;
  const needle = teamMembershipKey.toLocaleLowerCase();
  const cursor = await db.query<MembershipRecord>(`
    FOR membership IN userTeams
      FILTER membership.teamKey == @teamKey
      FOR user IN users FILTER user._key == membership.userId
      FILTER membership._key == @reference || user._key == @reference || LOWER(user.email) == @needle || LOWER(user.name) == @needle || LOWER(user.alias) == @needle || user.alias_slug == @needle
       RETURN { key: membership._key, teamKey: membership.teamKey, userId: membership.userId, teamRole: membership.teamRole, status: membership.status, isMfaEnabled: membership.isMfaEnabled == true, teamMfaVersion: HAS(membership, "teamMfaVersion") ? membership.teamMfaVersion : 0, user: { key: user._key, name: user.name, email: user.email, alias: user.alias } }
  `, { teamKey: context.teamKey, reference: teamMembershipKey, needle });
  const matches = await cursor.all();
  if (matches.length > 1) throw new ToolExecutionError('member_ambiguous', `${reference} resolved to multiple team members`);
  return matches[0] ?? null;
}

export async function resolveScope(context: ToolContext, reference: string): Promise<ScopeRecord> {
  const needle = reference.toLocaleLowerCase();
  const cursor = await db.query<ScopeRecord>('FOR scope IN scopes FILTER scope.teamKey == @teamKey FILTER scope._key == @reference || LOWER(scope.slug) == @needle || LOWER(scope.name) == @needle RETURN MERGE(scope, { key: scope._key })', { teamKey: context.teamKey, reference, needle });
  const matches = await cursor.all();
  if (matches.length !== 1) throw new ToolExecutionError(matches.length ? 'scope_ambiguous' : 'scope_not_found', `${reference} resolved to ${matches.length} scopes`);
  return matches[0]!;
}

function teamActionAllowed(role: AccessRole, action?: string) {
  if (!action || action.endsWith('.read') || action.endsWith('.list') || action.includes('.evaluate') || action.includes('.explain')) return true;
  if (action === 'team.archive' || action === 'team.restore' || action.endsWith('.remove')) return role === 'owner';
  return role === 'owner' || role === 'admin';
}

export async function evaluateTeamAccess(context: ToolContext, input: { team?: string; member?: string; action?: string }): Promise<TeamAccessDecision> {
  const team = await getActiveTeam(context);
  if (input.team && ![team.key, team.name.toLocaleLowerCase(), team.slug?.toLocaleLowerCase()].includes(input.team.toLocaleLowerCase())) throw new ToolExecutionError('team_forbidden', 'Only the active team may be evaluated');
  const membership = await resolveMembership(context, input.member);
  if (!membership) return { allowed: false, reason: input.member ? 'MEMBERSHIP_NOT_FOUND' : 'UNAUTHENTICATED', effectiveRole: null, team, membership: null };
  const role = membership.teamRole === 'member' ? 'viewer' : membership.teamRole as AccessRole;
  if (membership.status !== 'active') return { allowed: false, reason: 'MEMBERSHIP_SUSPENDED', effectiveRole: role, team, membership };
  if (!team.isActive) return { allowed: false, reason: 'TEAM_ARCHIVED', effectiveRole: role, team, membership };
  if (!hasExactTeamAssurance(context, team, membership)) return { allowed: false, reason: 'MFA_REQUIRED', effectiveRole: role, team, membership };
  if (!rankAccessRole(role)) return { allowed: false, reason: 'INSUFFICIENT_ROLE', effectiveRole: null, team, membership };
  if (!teamActionAllowed(role, input.action)) return { allowed: false, reason: 'ACTION_DENIED', effectiveRole: role, team, membership };
  return { allowed: true, reason: 'ALLOWED', effectiveRole: role, team, membership };
}

function scopeActionAllowed(role: AccessRole, action?: string) {
  if (!action || action === 'read' || action.endsWith('.read') || action.endsWith('.list')) return true;
  if (action === 'scope.remove') return role === 'owner';
  if (action.includes('archive') || action.includes('restore') || action.includes('move') || action.includes('agent.') || action.includes('scope.member.')) return rankAccessRole(role) >= accessRoleRank.admin;
  return rankAccessRole(role) >= accessRoleRank.moderator;
}

export async function evaluateScopeAccess(context: ToolContext, input: { scope: string; member?: string; action?: string }): Promise<ScopeAccessDecision> {
  const scope = await resolveScope(context, input.scope);
  const teamDecision = await evaluateTeamAccess(context, { member: input.member });
  if (!teamDecision.allowed) return { allowed: false, reason: 'TEAM_ACCESS_DENIED', effectiveRole: teamDecision.effectiveRole, accessSources: [], teamDecision, scope };
  const membership = teamDecision.membership!;
  const directMembership = await one<{ role: AccessRole; status: string }>('FOR member IN scopeMembers FILTER member.scopeKey == @scopeKey && member.userTeamKey == @teamMembershipKey LIMIT 1 RETURN { role: member.role, status: member.status }', { scopeKey: scope.key, teamMembershipKey: membership.key });
  if (directMembership?.status === 'suspended') return { allowed: false, reason: 'SCOPE_MEMBERSHIP_SUSPENDED', effectiveRole: null, accessSources: ['direct-scope-membership'], teamDecision, scope };
  if (teamDecision.effectiveRole === 'owner' || teamDecision.effectiveRole === 'admin') {
    const role = teamDecision.effectiveRole;
    return { allowed: scopeActionAllowed(role, input.action), reason: scopeActionAllowed(role, input.action) ? 'ALLOWED' : 'ACTION_DENIED', effectiveRole: role, accessSources: ['team-role'], teamDecision, scope };
  }
  const hierarchy = await one<{ members: Array<{ scopeKey: string; role: AccessRole }>; relations: Array<{ parentKey: string; childKey: string }> }>('RETURN { members: (FOR member IN scopeMembers FILTER member.userTeamKey == @teamMembershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }', { teamMembershipKey: membership.key });
  const membershipAccess = resolveScopeMembershipAccess(scope.key, directMembership, hierarchy ?? { members: [], relations: [] });
  const effective = membershipAccess.effectiveRole;
  if (!effective) return { allowed: false, reason: 'SCOPE_MEMBERSHIP_NOT_FOUND', effectiveRole: null, accessSources: membershipAccess.accessSources, teamDecision, scope };
  const allowed = scopeActionAllowed(effective, input.action);
  return { allowed, reason: allowed ? 'ALLOWED' : 'ACTION_DENIED', effectiveRole: effective, accessSources: membershipAccess.accessSources, teamDecision, scope };
}
