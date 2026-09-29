import type { User } from '@/lib/db/users.node';
import { AiError } from '@/lib/ai/shared/result';

export type ToolPrincipal =
  | { kind: 'member'; user: User; userTeam: { key: string; teamKey: string; userId: string; status: 'active' }; scopeMember: null }
  | { kind: 'system' };

export interface ToolContext {
  userKey: string;
  teamKey: string;
  runtimeScopeKey: string;
  principal: ToolPrincipal;
  teamAssurance?: { teamMembershipKey: string; teamMfaVersion: number };
}

export class ToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}

export function contextUserKey(context: ToolContext) {
  if (context.principal.kind === 'member') return context.principal.user.key;
  return context.userKey;
}

export function memberPrincipal(user: User): Extract<ToolPrincipal, { kind: 'member' }> {
  return { kind: 'member', user, userTeam: { key: user.key, teamKey: user.key, userId: user.key, status: 'active' }, scopeMember: null };
}
