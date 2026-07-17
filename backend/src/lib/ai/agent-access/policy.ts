import type { Agent } from '@/lib/db/agents.node';
import type { RankedRole } from './roles';

/**
 * Rules stricter than scopeAgents.minimumAccessRole for sensitive system
 * agents. Resolved from trusted server configuration by immutable slug —
 * never from client input, and ordinary users cannot edit these.
 */
export interface AgentSecurityPolicy {
  /** Inherited grants are never created and never satisfy access; an explicit grant is required. */
  requiresExplicitGrant: boolean;
  /** Whether the agent may only be reached inside the root organization. */
  allowedOrganizationType: 'root-only' | 'any';
  /** Floor on the caller's effective role, applied on top of grant checks. */
  minimumCallerRole: RankedRole;
  /** Whether another agent (Beacon, an orchestrator) may delegate into this agent. */
  mayBeDelegated: boolean;
}

export const DEFAULT_AGENT_SECURITY_POLICY: AgentSecurityPolicy = {
  requiresExplicitGrant: false,
  allowedOrganizationType: 'any',
  minimumCallerRole: 'viewer',
  mayBeDelegated: true,
};

/**
 * Genesis creates future agents: root organization only, owners only,
 * explicit grant required, and no delegation — Beacon or an orchestrator must
 * never become a path into agent creation.
 *
 * Steward manages organizations, scopes, memberships, and agent assignments:
 * admins and owners, explicit grant required, delegation restricted.
 *
 * Beacon is broadly available, but delegation through Beacon always carries
 * the initiating user's authorization context — the policy layer cannot relax
 * grant checks, only tighten them.
 */
const SYSTEM_AGENT_POLICIES: Record<string, AgentSecurityPolicy> = {
  genesis: {
    requiresExplicitGrant: true,
    allowedOrganizationType: 'root-only',
    minimumCallerRole: 'owner',
    mayBeDelegated: false,
  },
  steward: {
    requiresExplicitGrant: true,
    allowedOrganizationType: 'any',
    minimumCallerRole: 'admin',
    mayBeDelegated: false,
  },
  beacon: {
    requiresExplicitGrant: false,
    allowedOrganizationType: 'any',
    minimumCallerRole: 'viewer',
    mayBeDelegated: true,
  },
};

export function resolveAgentSecurityPolicy(agent: Pick<Agent, 'slug'>): AgentSecurityPolicy {
  return SYSTEM_AGENT_POLICIES[agent.slug] ?? DEFAULT_AGENT_SECURITY_POLICY;
}

export function isPolicyRestrictedAgent(agent: Pick<Agent, 'slug'>): boolean {
  return resolveAgentSecurityPolicy(agent).requiresExplicitGrant;
}
