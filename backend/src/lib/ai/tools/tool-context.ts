import type { ScopeMember } from '@/lib/ai/scopes';
import type { UserOrganization } from '@/lib/db/user-organization.node';
import type { User } from '@/lib/db/users.node';
import { AiError } from '@/lib/ai/shared/result';

export type ToolPrincipal =
  | { kind: 'member'; user: User; userOrganization: UserOrganization; scopeMember: ScopeMember | null }
  | { kind: 'system' };

export interface ToolContext {
  organizationKey: string;
  runtimeScopeKey: string;
  principal: ToolPrincipal;
}

export class ToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}
