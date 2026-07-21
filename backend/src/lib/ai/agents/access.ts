import { z } from 'zod';
import { persistedKeySchema } from '@/lib/ai/shared/ids';
import { AiError } from '@/lib/ai/shared/result';
import { scopeMemberSchema, type ScopeMember } from '@/lib/ai/scopes';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationById, type UserOrganization } from '@/lib/db/user-organization.node';
import type { AgentRuntimeContext } from './runtime';
import { db } from '@/lib/db/client';
import { scopeAgentSchema, type ScopeAgent } from '@/lib/db/scope-agents.node';
import { agentMemberSchema, type AgentMember } from '@/lib/db/agent-members.node';

export const executionPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), userOrganizationKey: persistedKeySchema }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
]);

export type ExecutionPrincipal = z.infer<typeof executionPrincipalSchema>;

export type ResolvedExecutionPrincipal =
  | { kind: 'member'; user: User; userOrganization: UserOrganization; scopeMember: ScopeMember | null }
  | { kind: 'system' };


export interface ExecutionAccessDataSource {
  getUserOrganization(key: string): Promise<UserOrganization | null>;
  getUser(key: string): Promise<User | null>;
  listScopeMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
  getScopeAgent(scopeKey: string, agentKey: string): Promise<ScopeAgent | null>;
  listAgentMembers(scopeAgentKey: string, userOrganizationKey: string): Promise<readonly AgentMember[]>;
  evaluateAgentAccess?(runtime: AgentRuntimeContext, principal: Extract<ResolvedExecutionPrincipal, { kind: 'member' }>): Promise<{ allowed: boolean; reason: string }>;
}

const defaultAccessData: ExecutionAccessDataSource = {
  getUserOrganization: getUserOrganizationById,
  getUser: getUserById,
  async listScopeMembers(scopeKey) {
    const [memberCursor, relationCursor] = await Promise.all([
      db.query<Record<string, unknown>>('FOR member IN scopeMembers RETURN MERGE(member, { key: member._key })'),
      db.query<{ parentKey: string; childKey: string }>('FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }'),
    ]);
    const parentByChild = new Map((await relationCursor.all()).map((relation) => [relation.childKey, relation.parentKey]));
    const ancestors = new Set([scopeKey]); let parent = parentByChild.get(scopeKey);
    while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parentByChild.get(parent); }
    return (await memberCursor.all()).map((member) => scopeMemberSchema.parse(member)).filter((member) => ancestors.has(member.scopeKey));
  },
  async getScopeAgent(scopeKey, agentKey) { const cursor = await db.query<Record<string, unknown>>('FOR link IN scopeAgents FILTER link.scopeKey == @scopeKey && link.agentKey == @agentKey LIMIT 1 RETURN MERGE(link, { key: link._key })', { scopeKey, agentKey }); const link = await cursor.next(); return link ? scopeAgentSchema.parse(link) : null; },
  async listAgentMembers(scopeAgentKey, userOrganizationKey) { const cursor = await db.query<Record<string, unknown>>('FOR grant IN agentMembers FILTER grant.scopeAgentKey == @scopeAgentKey && grant.userOrganizationKey == @userOrganizationKey RETURN MERGE(grant, { key: grant._key })', { scopeAgentKey, userOrganizationKey }); return (await cursor.all()).map((grant) => agentMemberSchema.parse(grant)); },
  async evaluateAgentAccess(runtime, principal) { const engine = await import('@/lib/ai/domain-tools/access-engine'); return engine.evaluateAgentAccess({ organizationKey: runtime.organization.key, runtimeScopeKey: runtime.scope.key, principal }, { scope: runtime.scope.key, agent: runtime.agent.key, member: principal.userOrganization.key, action: 'run' }); },
};

export class AgentExecutionAccessError extends AiError {
  constructor(detail: string) {
    super('agent_execution_access_denied', `Agent execution access denied: ${detail}`);
  }
}

/** Resolves the caller from persisted organization and scope membership links. */
export async function authorizeAgentExecution(
  runtime: AgentRuntimeContext,
  principal: ExecutionPrincipal,
  source: ExecutionAccessDataSource = defaultAccessData,
  options: { allowArchivedOrganization?: boolean } = {},
): Promise<ResolvedExecutionPrincipal> {
  const parsed = executionPrincipalSchema.parse(principal);
  if (runtime.scope.deletedAt !== null) {
    throw new AgentExecutionAccessError(`scope ${runtime.scope.key} is archived`);
  }
  if (!runtime.organization.isActive && !options.allowArchivedOrganization) throw new AgentExecutionAccessError(`organization ${runtime.organization.key} is archived`);
  const scopeAgent = await source.getScopeAgent(runtime.scope.key, runtime.agent.key);
  if (!scopeAgent) throw new AgentExecutionAccessError(`agent ${runtime.agent.key} is not linked to scope ${runtime.scope.key}`);
  if (scopeAgent.status !== 'active') throw new AgentExecutionAccessError(`scope agent ${scopeAgent.key} is archived`);
  if (parsed.kind === 'system') return parsed;

  const membership = await source.getUserOrganization(parsed.userOrganizationKey);
  if (!membership || membership.status !== 'active') {
    throw new AgentExecutionAccessError(`active organization membership ${parsed.userOrganizationKey} was not found`);
  }
  if (membership.organizationId !== runtime.organization.key) {
    throw new AgentExecutionAccessError('organization membership belongs to another organization');
  }
  const user = await source.getUser(membership.userId);
  if (!user) throw new AgentExecutionAccessError(`user ${membership.userId} was not found`);
  const scopeMember = (await source.listScopeMembers(runtime.scope.key))
    .filter((candidate) => candidate.userOrganizationKey === membership.key && candidate.status === 'active')
    .sort((left, right) => ({ owner: 4, admin: 3, moderator: 2, viewer: 1 }[right.role] - { owner: 4, admin: 3, moderator: 2, viewer: 1 }[left.role]))[0] ?? null;
  if (!scopeMember && membership.orgRole !== 'owner' && membership.orgRole !== 'admin') {
    throw new AgentExecutionAccessError(`membership ${membership.key} is not assigned to scope ${runtime.scope.key}`);
  }
  const agentGrants = await source.listAgentMembers(scopeAgent.key, membership.key);
  if (agentGrants.length === 0) throw new AgentExecutionAccessError(`membership ${membership.key} has no agent grant for ${runtime.agent.key}`);
  const effectiveRole = membership.orgRole === 'owner' || membership.orgRole === 'admin' ? membership.orgRole : scopeMember?.role ?? null;
  const roleRank = { owner: 4, admin: 3, moderator: 2, viewer: 1 } as const;
  if (runtime.agent.slug.startsWith('system-') && effectiveRole !== 'owner') throw new AgentExecutionAccessError(`system agent ${runtime.agent.key} requires owner access`);
  if (agentGrants.every((grant) => grant.source === 'inherited') && (!effectiveRole || roleRank[effectiveRole] < roleRank[scopeAgent.minimumAccessRole])) throw new AgentExecutionAccessError(`inherited grant does not meet ${scopeAgent.minimumAccessRole} threshold`);
  const resolved = { kind: 'member' as const, user, userOrganization: membership, scopeMember };
  const sharedDecision = await source.evaluateAgentAccess?.(runtime, resolved);
  if (sharedDecision && !sharedDecision.allowed) throw new AgentExecutionAccessError(sharedDecision.reason);
  return resolved;
}
