import type { ResolvedExecutionPrincipal } from '@/lib/ai/agents/access';
import { AiError } from '@/lib/ai/shared/result';

export interface ToolContext {
  organizationKey: string;
  runtimeScopeKey: string;
  principal: ResolvedExecutionPrincipal;
}

export class ToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}
