import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, runTool, type RunAuthenticatedContentToolOptions } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getDefaultTicketService, ticketIdempotencyKeySchema, ticketListInputSchema, ticketSubmitInputSchema, TicketAccessError, TicketFeedbackRejectedError, TicketIdempotencyError, TicketNotFoundError, type TicketService } from '@/lib/tickets/service';
import { InvalidTicketCursorError } from '@/lib/tickets/repository';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { sparkErrorResponse } from './errors';
import { authenticatedTeamContext } from './auth';

export const ticketHttpInputSchema = z.object({
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  message: ticketSubmitInputSchema.shape.message,
  kind: ticketSubmitInputSchema.shape.kind.optional(),
}).strict();
const ticketListHttpSchema = z.object({
  teamKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  cursor: ticketListInputSchema.shape.cursor,
  limit: ticketListInputSchema.shape.limit,
  kind: ticketListInputSchema.shape.kind,
}).strict();

export interface TicketHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { teamKey: string; scopeKey: string }, options: Omit<RunAuthenticatedContentToolOptions, 'execute'>) => Promise<{ context: ToolContext }>;
  authorizationOptions?: Omit<RunAuthenticatedContentToolOptions, 'authenticatedUserKey' | 'execute'>;
  service?: TicketService;
}

async function authorizedRequest(c: Context, dependencies: TicketHandlerDependencies, schema: z.ZodTypeAny) {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return { response: c.json({ success: false, error: 'authentication required' }, 401) };
  const input = await parseJson(c, schema) as { teamKey: string; scopeKey: string } & Record<string, unknown>;
  const { teamKey, scopeKey, ...body } = input;
  const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, { ...dependencies.authorizationOptions, ...authenticatedTeamContext(identity) });
  return { body, context };
}

function ticketError(c: Context, error: unknown, invalid = 'invalid ticket request') {
  const billing = sparkErrorResponse(c, error); if (billing) return billing;
  if (error instanceof TicketIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 409);
  if (error instanceof TicketFeedbackRejectedError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 400);
  if (error instanceof TicketNotFoundError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 404);
  if (error instanceof InvalidTicketCursorError) return c.json({ success: false, error: error.message }, 400);
  if (error instanceof TicketAccessError) return c.json({ success: false, error: { code: error.code, message: error.message } }, 403);
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' || error.code === 'CONTENT_UNAUTHORIZED' ? 403 : error.code === 'CONTENT_NOT_FOUND' ? 404 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: invalid }, 400);
  console.error('ticket request failed', { error });
  return c.json({ success: false, error: 'ticket request could not be completed' }, 500);
}

export function createTicketHandlers(dependencies: TicketHandlerDependencies = {}) {
  const service = dependencies.service ?? getDefaultTicketService();
  return {
    create: async (c: Context) => {
      try {
        const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
        if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
        const idempotencyKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
        const request = await authorizedRequest(c, dependencies, ticketHttpInputSchema);
        if ('response' in request) return request.response;
        const input = ticketSubmitInputSchema.parse(request.body);
        return c.json({ success: true, data: await runTool('ticket.create', '', input, { contentContext: request.context, ticketService: service, requestKey: idempotencyKey }) }, 201);
      } catch (error) { return ticketError(c, error); }
    },
    list: async (c: Context) => {
      try {
        const request = await authorizedRequest(c, dependencies, ticketListHttpSchema);
        if ('response' in request) return request.response;
        return c.json({ success: true, data: await runTool('ticket.list', '', ticketListInputSchema.parse(request.body), { contentContext: request.context, ticketService: service }) });
      } catch (error) { return ticketError(c, error); }
    },
  };
}

export function createFeedbackHandlers(dependencies: TicketHandlerDependencies = {}) {
  const service = dependencies.service ?? getDefaultTicketService();
  return {
    create: async (c: Context) => {
      try {
        const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
        if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
        const idempotencyKey = ticketIdempotencyKeySchema.parse(c.req.header('idempotency-key'));
        const request = await authorizedRequest(c, dependencies, ticketHttpInputSchema);
        if ('response' in request) return request.response;
        const input = ticketSubmitInputSchema.parse({ ...request.body, kind: 'feedback' });
        return c.json({ success: true, data: await runTool('ticket.create', '', input, { contentContext: request.context, ticketService: service, requestKey: idempotencyKey }) }, 201);
      } catch (error) { return ticketError(c, error, 'invalid feedback request'); }
    },
  };
}

export const ticketHandlers = createTicketHandlers();
export const ticketHandler = ticketHandlers.create;
export const createTicketHandler = (dependencies: TicketHandlerDependencies = {}) => createTicketHandlers(dependencies).create;
export const feedbackHandlers = createFeedbackHandlers();
