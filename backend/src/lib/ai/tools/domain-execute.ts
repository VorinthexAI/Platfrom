import type { ResolvedExecutionPrincipal } from '@/lib/ai/agents/access';
import { AiError } from '@/lib/ai/shared/result';
import { domainToolInputSchemas, domainToolResultSchema, type DomainActionSlug, type DomainToolResult } from './domain-schemas';
import { executeContentLifecycleTool, type ContentExecutionDependencies } from './domain-execute-content';
import { isContentAction } from './domain-content-schemas';
import { createEmailService, type EmailService } from '@/lib/email-inbox/service';
import { evaluateScopeAccess } from './domain-access-engine';

export class DomainToolExecutionError extends AiError {
  constructor(code: string, detail: string) { super(code, detail); }
}

export interface DomainToolContext {
  organizationKey: string;
  runtimeScopeKey: string;
  principal: ResolvedExecutionPrincipal;
}

export interface DomainToolExecutionOptions {
  content?: Partial<Omit<ContentExecutionDependencies, 'authorize'>>;
  authorizeScope?: (scopeKey: string, roles: readonly string[]) => Promise<void>;
  email?: Pick<EmailService, 'overview' | 'read' | 'draft'>;
}

function memberPrincipal(context: DomainToolContext) {
  if (context.principal.kind !== 'member') throw new DomainToolExecutionError('human_principal_required', 'A human organization member must initiate this operation');
  if (context.principal.userOrganization.organizationId !== context.organizationKey || context.principal.userOrganization.status !== 'active') {
    throw new DomainToolExecutionError('organization_forbidden', 'Active organization membership is required');
  }
  return context.principal;
}

export async function executeDomainTool(action: DomainActionSlug, rawInput: unknown, context: DomainToolContext, options: DomainToolExecutionOptions = {}): Promise<DomainToolResult> {
  const input = domainToolInputSchemas[action].parse(rawInput) as never;
  const principal = memberPrincipal(context);
  const authorize = options.authorizeScope ?? (async (scopeKey: string, roles: readonly string[]) => {
    const decision = await evaluateScopeAccess(context, { scope: scopeKey, action });
    if (!decision.allowed || !decision.effectiveRole || !roles.includes(decision.effectiveRole)) throw new DomainToolExecutionError('scope_forbidden', decision.reason);
  });
  if (action.startsWith('email.')) {
    const roles = action === 'email.reply.draft' ? ['owner', 'admin', 'moderator'] : ['owner', 'admin', 'moderator', 'viewer'];
    await authorize(context.runtimeScopeKey, roles);
    const email = options.email ?? createEmailService();
    const actor = { userKey: principal.userOrganization.userId, organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey };
    const data = action === 'email.thread.list'
      ? await email.overview(actor, input)
      : action === 'email.thread.read'
        ? await email.read(actor, [{ threadKey: (input as { threadKey: string }).threadKey, limit: 50 }])
        : await email.draft(actor, input);
    return domainToolResultSchema.parse({ action, status: 'completed', data });
  }
  if (!isContentAction(action)) throw new DomainToolExecutionError('unsupported_domain_action', `No local handler exists for ${action}`);
  const data = await executeContentLifecycleTool(action, input, { organizationKey: context.organizationKey }, {
    ...options.content,
    authorize,
  });
  return domainToolResultSchema.parse({ action, status: 'completed', data });
}
