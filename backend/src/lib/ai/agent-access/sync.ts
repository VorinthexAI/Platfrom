import { AiError } from '@/lib/ai/shared/result';
import { getAgentById, type Agent } from '@/lib/db/agents.node';
import {
  deleteAgentMemberGrants,
  deleteAgentMembersForMembership,
  ensureAgentMemberGrant,
  listInheritedGrantsByScopeAgent,
  type AgentMember,
} from '@/lib/db/agent-members.node';
import { getScopeAgentById, listScopeAgentsByScope, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { getUserOrganizationById, listActiveStewardMembershipsByOrganization, type UserOrganization } from '@/lib/db/user-organization.node';
import {
  getDefaultScopeRepository,
  listScopeMembersWithActiveMemberships,
  type Scope,
  type ScopeMemberWithMembership,
} from '@/lib/ai/scopes';
import { emitAgentAccessEvent, type AgentAccessEventEmitter } from './events';
import { resolveAgentSecurityPolicy } from './policy';
import { resolveEffectiveScopeRole, roleAtLeast, type RankedRole } from './roles';

export class AgentAccessSyncError extends AiError {
  constructor(detail: string) {
    super('agent_access_sync_failed', `Agent access synchronization failed: ${detail}`);
  }
}

export interface AgentAccessSyncDataSource {
  getScopeAgent(key: string): Promise<ScopeAgent | null>;
  listScopeAgents(scopeKey: string): Promise<readonly ScopeAgent[]>;
  getAgent(key: string): Promise<Agent | null>;
  getScope(key: string): Promise<Scope | null>;
  getMembership(key: string): Promise<UserOrganization | null>;
  listStewardMemberships(organizationKey: string): Promise<readonly UserOrganization[]>;
  listScopeMemberships(scopeKey: string): Promise<readonly ScopeMemberWithMembership[]>;
  listInheritedGrants(scopeAgentKey: string): Promise<readonly AgentMember[]>;
  ensureInheritedGrant(input: { agentKey: string; userOrganizationKey: string; scopeAgentKey: string }): Promise<AgentMember>;
  deleteGrants(keys: readonly string[]): Promise<void>;
  deleteAllGrantsForMembership(userOrganizationKey: string): Promise<number>;
  listOrganizationScopes(organizationKey: string): Promise<readonly Scope[]>;
  emitEvent: AgentAccessEventEmitter;
}

export function createDefaultAgentAccessSyncDataSource(): AgentAccessSyncDataSource {
  return {
    getScopeAgent: getScopeAgentById,
    listScopeAgents: listScopeAgentsByScope,
    getAgent: getAgentById,
    getScope: (key) => getDefaultScopeRepository().getScopeByKey(key),
    getMembership: getUserOrganizationById,
    listStewardMemberships: listActiveStewardMembershipsByOrganization,
    listScopeMemberships: (scopeKey) => listScopeMembersWithActiveMemberships(scopeKey),
    listInheritedGrants: listInheritedGrantsByScopeAgent,
    ensureInheritedGrant: (input) => ensureAgentMemberGrant({ ...input, source: 'inherited', createdByUserOrganizationKey: null }),
    deleteGrants: deleteAgentMemberGrants,
    deleteAllGrantsForMembership: deleteAgentMembersForMembership,
    listOrganizationScopes: (organizationKey) => getDefaultScopeRepository().listScopes(organizationKey),
    emitEvent: emitAgentAccessEvent,
  };
}

let cachedDefaultSource: AgentAccessSyncDataSource | null = null;
function defaultSource(): AgentAccessSyncDataSource {
  cachedDefaultSource ??= createDefaultAgentAccessSyncDataSource();
  return cachedDefaultSource;
}

export interface EligibleInheritedMembership {
  membership: UserOrganization;
  effectiveRole: RankedRole;
}

/**
 * Everyone with effective access to the scope, deduplicated by membership:
 * organization owners/admins (who steward every scope) plus direct scope
 * members, each resolved through the canonical effective-role resolver.
 */
export async function resolveEffectiveScopeMemberships(
  scope: Scope,
  source: AgentAccessSyncDataSource = defaultSource(),
): Promise<EligibleInheritedMembership[]> {
  const [stewards, scopeMemberships] = await Promise.all([
    source.listStewardMemberships(scope.organizationKey),
    source.listScopeMemberships(scope.key),
  ]);
  const scopeMemberByMembership = new Map(scopeMemberships.map((row) => [row.membership.key, row]));
  const memberships = new Map<string, UserOrganization>();
  for (const steward of stewards) memberships.set(steward.key, steward);
  for (const row of scopeMemberships) memberships.set(row.membership.key, row.membership);

  const resolved: EligibleInheritedMembership[] = [];
  for (const membership of memberships.values()) {
    if (membership.organizationId !== scope.organizationKey) continue;
    const effectiveRole = resolveEffectiveScopeRole({
      userOrganization: membership,
      scopeMember: scopeMemberByMembership.get(membership.key)?.scopeMember ?? null,
    });
    if (effectiveRole) resolved.push({ membership, effectiveRole });
  }
  return resolved;
}

export interface SyncInheritedAgentMembersResult {
  scopeAgentKey: string;
  agentKey: string;
  eligibleCount: number;
  createdCount: number;
  removedCount: number;
}

/**
 * Converges the inherited grants of one scopeAgent onto the canonical rule
 *
 *   roleRank[effectiveRole] >= roleRank[scopeAgent.minimumAccessRole]
 *
 * Upserts are idempotent (unique index backed), stale inherited grants are
 * removed, and explicit grants are never touched. Policy-restricted agents
 * (requiresExplicitGrant) converge to zero inherited grants.
 */
export async function syncInheritedAgentMembersForScopeAgent(
  scopeAgentKey: string,
  source: AgentAccessSyncDataSource = defaultSource(),
): Promise<SyncInheritedAgentMembersResult> {
  const scopeAgent = await source.getScopeAgent(scopeAgentKey);
  if (!scopeAgent) throw new AgentAccessSyncError(`scopeAgent ${scopeAgentKey} was not found`);
  const [agent, scope] = await Promise.all([
    source.getAgent(scopeAgent.agentKey),
    source.getScope(scopeAgent.scopeKey),
  ]);
  if (!agent) throw new AgentAccessSyncError(`agent ${scopeAgent.agentKey} was not found`);
  if (!scope) throw new AgentAccessSyncError(`scope ${scopeAgent.scopeKey} was not found`);

  const policy = resolveAgentSecurityPolicy(agent);
  const eligible = policy.requiresExplicitGrant
    ? []
    : (await resolveEffectiveScopeMemberships(scope, source))
      .filter(({ effectiveRole }) => roleAtLeast(effectiveRole, scopeAgent.minimumAccessRole)
        && roleAtLeast(effectiveRole, policy.minimumCallerRole));

  const existing = await source.listInheritedGrants(scopeAgent.key);
  const eligibleKeys = new Set(eligible.map(({ membership }) => membership.key));
  const existingByMembership = new Map(existing.map((grant) => [grant.userOrganizationKey, grant]));

  let createdCount = 0;
  for (const { membership } of eligible) {
    if (existingByMembership.has(membership.key)) continue;
    await source.ensureInheritedGrant({ agentKey: scopeAgent.agentKey, userOrganizationKey: membership.key, scopeAgentKey: scopeAgent.key });
    createdCount += 1;
  }

  const stale = existing.filter((grant) => !eligibleKeys.has(grant.userOrganizationKey));
  await source.deleteGrants(stale.map((grant) => grant.key));

  if (createdCount > 0 || stale.length > 0) {
    await source.emitEvent({
      scopeKey: scope.key,
      slug: 'agent.access.synchronized',
      data: { agentKey: scopeAgent.agentKey, scopeAgentKey: scopeAgent.key, createdCount, removedCount: stale.length },
    });
  }
  return {
    scopeAgentKey: scopeAgent.key,
    agentKey: scopeAgent.agentKey,
    eligibleCount: eligible.length,
    createdCount,
    removedCount: stale.length,
  };
}

/** Re-synchronizes every agent linked to one scope (scope membership changed). */
export async function syncInheritedAgentMembersForScope(
  scopeKey: string,
  source: AgentAccessSyncDataSource = defaultSource(),
): Promise<SyncInheritedAgentMembersResult[]> {
  const links = await source.listScopeAgents(scopeKey);
  const results: SyncInheritedAgentMembersResult[] = [];
  for (const link of links) results.push(await syncInheritedAgentMembersForScopeAgent(link.key, source));
  return results;
}

/**
 * Re-synchronizes everything one organization membership can reach after its
 * role or status changed: every agent in every scope the member belongs to,
 * plus (for owner/admin transitions either direction) every scope of the
 * organization. When the membership is gone or suspended, all of its grants
 * are removed outright — runtime denies before this cleanup lands, so this
 * is data hygiene, not the security boundary.
 */
export async function syncAgentMembersForMembership(
  userOrganizationKey: string,
  source: AgentAccessSyncDataSource = defaultSource(),
): Promise<{ removedAllGrants: boolean; results: SyncInheritedAgentMembersResult[] }> {
  const membership = await source.getMembership(userOrganizationKey);
  if (!membership || membership.status !== 'active') {
    await source.deleteAllGrantsForMembership(userOrganizationKey);
    return { removedAllGrants: true, results: [] };
  }
  const scopes = await source.listOrganizationScopes(membership.organizationId);
  const results: SyncInheritedAgentMembersResult[] = [];
  for (const scope of scopes) results.push(...await syncInheritedAgentMembersForScope(scope.key, source));
  return { removedAllGrants: false, results };
}
