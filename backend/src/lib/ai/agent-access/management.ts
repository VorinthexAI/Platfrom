import { AiError } from '@/lib/ai/shared/result';
import { getAgentById, type Agent } from '@/lib/db/agents.node';
import {
  deleteAgentMember,
  ensureAgentMemberGrant,
  listAgentMemberGrants,
  listAgentMembersByAgent,
  type AgentMember,
  type AgentMemberSource,
} from '@/lib/db/agent-members.node';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getScopeAgentByPair, updateScopeAgent, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationById, getUserOrganizationByOrganizationAndUser, type UserOrganization } from '@/lib/db/user-organization.node';
import {
  getDefaultScopeMemberRepository,
  getDefaultScopeRepository,
  scopeMemberRoleSchema,
  type Scope,
  type ScopeMember,
  type ScopeMemberRole,
} from '@/lib/ai/scopes';
import {
  canManageAgentMembers,
  canUpdateAccessThreshold,
  evaluateAgentAccess,
  type AgentAccessDenialReason,
} from './authorization';
import { emitAgentAccessEvent, type AgentAccessEventEmitter } from './events';
import { resolveAgentSecurityPolicy } from './policy';
import { resolveEffectiveScopeRole, roleAtLeast, type RankedRole } from './roles';
import {
  createDefaultAgentAccessSyncDataSource,
  resolveEffectiveScopeMemberships,
  syncInheritedAgentMembersForScopeAgent,
  type AgentAccessSyncDataSource,
} from './sync';

export type AgentManagementDenialReason =
  | AgentAccessDenialReason
  | 'AGENT_MEMBER_MANAGE_DENIED'
  | 'AGENT_THRESHOLD_UPDATE_DENIED'
  | 'MEMBERSHIP_NOT_ELIGIBLE';

export class AgentManagementDeniedError extends AiError {
  constructor(readonly reason: AgentManagementDenialReason, detail: string) {
    super('agent_member_manage_denied', `Agent member management denied: ${detail}`);
  }
}

export interface AgentManagementDataSource {
  getUser(key: string): Promise<User | null>;
  getOrganization(key: string): Promise<Organization | null>;
  getMembership(organizationKey: string, userKey: string): Promise<UserOrganization | null>;
  getMembershipByKey(key: string): Promise<UserOrganization | null>;
  getScope(key: string): Promise<Scope | null>;
  getScopeMember(scopeKey: string, userOrganizationKey: string): Promise<ScopeMember | null>;
  getScopeAgent(scopeKey: string, agentKey: string): Promise<ScopeAgent | null>;
  getAgent(key: string): Promise<Agent | null>;
  listGrants(agentKey: string, userOrganizationKey: string): Promise<readonly AgentMember[]>;
  listAgentGrants(agentKey: string): Promise<readonly AgentMember[]>;
  ensureExplicitGrant(input: { agentKey: string; userOrganizationKey: string; scopeAgentKey: string; createdByUserOrganizationKey: string }): Promise<AgentMember>;
  deleteGrant(key: string): Promise<void>;
  updateScopeAgentThreshold(scopeAgentKey: string, minimumAccessRole: ScopeMemberRole): Promise<ScopeAgent>;
  sync: AgentAccessSyncDataSource;
  emitEvent: AgentAccessEventEmitter;
}

export function createDefaultAgentManagementDataSource(): AgentManagementDataSource {
  return {
    getUser: getUserById,
    getOrganization: getOrganizationById,
    getMembership: getUserOrganizationByOrganizationAndUser,
    getMembershipByKey: getUserOrganizationById,
    getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
    async getScopeMember(scopeKey, userOrganizationKey) {
      const members = await getDefaultScopeMemberRepository().listMembers(scopeKey);
      return members.find((member) => member.userOrganizationKey === userOrganizationKey) ?? null;
    },
    getScopeAgent: getScopeAgentByPair,
    getAgent: getAgentById,
    listGrants: listAgentMemberGrants,
    listAgentGrants: listAgentMembersByAgent,
    ensureExplicitGrant: (input) => ensureAgentMemberGrant({ ...input, source: 'explicit' }),
    deleteGrant: deleteAgentMember,
    updateScopeAgentThreshold: (scopeAgentKey, minimumAccessRole) =>
      updateScopeAgent(scopeAgentKey, { minimumAccessRole, updatedAt: new Date().toISOString() }),
    sync: createDefaultAgentAccessSyncDataSource(),
    emitEvent: emitAgentAccessEvent,
  };
}

let cachedDefaultSource: AgentManagementDataSource | null = null;
function defaultSource(): AgentManagementDataSource {
  cachedDefaultSource ??= createDefaultAgentManagementDataSource();
  return cachedDefaultSource;
}

export interface AgentManagementRequest {
  actorUserKey: string;
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
}

interface ManagementContext {
  organization: Organization;
  actorMembership: UserOrganization;
  actorEffectiveRole: RankedRole;
  scope: Scope;
  scopeAgent: ScopeAgent;
  agent: Agent;
}

/**
 * A member may manage explicit access only when they can access the
 * organization and scope, can access the agent themselves, and their
 * effective role satisfies the conservative owner/admin management policy.
 */
async function resolveManagementContext(
  request: AgentManagementRequest,
  source: AgentManagementDataSource,
): Promise<ManagementContext> {
  const user = await source.getUser(request.actorUserKey);
  if (!user) throw new AgentManagementDeniedError('UNAUTHENTICATED', `user ${request.actorUserKey} was not found`);
  const [organization, actorMembership] = await Promise.all([
    source.getOrganization(request.organizationKey),
    source.getMembership(request.organizationKey, request.actorUserKey),
  ]);
  if (!organization?.isActive || !actorMembership || actorMembership.status !== 'active') {
    throw new AgentManagementDeniedError('ORGANIZATION_ACCESS_DENIED', 'no active organization membership');
  }
  const scope = await source.getScope(request.scopeKey);
  if (!scope || scope.organizationKey !== organization.key) {
    throw new AgentManagementDeniedError('SCOPE_ACCESS_DENIED', `scope ${request.scopeKey} is not accessible`);
  }
  const actorScopeMember = await source.getScopeMember(scope.key, actorMembership.key);
  const actorEffectiveRole = resolveEffectiveScopeRole({ userOrganization: actorMembership, scopeMember: actorScopeMember });
  if (!actorEffectiveRole) {
    throw new AgentManagementDeniedError('SCOPE_ACCESS_DENIED', `membership ${actorMembership.key} has no scope access`);
  }
  const scopeAgent = await source.getScopeAgent(scope.key, request.agentKey);
  if (!scopeAgent) throw new AgentManagementDeniedError('AGENT_NOT_IN_SCOPE', `agent ${request.agentKey} is not linked to scope ${scope.key}`);
  const agent = await source.getAgent(request.agentKey);
  if (!agent) throw new AgentManagementDeniedError('AGENT_UNAVAILABLE', `agent ${request.agentKey} was not found`);

  if (!canManageAgentMembers({ effectiveRole: actorEffectiveRole })) {
    throw new AgentManagementDeniedError('AGENT_MEMBER_MANAGE_DENIED', `effective role ${actorEffectiveRole} may not manage agent members`);
  }
  const actorGrants = await source.listGrants(agent.key, actorMembership.key);
  const actorDecision = evaluateAgentAccess({
    organization,
    membership: actorMembership,
    scope,
    scopeMember: actorScopeMember,
    scopeAgent,
    agent,
    grants: actorGrants,
  });
  if (!actorDecision.allowed) {
    throw new AgentManagementDeniedError('AGENT_MEMBER_MANAGE_DENIED', `actor has no effective access to agent ${agent.key} (${actorDecision.reason})`);
  }
  return { organization, actorMembership, actorEffectiveRole, scope, scopeAgent, agent };
}

export interface GrantExplicitAccessInput extends AgentManagementRequest {
  targetUserOrganizationKey: string;
}

export interface GrantExplicitAccessResult {
  grant: AgentMember;
  alreadyGranted: boolean;
}

/**
 * Explicit grants broaden access to one selected member below the inherited
 * threshold without lowering the threshold itself. The target must already
 * belong to the organization and hold scope access — an explicit grant never
 * substitutes for organization membership, scope access, or platform policy.
 */
export async function grantExplicitAgentAccess(
  input: GrantExplicitAccessInput,
  source: AgentManagementDataSource = defaultSource(),
): Promise<GrantExplicitAccessResult> {
  const context = await resolveManagementContext(input, source);
  const target = await source.getMembershipByKey(input.targetUserOrganizationKey);
  if (!target || target.status !== 'active' || target.organizationId !== context.organization.key) {
    throw new AgentManagementDeniedError('MEMBERSHIP_NOT_ELIGIBLE', `membership ${input.targetUserOrganizationKey} is not an active member of organization ${context.organization.key}`);
  }
  const targetScopeMember = await source.getScopeMember(context.scope.key, target.key);
  const targetEffectiveRole = resolveEffectiveScopeRole({ userOrganization: target, scopeMember: targetScopeMember });
  if (!targetEffectiveRole) {
    throw new AgentManagementDeniedError('MEMBERSHIP_NOT_ELIGIBLE', `membership ${target.key} has no scope access; explicit agent access cannot create it`);
  }
  const policy = resolveAgentSecurityPolicy(context.agent);
  if (!roleAtLeast(targetEffectiveRole, policy.minimumCallerRole)) {
    throw new AgentManagementDeniedError('MEMBERSHIP_NOT_ELIGIBLE', `membership ${target.key} does not satisfy the agent security policy (minimum ${policy.minimumCallerRole})`);
  }

  const existing = await source.listGrants(context.agent.key, target.key);
  const alreadyGranted = existing.some((grant) => grant.source === 'explicit' && grant.scopeAgentKey === context.scopeAgent.key);
  const grant = await source.ensureExplicitGrant({
    agentKey: context.agent.key,
    userOrganizationKey: target.key,
    scopeAgentKey: context.scopeAgent.key,
    createdByUserOrganizationKey: context.actorMembership.key,
  });
  if (!alreadyGranted) {
    await source.emitEvent({
      scopeKey: context.scope.key,
      slug: 'agent.member.granted',
      data: { agentKey: context.agent.key, scopeAgentKey: context.scopeAgent.key, userOrganizationKey: target.key, source: 'explicit' },
    });
  }
  return { grant, alreadyGranted };
}

export interface RevokeExplicitAccessResult {
  explicitGrantRemoved: boolean;
  effectiveAccessRemaining: boolean;
  remainingSources: AgentMemberSource[];
}

/**
 * Removes only the explicit grant. When an inherited grant still covers the
 * member, the response says so — never report a full revocation while
 * another valid grant remains.
 */
export async function revokeExplicitAgentAccess(
  input: GrantExplicitAccessInput,
  source: AgentManagementDataSource = defaultSource(),
): Promise<RevokeExplicitAccessResult> {
  const context = await resolveManagementContext(input, source);
  const target = await source.getMembershipByKey(input.targetUserOrganizationKey);
  const grants = await source.listGrants(context.agent.key, input.targetUserOrganizationKey);
  const explicit = grants.filter((grant) => grant.source === 'explicit' && grant.scopeAgentKey === context.scopeAgent.key);
  for (const grant of explicit) await source.deleteGrant(grant.key);
  if (explicit.length > 0) {
    await source.emitEvent({
      scopeKey: context.scope.key,
      slug: 'agent.member.revoked',
      data: { agentKey: context.agent.key, scopeAgentKey: context.scopeAgent.key, userOrganizationKey: input.targetUserOrganizationKey, source: 'explicit' },
    });
  }

  const remainingSources = new Set<AgentMemberSource>();
  if (target && target.status === 'active' && target.organizationId === context.organization.key) {
    const targetScopeMember = await source.getScopeMember(context.scope.key, target.key);
    const targetEffectiveRole = resolveEffectiveScopeRole({ userOrganization: target, scopeMember: targetScopeMember });
    for (const grant of grants) {
      if (grant.source === 'explicit') continue;
      if (grant.scopeAgentKey !== context.scopeAgent.key) continue;
      if (targetEffectiveRole && roleAtLeast(targetEffectiveRole, context.scopeAgent.minimumAccessRole)) {
        remainingSources.add('inherited');
      }
    }
  }
  return {
    explicitGrantRemoved: explicit.length > 0,
    effectiveAccessRemaining: remainingSources.size > 0,
    remainingSources: [...remainingSources].sort(),
  };
}

export interface AgentMemberAccessView {
  userOrganizationKey: string;
  userKey: string | null;
  name: string | null;
  effectiveRole: RankedRole | null;
  inherited: boolean;
  explicit: boolean;
  effective: boolean;
}

/**
 * Access table for the management UI: everyone with scope access plus
 * everyone holding a grant, with inherited/explicit/effective columns.
 * The user-facing state stays binary — no agent-specific roles exist.
 */
export async function listAgentMemberAccess(
  input: AgentManagementRequest,
  source: AgentManagementDataSource = defaultSource(),
): Promise<{ minimumAccessRole: ScopeMemberRole; members: AgentMemberAccessView[] }> {
  const context = await resolveManagementContext(input, source);
  const policy = resolveAgentSecurityPolicy(context.agent);
  const grants = await source.listAgentGrants(context.agent.key);
  const scopeMemberships = await resolveEffectiveScopeMemberships(context.scope, source.sync);
  const effectiveRoleByMembership = new Map(scopeMemberships.map((row) => [row.membership.key, row.effectiveRole]));

  const membershipKeys = new Set<string>([
    ...scopeMemberships.map((row) => row.membership.key),
    ...grants.filter((grant) => grant.scopeAgentKey === context.scopeAgent.key).map((grant) => grant.userOrganizationKey),
  ]);

  const members: AgentMemberAccessView[] = [];
  for (const membershipKey of membershipKeys) {
    const membership = await source.getMembershipByKey(membershipKey);
    if (!membership || membership.organizationId !== context.organization.key) continue;
    const user = await source.getUser(membership.userId);
    const effectiveRole = effectiveRoleByMembership.get(membershipKey) ?? null;
    const memberGrants = grants.filter((grant) => grant.userOrganizationKey === membershipKey && grant.scopeAgentKey === context.scopeAgent.key);
    const inherited = memberGrants.some((grant) => grant.source === 'inherited')
      && !policy.requiresExplicitGrant
      && effectiveRole !== null
      && roleAtLeast(effectiveRole, context.scopeAgent.minimumAccessRole);
    const explicit = memberGrants.some((grant) => grant.source === 'explicit');
    const effective = membership.status === 'active'
      && effectiveRole !== null
      && (inherited || explicit)
      && (!policy.requiresExplicitGrant || explicit);
    members.push({
      userOrganizationKey: membershipKey,
      userKey: user?.key ?? null,
      name: user?.name ?? null,
      effectiveRole,
      inherited,
      explicit,
      effective,
    });
  }
  members.sort((left, right) => (left.name ?? '').localeCompare(right.name ?? '') || left.userOrganizationKey.localeCompare(right.userOrganizationKey));
  return { minimumAccessRole: context.scopeAgent.minimumAccessRole, members };
}

export interface UpdateAccessThresholdInput extends AgentManagementRequest {
  minimumAccessRole: ScopeMemberRole;
}

export interface UpdateAccessThresholdResult {
  scopeAgent: ScopeAgent;
  createdCount: number;
  removedCount: number;
}

/**
 * Owner-gated threshold change; a full inherited-grant synchronization runs
 * in the same call so lowering adds grants and raising removes only stale
 * inherited ones. Explicit grants are never mutated.
 */
export async function updateAgentAccessThreshold(
  input: UpdateAccessThresholdInput,
  source: AgentManagementDataSource = defaultSource(),
): Promise<UpdateAccessThresholdResult> {
  const context = await resolveManagementContext(input, source);
  if (!canUpdateAccessThreshold({ effectiveRole: context.actorEffectiveRole })) {
    throw new AgentManagementDeniedError('AGENT_THRESHOLD_UPDATE_DENIED', `effective role ${context.actorEffectiveRole} may not update the access threshold`);
  }
  const minimumAccessRole = scopeMemberRoleSchema.parse(input.minimumAccessRole);
  const scopeAgent = await source.updateScopeAgentThreshold(context.scopeAgent.key, minimumAccessRole);
  const syncResult = await syncInheritedAgentMembersForScopeAgent(scopeAgent.key, source.sync);
  await source.emitEvent({
    scopeKey: context.scope.key,
    slug: 'agent.access-threshold.updated',
    data: {
      agentKey: context.agent.key,
      scopeAgentKey: scopeAgent.key,
      minimumAccessRole,
      createdCount: syncResult.createdCount,
      removedCount: syncResult.removedCount,
    },
  });
  return { scopeAgent, createdCount: syncResult.createdCount, removedCount: syncResult.removedCount };
}
