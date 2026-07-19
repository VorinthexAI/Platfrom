import { db } from '@/lib/db/client';
import type { DomainToolContext } from './execute';
import { DomainToolExecutionError } from './execute';

export const accessRoleRank = { owner: 4, admin: 3, moderator: 2, viewer: 1 } as const;
export type AccessRole = keyof typeof accessRoleRank;
export const rankAccessRole = (role: unknown) => typeof role === 'string' && role in accessRoleRank ? accessRoleRank[role as AccessRole] : 0;

export interface OrganizationRecord { key: string; name: string; slug: string | null; description: string | null; is_root: boolean; isActive: boolean; createdAt: string; updatedAt: string; metadata: Record<string, unknown> }
export interface MembershipRecord { key: string; organizationId: string; userId: string; orgRole: string; status: string; user: { key: string; name: string | null; email: string; alias: string | null } }
export interface ScopeRecord { key: string; organizationKey: string; slug: string; name: string; deletedAt: string | null }
export interface ScopeAgentRecord { key: string; organizationKey: string; scopeKey: string; agentKey: string; position: number; status: 'active' | 'archived'; minimumAccessRole: AccessRole; createdByUserOrganizationKey: string | null; createdAt: string; updatedAt: string }
export interface AgentRecord { key: string; slug: string; name: string; title: string; scopeKey: string }

export type OrganizationDecisionReason = 'ALLOWED' | 'UNAUTHENTICATED' | 'MEMBERSHIP_NOT_FOUND' | 'MEMBERSHIP_SUSPENDED' | 'ORGANIZATION_ARCHIVED' | 'INSUFFICIENT_ROLE' | 'ACTION_DENIED';
export interface OrganizationAccessDecision { allowed: boolean; reason: OrganizationDecisionReason; effectiveRole: AccessRole | null; organization: OrganizationRecord; membership: MembershipRecord | null }
export interface ScopeAccessDecision { allowed: boolean; reason: string; effectiveRole: AccessRole | null; accessSources: Array<'organization-role' | 'direct-scope-membership' | 'inherited-scope-membership'>; organizationDecision: OrganizationAccessDecision; scope: ScopeRecord }
export interface AgentAccessDecision { allowed: boolean; reason: 'ALLOWED' | 'ORGANIZATION_ACCESS_DENIED' | 'SCOPE_ACCESS_DENIED' | 'AGENT_NOT_IN_SCOPE' | 'SCOPE_AGENT_ARCHIVED' | 'AGENT_MEMBER_NOT_FOUND' | 'SYSTEM_AGENT_POLICY_DENIED' | 'ACTION_DENIED'; effectiveScopeRole: AccessRole | null; agentAccessSources: Array<'inherited' | 'explicit' | 'system'>; scopeDecision: ScopeAccessDecision; scopeAgent: ScopeAgentRecord | null; agent: AgentRecord | null }

async function one<T>(query: string, bindVars: Record<string, unknown>): Promise<T | null> {
  const cursor = await db.query<T>(query, bindVars);
  return await cursor.next() ?? null;
}

export async function getActiveOrganization(context: DomainToolContext): Promise<OrganizationRecord> {
  const organization = await one<OrganizationRecord>('FOR organization IN organizations FILTER organization._key == @key LIMIT 1 RETURN MERGE(organization, { key: organization._key })', { key: context.organizationKey });
  if (!organization) throw new DomainToolExecutionError('organization_not_found', 'The active organization no longer exists');
  return organization;
}

export async function resolveMembership(context: DomainToolContext, reference?: string): Promise<MembershipRecord | null> {
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
  if (matches.length > 1) throw new DomainToolExecutionError('member_ambiguous', `${reference} resolved to multiple organization members`);
  return matches[0] ?? null;
}

export async function resolveScope(context: DomainToolContext, reference: string): Promise<ScopeRecord> {
  const needle = reference.toLocaleLowerCase();
  const cursor = await db.query<ScopeRecord>('FOR scope IN scopes FILTER scope.organizationKey == @organizationKey FILTER scope._key == @reference || LOWER(scope.slug) == @needle || LOWER(scope.name) == @needle RETURN MERGE(scope, { key: scope._key })', { organizationKey: context.organizationKey, reference, needle });
  const matches = await cursor.all();
  if (matches.length !== 1) throw new DomainToolExecutionError(matches.length ? 'scope_ambiguous' : 'scope_not_found', `${reference} resolved to ${matches.length} scopes`);
  return matches[0]!;
}

export async function resolveAgentInOrganization(context: DomainToolContext, reference: string): Promise<AgentRecord> {
  const needle = reference.toLocaleLowerCase();
  const cursor = await db.query<AgentRecord>(`
    FOR agent IN agents
      FOR home IN scopes FILTER home._key == agent.scopeKey && home.organizationKey == @organizationKey
      FILTER agent._key == @reference || LOWER(agent.slug) == @needle || LOWER(agent.name) == @needle
      RETURN MERGE(agent, { key: agent._key })
  `, { organizationKey: context.organizationKey, reference, needle });
  const matches = await cursor.all();
  if (matches.length !== 1) throw new DomainToolExecutionError(matches.length ? 'agent_ambiguous' : 'agent_not_found', `${reference} resolved to ${matches.length} agents`);
  return matches[0]!;
}

export async function getScopeAgent(scopeKey: string, agentKey: string): Promise<ScopeAgentRecord | null> {
  return one<ScopeAgentRecord>('FOR link IN scopeAgents FILTER link.scopeKey == @scopeKey && link.agentKey == @agentKey LIMIT 1 RETURN MERGE(link, { key: link._key })', { scopeKey, agentKey });
}

function organizationActionAllowed(role: AccessRole, action?: string) {
  if (!action || action.endsWith('.read') || action.endsWith('.list') || action.includes('.evaluate') || action.includes('.explain')) return true;
  if (action.startsWith('organization.provider.')) return role === 'owner';
  if (action === 'organization.archive' || action === 'organization.restore' || action.endsWith('.remove')) return role === 'owner';
  return role === 'owner' || role === 'admin';
}

export async function evaluateOrganizationAccess(context: DomainToolContext, input: { organization?: string; member?: string; action?: string }): Promise<OrganizationAccessDecision> {
  const organization = await getActiveOrganization(context);
  if (input.organization && ![organization.key, organization.name.toLocaleLowerCase(), organization.slug?.toLocaleLowerCase()].includes(input.organization.toLocaleLowerCase())) throw new DomainToolExecutionError('organization_forbidden', 'Only the active organization may be evaluated');
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

export async function evaluateScopeAccess(context: DomainToolContext, input: { scope: string; member?: string; action?: string }): Promise<ScopeAccessDecision> {
  const scope = await resolveScope(context, input.scope);
  const organizationDecision = await evaluateOrganizationAccess(context, { member: input.member });
  if (!organizationDecision.allowed) return { allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED', effectiveRole: organizationDecision.effectiveRole, accessSources: [], organizationDecision, scope };
  if (scope.deletedAt) return { allowed: false, reason: 'SCOPE_ARCHIVED', effectiveRole: null, accessSources: [], organizationDecision, scope };
  const membership = organizationDecision.membership!;
  if (organizationDecision.effectiveRole === 'owner' || organizationDecision.effectiveRole === 'admin') {
    const role = organizationDecision.effectiveRole;
    return { allowed: scopeActionAllowed(role, input.action), reason: scopeActionAllowed(role, input.action) ? 'ALLOWED' : 'ACTION_DENIED', effectiveRole: role, accessSources: ['organization-role'], organizationDecision, scope };
  }
  const hierarchy = await one<{ members: Array<{ scopeKey: string; role: AccessRole }>; relations: Array<{ parentKey: string; childKey: string }> }>('RETURN { members: (FOR member IN scopeMembers FILTER member.userOrganizationKey == @membershipKey && member.status == "active" RETURN { scopeKey: member.scopeKey, role: member.role }), relations: (FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }) }', { membershipKey: membership.key });
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

export async function evaluateAgentAccess(context: DomainToolContext, input: { scope: string; agent: string; member?: string; action?: 'read' | 'run' | 'delegate' | 'manage' }): Promise<AgentAccessDecision> {
  const scopeDecision = await evaluateScopeAccess(context, { scope: input.scope, member: input.member, action: input.action === 'manage' ? 'scope.agent.manage' : 'read' });
  const base = { effectiveScopeRole: scopeDecision.effectiveRole, agentAccessSources: [] as AgentAccessDecision['agentAccessSources'], scopeDecision };
  if (!scopeDecision.organizationDecision.allowed) return { ...base, allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED', scopeAgent: null, agent: null };
  if (!scopeDecision.allowed) return { ...base, allowed: false, reason: 'SCOPE_ACCESS_DENIED', scopeAgent: null, agent: null };
  const agent = await resolveAgentInOrganization(context, input.agent);
  const scopeAgent = await getScopeAgent(scopeDecision.scope.key, agent.key);
  if (!scopeAgent) return { ...base, allowed: false, reason: 'AGENT_NOT_IN_SCOPE', scopeAgent: null, agent };
  if (scopeAgent.status !== 'active') return { ...base, allowed: false, reason: 'SCOPE_AGENT_ARCHIVED', scopeAgent, agent };
  if ((['genesis', 'beacon'].includes(agent.slug) || agent.slug.startsWith('system-')) && scopeDecision.effectiveRole !== 'owner') return { ...base, allowed: false, reason: 'SYSTEM_AGENT_POLICY_DENIED', scopeAgent, agent };
  if (input.action === 'manage') return { ...base, allowed: rankAccessRole(scopeDecision.effectiveRole) >= accessRoleRank.admin, reason: rankAccessRole(scopeDecision.effectiveRole) >= accessRoleRank.admin ? 'ALLOWED' : 'ACTION_DENIED', scopeAgent, agent };
  const membershipKey = scopeDecision.organizationDecision.membership!.key;
  const cursor = await db.query<{ source: 'inherited' | 'explicit' }>('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @scopeAgentKey && grant.userOrganizationKey == @membershipKey RETURN { source: grant.source }', { scopeAgentKey: scopeAgent.key, membershipKey });
  const sources = [...new Set((await cursor.all()).map((grant) => grant.source))] as AgentAccessDecision['agentAccessSources'];
  if (sources.length === 0) return { ...base, allowed: false, reason: 'AGENT_MEMBER_NOT_FOUND', agentAccessSources: sources, scopeAgent, agent };
  if (!sources.includes('explicit') && rankAccessRole(scopeDecision.effectiveRole) < rankAccessRole(scopeAgent.minimumAccessRole)) return { ...base, allowed: false, reason: 'AGENT_MEMBER_NOT_FOUND', agentAccessSources: [], scopeAgent, agent };
  return { ...base, allowed: true, reason: 'ALLOWED', agentAccessSources: sources, scopeAgent, agent };
}

export function explainOrganizationDecision(decision: OrganizationAccessDecision) {
  const member = decision.membership?.user.name ?? decision.membership?.user.email ?? 'Användaren';
  const messages: Record<OrganizationDecisionReason, string> = {
    ALLOWED: `${member} har aktivt medlemskap som ${decision.effectiveRole} och får utföra åtgärden.`,
    UNAUTHENTICATED: 'Ingen autentiserad organisationsmedlem kunde identifieras.',
    MEMBERSHIP_NOT_FOUND: 'Användaren är inte medlem i den aktiva organisationen.',
    MEMBERSHIP_SUSPENDED: `${member} är medlem men medlemskapet är ${decision.membership?.status}; aktivera medlemskapet för att återställa åtkomst.`,
    ORGANIZATION_ARCHIVED: `${decision.organization.name} är arkiverad och blockerar operativ åtkomst.`,
    INSUFFICIENT_ROLE: `${member} saknar en giltig organisationsroll.`,
    ACTION_DENIED: `${member} har rollen ${decision.effectiveRole}, som inte tillåter den begärda åtgärden.`,
  };
  return messages[decision.reason];
}

export function explainScopeDecision(decision: ScopeAccessDecision) {
  if (!decision.organizationDecision.allowed) return explainOrganizationDecision(decision.organizationDecision);
  if (decision.reason === 'SCOPE_ARCHIVED') return `${decision.scope.name} är arkiverat och kan därför inte användas operativt.`;
  if (!decision.effectiveRole) return `Medlemmen saknar direkt eller ärvd access till ${decision.scope.name}.`;
  const source = decision.accessSources.join(' och ') || 'okänd källa';
  return decision.allowed ? `Medlemmen har ${decision.effectiveRole}-access till ${decision.scope.name} genom ${source}.` : `Medlemmen har ${decision.effectiveRole}-access genom ${source}, men rollen tillåter inte den begärda åtgärden.`;
}

export function explainAgentDecision(decision: AgentAccessDecision) {
  if (decision.reason === 'ORGANIZATION_ACCESS_DENIED' || decision.reason === 'SCOPE_ACCESS_DENIED') return explainScopeDecision(decision.scopeDecision);
  if (decision.reason === 'AGENT_NOT_IN_SCOPE') return 'Agenten är inte kopplad till det valda scopet.';
  if (decision.reason === 'SCOPE_AGENT_ARCHIVED') return 'Relationen mellan scopet och agenten är arkiverad, så körning och delegation är blockerad.';
  if (decision.reason === 'AGENT_MEMBER_NOT_FOUND') return `Medlemmen har ${decision.effectiveScopeRole ?? 'ingen'} scope-roll, agenten kräver minst ${decision.scopeAgent?.minimumAccessRole ?? 'en giltig roll'} för inherited access och ingen giltig explicit grant finns.`;
  if (decision.reason === 'SYSTEM_AGENT_POLICY_DENIED') return 'Agenten omfattas av systemagent-policy och kräver owner-access.';
  if (decision.reason === 'ACTION_DENIED') return `Medlemmen har ${decision.effectiveScopeRole ?? 'ingen'} scope-roll men får inte administrera agenten.`;
  return `Agentåtkomst är tillåten genom ${decision.agentAccessSources.join(' och ')} access.`;
}
