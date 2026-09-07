import type { ScopeMember } from '@/lib/ai/scopes';
import type { UserTeam } from '@/lib/db/user-team.node';
import type { User } from '@/lib/db/users.node';
import { AiError } from '@/lib/ai/shared/result';

export type ToolPrincipal =
  | { kind: 'member'; user: User; userTeam: UserTeam; scopeMember: ScopeMember | null }
  | { kind: 'system' };

export interface ToolContext {
  teamKey: string;
  runtimeScopeKey: string;
  principal: ToolPrincipal;
  /** Trusted session proof, injected by authenticated server boundaries only. */
  teamAssurance?: { teamMembershipKey: string; teamMfaVersion: number };
}

export class ToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}
