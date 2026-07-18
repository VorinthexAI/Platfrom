import { z } from 'zod';
import { AiError } from '@/lib/ai/shared/result';
import { getDefaultScopeMemberRepository, type ScopeMember } from '@/lib/ai/scopes';
import { getUserById, type User } from '@/lib/db/users.node';
import { getUserOrganizationById, type UserOrganization } from '@/lib/db/user-organization.node';
import type { AgentRuntimeContext } from './runtime';

export const executionPrincipalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('member'), userOrganizationKey: z.string().cuid() }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
]);

export type ExecutionPrincipal = z.infer<typeof executionPrincipalSchema>;

export type ResolvedExecutionPrincipal =
  | { kind: 'member'; user: User; userOrganization: UserOrganization; scopeMember: ScopeMember }
  | { kind: 'system' };

export interface ExecutionAccessDataSource {
  getUserOrganization(key: string): Promise<UserOrganization | null>;
  getUser(key: string): Promise<User | null>;
  listScopeMembers(scopeKey: string): Promise<readonly ScopeMember[]>;
}

const defaultAccessData: ExecutionAccessDataSource = {
  getUserOrganization: getUserOrganizationById,
  getUser: getUserById,
  listScopeMembers: (scopeKey) => getDefaultScopeMemberRepository().listMembers(scopeKey),
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
): Promise<ResolvedExecutionPrincipal> {
  const parsed = executionPrincipalSchema.parse(principal);
  if (runtime.scope.deletedAt !== null) {
    throw new AgentExecutionAccessError(`scope ${runtime.scope.key} is archived`);
  }
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
    .find((candidate) => candidate.userOrganizationKey === membership.key);
  if (!scopeMember) {
    throw new AgentExecutionAccessError(`membership ${membership.key} is not assigned to scope ${runtime.scope.key}`);
  }
  return { kind: 'member', user, userOrganization: membership, scopeMember };
}
