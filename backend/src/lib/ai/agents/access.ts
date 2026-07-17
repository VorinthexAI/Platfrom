import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getDefaultScopeMemberRepository, type ScopeMember } from '@/lib/ai/scopes';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationById, type UserOrganization } from '@/lib/db/user-organization.node';
import { getScopeAgentByPair, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { listAgentMemberGrants, type AgentMember, type AgentMemberSource } from '@/lib/db/agent-members.node';
import { evaluateAgentAccess, type AgentAccessDenialReason } from '@/lib/ai/agent-access/authorization';
import type { RankedRole } from '@/lib/ai/agent-access/roles';
import type { AgentRuntimeContext } from './runtime';

export const executionPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('member'),
    userOrganizationKey: z.string().cuid(),
    /**
     * Set when another agent (Beacon, an orchestrator) invokes the target on
     * the member's behalf. The initiating user's authorization follows the
     * delegation — the delegating agent's own access is never a substitute —
     * and the target's security policy may forbid delegation entirely.
     */
    delegatedViaAgentKey: z.string().cuid().optional(),
  }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
]);

export type ExecutionPrincipal = z.infer<typeof executionPrincipalSchema>;

export type ResolvedExecutionPrincipal =
  | {
    kind: 'member';
    user: User;
    userOrganization: UserOrganization;
    scopeMember: ScopeMember | null;
    effectiveRole: RankedRole;
    scopeAgentKey: string;
    grantSources: AgentMemberSource[];
  }
  | { kind: 'system' };

export interface ExecutionAccessDataSource {
  getUserOrganization(key: string): Promise<UserOrganization | null>;
  getUser(key: string): Promise<User | null>;
  listScopeMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
  getScopeAgent(scopeKey: string, agentKey: string): Promise<ScopeAgent | null>;
  listGrants(agentKey: string, userOrganizationKey: string): Promise<readonly AgentMember[]>;
}

const defaultAccessData: ExecutionAccessDataSource = {
  getUserOrganization: getUserOrganizationById,
  getUser: getUserById,
  listScopeMembers: (scopeKey) => getDefaultScopeMemberRepository().listMembers(scopeKey),
  getScopeAgent: getScopeAgentByPair,
  listGrants: listAgentMemberGrants,
};

export class AgentExecutionAccessError extends AiError {
  constructor(detail: string, readonly reason: AgentAccessDenialReason = 'AGENT_ACCESS_DENIED') {
    super('agent_execution_access_denied', `Agent execution access denied: ${detail}`);
  }
}

/**
 * Resolves and authorizes the caller directly against persisted state at the
 * moment of run creation. Membership in the organization or scope is never
 * enough on its own — the member must also hold a valid agentMembers grant
 * for this agent, and the agent's security policy must admit the call. Every
 * execution path (direct API, Beacon delegation, orchestrators, retries,
 * background continuations) funnels through this check via run creation.
 */
export async function authorizeAgentExecution(
  runtime: AgentRuntimeContext,
  principal: ExecutionPrincipal,
  source: ExecutionAccessDataSource = defaultAccessData,
): Promise<ResolvedExecutionPrincipal> {
  const parsed = executionPrincipalSchema.parse(principal);
  if (parsed.kind === 'system') return parsed;

  const membership = await source.getUserOrganization(parsed.userOrganizationKey);
  if (!membership || membership.status !== 'active') {
    throw new AgentExecutionAccessError(`active organization membership ${parsed.userOrganizationKey} was not found`, 'ORGANIZATION_ACCESS_DENIED');
  }
  if (membership.organizationId !== runtime.organization.key) {
    throw new AgentExecutionAccessError('organization membership belongs to another organization', 'ORGANIZATION_ACCESS_DENIED');
  }
  const user = await source.getUser(membership.userId);
  if (!user) throw new AgentExecutionAccessError(`user ${membership.userId} was not found`, 'UNAUTHENTICATED');

  const scopeMember = (await source.listScopeMembers(runtime.scope.key))
    .find((candidate) => candidate.userOrganizationKey === membership.key) ?? null;

  const scopeAgent = await source.getScopeAgent(runtime.scope.key, runtime.agent.key);
  if (!scopeAgent) {
    throw new AgentExecutionAccessError(`agent ${runtime.agent.key} is not linked to scope ${runtime.scope.key}`, 'AGENT_NOT_IN_SCOPE');
  }

  const grants = await source.listGrants(runtime.agent.key, membership.key);
  const decision = evaluateAgentAccess({
    organization: runtime.organization,
    membership,
    scope: runtime.scope,
    scopeMember,
    scopeAgent,
    agent: runtime.agent,
    grants,
    delegated: parsed.delegatedViaAgentKey !== undefined,
  });
  if (!decision.allowed) {
    throw new AgentExecutionAccessError(
      `membership ${membership.key} may not execute agent ${runtime.agent.key} (${decision.reason})`,
      decision.reason,
    );
  }

  return {
    kind: 'member',
    user,
    userOrganization: membership,
    scopeMember,
    effectiveRole: decision.effectiveRole,
    scopeAgentKey: decision.scopeAgentKey,
    grantSources: decision.grantSources,
  };
}
