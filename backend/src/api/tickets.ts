import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { feedbackListInputSchema, feedbackVoteInputSchema, getDefaultTicketService, ticketIdempotencyKeySchema, ticketSubmitInputSchema, TicketAccessError, TicketFeedbackRejectedError, TicketIdempotencyError, TicketNotFoundError, type TicketService } from '@/lib/tickets/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { sparkErrorResponse } from './errors';

export const ticketHttpInputSchema = z.object({
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  message: ticketSubmitInputSchema.shape.message,
}).strict();
export const feedbackListHttpInputSchema = z.object({ organizationKey: z.string().cuid(), scopeKey: z.string().cuid(), cursor: feedbackListInputSchema.shape.cursor, limit: feedbackListInputSchema.shape.limit.optional() }).strict();
export const feedbackVoteHttpInputSchema = z.object({ organizationKey: z.string().cuid(), scopeKey: z.string().cuid(), vote: feedbackVoteInputSchema.shape.vote }).strict();

export interface TicketHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: TicketService;
  recordEvent?: ToolEventRecorder;
  billing?: ToolBillingDependencies;
}

export function createTicketHandler(dependencies: TicketHandlerDependencies = {}) {
  return async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
    if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
    try {
      const idempotencyKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
      const { organizationKey, scopeKey, message } = await parseJson(c, ticketHttpInputSchema);
      const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey, scopeKey }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
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
  if (identity.identityType !== 'user') return { response: c.json({ success: false, error: 'user session required' }, 403) };
  const input = await parseJson(c, schema) as { organizationKey: string; scopeKey: string } & Record<string, unknown>;
  const { organizationKey, scopeKey, ...body } = input;
  const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey, scopeKey }, { ...dependencies.authorizationOptions, authenticatedUserKey: identity.key });
  return { body, context };
}

function feedbackError(c: Context, error: unknown) {
  const billing = sparkErrorResponse(c, error); if (billing) return billing;
  if (error instanceof TicketIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 409);
  if (error instanceof TicketNotFoundError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 404);
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
        const ticket = await observeToolExecution('feedback.create', request.context, () => (dependencies.service ?? getDefaultTicketService()).createFeedback(input, request.context, idempotencyKey), { recorder: dependencies.recordEvent ?? toolEventService.record, idempotencyKey, input, ...dependencies.billing });
        return c.json({ success: true, data: ticket }, 201);
      } catch (error) { return feedbackError(c, error); }
    },
    list: async (c: Context) => {
      try {
        const request = await authorizedRequest(c, dependencies, feedbackListHttpInputSchema);
        if ('response' in request) return request.response;
        const result = await (dependencies.service ?? getDefaultTicketService()).listFeedback(feedbackListInputSchema.parse(request.body), request.context);
        return c.json({ success: true, data: result });
      } catch (error) { return feedbackError(c, error); }
    },
    vote: async (c: Context) => {
      try {
        const requestKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
        const ticketKey = z.string().cuid().parse(c.req.param('ticketKey'));
        const request = await authorizedRequest(c, dependencies, feedbackVoteHttpInputSchema);
        if ('response' in request) return request.response;
        const { vote } = feedbackVoteInputSchema.pick({ vote: true }).parse(request.body);
        const ticket = await (dependencies.service ?? getDefaultTicketService()).setFeedbackVote({ ticketKey, vote }, request.context, requestKey);
        return c.json({ success: true, data: ticket });
      } catch (error) { return feedbackError(c, error); }
    },
  };
}

export const ticketHandler = createTicketHandler();
export const feedbackHandlers = createFeedbackHandlers();
