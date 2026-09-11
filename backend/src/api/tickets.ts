import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getDefaultTicketService, ticketIdempotencyKeySchema, ticketSubmitInputSchema, TicketAccessError, TicketFeedbackRejectedError, TicketIdempotencyError, type TicketService } from '@/lib/tickets/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { sparkErrorResponse } from './errors';
import { authenticatedTeamContext } from './auth';

export const ticketHttpInputSchema = z.object({
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  message: ticketSubmitInputSchema.shape.message,
}).strict();

export interface TicketHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { teamKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: TicketService;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
}

export function createTicketHandler(dependencies: TicketHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    try {
      const idempotencyKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
      const { teamKey, scopeKey, message } = await parseJson(c, ticketHttpInputSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, { ...dependencies.authorizationOptions, ...authenticatedTeamContext(identity) });
      const ticket = await (dependencies.service ?? getDefaultTicketService()).submit({ message }, context, idempotencyKey);
      return c.json({ success: true, data: ticket }, 201);
    } catch (error) {
      if (error instanceof TicketIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 409);
      if (error instanceof TicketAccessError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 403);
      if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid ticket request' }, 400);
      console.error('ticket request failed', { error });
      return c.json({ success: false, error: 'ticket request could not be completed' }, 500);
    }
  };
}

async function authorizedRequest(c: Context, dependencies: TicketHandlerDependencies, schema: z.ZodTypeAny) {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return { response: c.json({ success: false, error: 'authentication required' }, 401) };
  const input = await parseJson(c, schema) as { teamKey: string; scopeKey: string } & Record<string, unknown>;
  const { teamKey, scopeKey, ...body } = input;
  const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, { ...dependencies.authorizationOptions, ...authenticatedTeamContext(identity) });
  return { body, context };
}

function feedbackError(c: Context, error: unknown) {
  const billing = sparkErrorResponse(c, error); if (billing) return billing;
  if (error instanceof TicketIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 409);
  if (error instanceof TicketFeedbackRejectedError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 400);
  if (error instanceof TicketAccessError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 403);
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid feedback request' }, 400);
  console.error('feedback request failed', { error });
  return c.json({ success: false, error: 'feedback request could not be completed' }, 500);
}

export function createFeedbackHandlers(dependencies: TicketHandlerDependencies = {}) {
  return {
    create: async (c: Context) => {
      try {
        const idempotencyKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
        const request = await authorizedRequest(c, dependencies, ticketHttpInputSchema);
        if ('response' in request) return request.response;
        const input = ticketSubmitInputSchema.parse(request.body);
        const ticket = await observeToolExecution('feedback.create', request.context, () => (dependencies.service ?? getDefaultTicketService()).createFeedback(input, request.context, idempotencyKey), { recorder: dependencies.recordEvent ?? toolEventService.record, appScopeKey: dependencies.appScopeKey, idempotencyKey, input, ...dependencies.billing });
        return c.json({ success: true, data: ticket }, 201);
      } catch (error) { return feedbackError(c, error); }
    },
  };
}

export const ticketHandler = createTicketHandler();
export const feedbackHandlers = createFeedbackHandlers();
