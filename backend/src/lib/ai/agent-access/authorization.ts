import { z } from 'zod';
import { getAgentById, type Agent } from '@/lib/db/agents.node';
import { getOrganizationById, type Organization } from '@/lib/db/organizations.node';
import { getScopeAgentByPair, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationByOrganizationAndUser, type UserOrganization } from '@/lib/db/user-organization.node';
import { listAgentMemberGrants, type AgentMember, type AgentMemberSource } from '@/lib/db/agent-members.node';
import { getDefaultScopeMemberRepository, getDefaultScopeRepository, type Scope, type ScopeMember } from '@/lib/ai/scopes';
import { resolveAgentSecurityPolicy } from './policy';
import { resolveEffectiveScopeRole, roleAtLeast, type RankedRole } from './roles';

export const AGENT_ACCESS_DENIAL_REASONS = [
  'UNAUTHENTICATED',
  'ORGANIZATION_ACCESS_DENIED',
  'SCOPE_ACCESS_DENIED',
  'AGENT_NOT_IN_SCOPE',
  'AGENT_ACCESS_DENIED',
  'AGENT_UNAVAILABLE',
] as const;
export type AgentAccessDenialReason = (typeof AGENT_ACCESS_DENIAL_REASONS)[number];

export type AgentAccessDecision =
  | {
    allowed: true;
    userOrganizationKey: string;
    effectiveRole: RankedRole;
    scopeAgentKey: string;
    grantSources: AgentMemberSource[];
  }
  | {
    allowed: false;
    reason: AgentAccessDenialReason;
  };

const keySchema = z.string().cuid();

export interface CanUserAccessAgentInput {
  userKey: string;
  organizationKey: string;
  scopeKey: string;
  agentKey: string;
  /** Set when another agent invokes this one on the user's behalf; policy may forbid delegation. */
  delegated?: boolean;
}

export interface AgentAccessDataSource {
  getUser(key: string): Promise<User | null>;
  getMembership(organizationKey: string, userKey: string): Promise<UserOrganization | null>;
  getOrganization(key: string): Promise<Organization | null>;
  getScope(key: string): Promise<Scope | null>;
  getScopeMember(scopeKey: string, userOrganizationKey: string): Promise<ScopeMember | null>;
  getScopeAgent(scopeKey: string, agentKey: string): Promise<ScopeAgent | null>;
  getAgent(key: string): Promise<Agent | null>;
  listGrants(agentKey: string, userOrganizationKey: string): Promise<readonly AgentMember[]>;
}

export function createDefaultAgentAccessDataSource(): AgentAccessDataSource {
  return {
    getUser: getUserById,
    getMembership: getUserOrganizationByOrganizationAndUser,
    getOrganization: getOrganizationById,
    getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
    async getScopeMember(scopeKey, userOrganizationKey) {
      const members = await getDefaultScopeMemberRepository().listMembers(scopeKey);
      return members.find((member) => member.userOrganizationKey === userOrganizationKey) ?? null;
    },
    getScopeAgent: getScopeAgentByPair,
    getAgent: getAgentById,
    listGrants: listAgentMemberGrants,
  };
}

let cachedDefaultDataSource: AgentAccessDataSource | null = null;
function defaultDataSource(): AgentAccessDataSource {
  cachedDefaultDataSource ??= createDefaultAgentAccessDataSource();
  return cachedDefaultDataSource;
}

/**
 * Pure evaluation of the already-loaded access state. Both the HTTP layer
 * (via {@link canUserAccessAgent}) and execution-time authorization feed the
 * same rule set, so every entry point enforces identical semantics:
 *
 *   active organization membership
 *   AND scope access (effective role)
 *   AND agent linked to the scope
 *   AND at least one valid agentMembers grant
 *   AND the system-agent security policy.
 *
 * An inherited grant is only valid while the member's effective role still
 * satisfies the scopeAgent threshold — demotion revokes at runtime even
 * before asynchronous grant cleanup lands. Explicit grants survive demotion
 * by design.
 */
export function evaluateAgentAccess(input: {
  organization: Organization;
  membership: UserOrganization;
  scope: Scope;
  scopeMember: ScopeMember | null;
  scopeAgent: ScopeAgent;
  agent: Agent;
  grants: readonly AgentMember[];
  delegated?: boolean;
}): AgentAccessDecision {
  if (input.membership.status !== 'active' || input.membership.organizationId !== input.organization.key) {
    return { allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED' };
  }
  if (input.scope.organizationKey !== input.organization.key) {
    return { allowed: false, reason: 'SCOPE_ACCESS_DENIED' };
  }
  const effectiveRole = resolveEffectiveScopeRole({ userOrganization: input.membership, scopeMember: input.scopeMember });
  if (!effectiveRole) return { allowed: false, reason: 'SCOPE_ACCESS_DENIED' };
  if (input.scopeAgent.scopeKey !== input.scope.key || input.scopeAgent.agentKey !== input.agent.key) {
    return { allowed: false, reason: 'AGENT_NOT_IN_SCOPE' };
  }

  const policy = resolveAgentSecurityPolicy(input.agent);
  if (policy.allowedOrganizationType === 'root-only' && !input.organization.is_root) {
    return { allowed: false, reason: 'AGENT_ACCESS_DENIED' };
  }
  if (!roleAtLeast(effectiveRole, policy.minimumCallerRole)) {
    return { allowed: false, reason: 'AGENT_ACCESS_DENIED' };
  }
  if (input.delegated && !policy.mayBeDelegated) {
    return { allowed: false, reason: 'AGENT_ACCESS_DENIED' };
  }

  const validSources = new Set<AgentMemberSource>();
  for (const grant of input.grants) {
    if (grant.agentKey !== input.agent.key || grant.userOrganizationKey !== input.membership.key) continue;
    if (grant.scopeAgentKey !== input.scopeAgent.key) continue;
    if (grant.source === 'inherited') {
      if (policy.requiresExplicitGrant) continue;
      if (!roleAtLeast(effectiveRole, input.scopeAgent.minimumAccessRole)) continue;
    }
    validSources.add(grant.source);
  }
  if (policy.requiresExplicitGrant && !validSources.has('explicit')) {
    return { allowed: false, reason: 'AGENT_ACCESS_DENIED' };
  }
  if (validSources.size === 0) {
    return { allowed: false, reason: 'AGENT_ACCESS_DENIED' };
  }

  return {
    allowed: true,
    userOrganizationKey: input.membership.key,
    effectiveRole,
    scopeAgentKey: input.scopeAgent.key,
    grantSources: [...validSources].sort(),
  };
}

/**
 * The one canonical agent-access service. Every consumer — direct API,
 * run creation, Beacon/orchestrator delegation, background continuation —
 * must route through this decision (or {@link evaluateAgentAccess} when the
 * state is already loaded). Never reduce it to an organization check.
 */
export async function canUserAccessAgent(
  input: CanUserAccessAgentInput,
  source: AgentAccessDataSource = defaultDataSource(),
): Promise<AgentAccessDecision> {
  const keys = z.object({
    userKey: keySchema,
    organizationKey: z.string().trim().min(1),
    scopeKey: keySchema,
    agentKey: keySchema,
  }).safeParse(input);
  if (!keys.success) return { allowed: false, reason: 'UNAUTHENTICATED' };

  const user = await source.getUser(keys.data.userKey);
  if (!user) return { allowed: false, reason: 'UNAUTHENTICATED' };

  const [organization, membership] = await Promise.all([
    source.getOrganization(keys.data.organizationKey),
    source.getMembership(keys.data.organizationKey, keys.data.userKey),
  ]);
  if (!organization?.isActive || !membership || membership.status !== 'active') {
    return { allowed: false, reason: 'ORGANIZATION_ACCESS_DENIED' };
  }

  const scope = await source.getScope(keys.data.scopeKey);
  if (!scope || scope.organizationKey !== organization.key) {
    return { allowed: false, reason: 'SCOPE_ACCESS_DENIED' };
  }
  const scopeMember = await source.getScopeMember(scope.key, membership.key);

  const scopeAgent = await source.getScopeAgent(scope.key, keys.data.agentKey);
  if (!scopeAgent) {
    const effectiveRole = resolveEffectiveScopeRole({ userOrganization: membership, scopeMember });
    return { allowed: false, reason: effectiveRole ? 'AGENT_NOT_IN_SCOPE' : 'SCOPE_ACCESS_DENIED' };
  }

  const agent = await source.getAgent(keys.data.agentKey);
  if (!agent) return { allowed: false, reason: 'AGENT_UNAVAILABLE' };

  const grants = await source.listGrants(agent.key, membership.key);
  return evaluateAgentAccess({ organization, membership, scope, scopeMember, scopeAgent, agent, grants, delegated: input.delegated });
}

/**
 * Central creation policy: owners, admins, and (by product policy)
 * moderators may create agents; viewers may not. Flip
 * `minimumCreationRole` here — never scatter `role !== 'viewer'` checks
 * across handlers.
 */
export const AGENT_CREATION_POLICY: { minimumCreationRole: RankedRole } = {
  minimumCreationRole: 'moderator',
};

export function canCreateAgent(input: { effectiveRole: RankedRole | null }): boolean {
  if (!input.effectiveRole) return false;
  return roleAtLeast(input.effectiveRole, AGENT_CREATION_POLICY.minimumCreationRole);
}

/** Conservative default: only owners and admins manage explicit agent access. */
export const AGENT_MEMBER_MANAGEMENT_POLICY: { minimumManagementRole: RankedRole } = {
  minimumManagementRole: 'admin',
};

export function canManageAgentMembers(input: { effectiveRole: RankedRole | null }): boolean {
  if (!input.effectiveRole) return false;
  return roleAtLeast(input.effectiveRole, AGENT_MEMBER_MANAGEMENT_POLICY.minimumManagementRole);
}

/** Only owners may move the inherited threshold (organization policy may later admit admins). */
export const ACCESS_THRESHOLD_POLICY: { minimumUpdateRole: RankedRole } = {
  minimumUpdateRole: 'owner',
};

export function canUpdateAccessThreshold(input: { effectiveRole: RankedRole | null }): boolean {
  if (!input.effectiveRole) return false;
  return roleAtLeast(input.effectiveRole, ACCESS_THRESHOLD_POLICY.minimumUpdateRole);
}
