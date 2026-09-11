import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, runTool } from '@/lib/ai/tools';
import { communicationHistoryInputSchema, communicationMarkReadInputSchema, communicationSendInputSchema, communicationThreadInputSchema } from '@/lib/user-inbox/schemas';
import { UserInboxAccessError, UserInboxIdempotencyError, UserInboxNotFoundError, userInboxService, type UserInboxService } from '@/lib/user-inbox/service';
import { InvalidCommunicationCursorError } from '@/lib/user-inbox/repository';
import { authenticatedTeamContext } from './auth';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const selectorSchema = z.object({ teamKey: z.string().cuid(), scopeKey: z.string().cuid() }).strict();
const listHttpSchema = selectorSchema.extend(communicationHistoryInputSchema.shape).strict();
const markReadHttpSchema = selectorSchema.extend({ read: communicationMarkReadInputSchema.shape.read.optional() }).strict();
const sendHttpSchema = selectorSchema.extend({ message: communicationSendInputSchema.shape.message }).strict();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof UserInboxNotFoundError) return c.json({ success: false, error: error.message }, 404);
  if (error instanceof UserInboxIdempotencyError) return c.json({ success: false, error: error.message }, 409);
  if (error instanceof InvalidCommunicationCursorError) return c.json({ success: false, error: error.message }, 400);
  if (error instanceof UserInboxAccessError) return c.json({ success: false, error: error.message }, 403);
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code.includes('FORBIDDEN') || error.code.includes('UNAUTHORIZED') ? 403 : 400);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid communication request' }, 400);
  console.error('communication request failed', { error });
  return c.json({ success: false, error: 'communication request could not be completed' }, 500);
}

export function createUserInboxHandlers(dependencies: { service?: UserInboxService; getIdentity?: typeof getAuthIdentity; authorize?: typeof authorizeContentExecution } = {}) {
  const service = dependencies.service ?? userInboxService;
  const request = async (c: Context, schema: z.ZodTypeAny) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return { response: c.json({ success: false, error: 'authentication required' }, 401) };
    if (identity.identityType !== 'user') return { response: c.json({ success: false, error: 'user session required' }, 403) };
    const { teamKey, scopeKey, ...input } = await parseJson(c, schema) as { teamKey: string; scopeKey: string } & Record<string, unknown>;
    const { context } = await (dependencies.authorize ?? authorizeContentExecution)({ teamKey, scopeKey }, authenticatedTeamContext(identity));
    return { context, input };
  };
  const execute = async (c: Context, name: string, schema: z.ZodTypeAny, inputSchema: z.ZodTypeAny) => {
    try {
      const result = await request(c, schema); if ('response' in result) return result.response;
      return c.json({ success: true, data: await runTool(name, '', inputSchema.parse(result.input), { contentContext: result.context, userInboxService: service, requestKey: c.req.header('idempotency-key') }) });
    } catch (error) { return errorResponse(c, error); }
  };
  return {
    list: (c: Context) => execute(c, 'app.history', listHttpSchema, communicationHistoryInputSchema),
    read: async (c: Context) => {
      try { const result = await request(c, selectorSchema); if ('response' in result) return result.response; const input = communicationThreadInputSchema.parse({ threadKey: c.req.param('threadKey') }); return c.json({ success: true, data: await runTool('communication.thread.read', '', input, { contentContext: result.context, userInboxService: service }) }); } catch (error) { return errorResponse(c, error); }
    },
    markRead: async (c: Context) => {
      try { const result = await request(c, markReadHttpSchema); if ('response' in result) return result.response; const input = communicationMarkReadInputSchema.parse({ ...result.input, threadKey: c.req.param('threadKey') }); return c.json({ success: true, data: await runTool('communication.thread.mark-read', '', input, { contentContext: result.context, userInboxService: service }) }); } catch (error) { return errorResponse(c, error); }
    },
    send: async (c: Context) => {
      try { const result = await request(c, sendHttpSchema); if ('response' in result) return result.response; const input = communicationSendInputSchema.parse({ ...result.input, threadKey: c.req.param('threadKey') }); return c.json({ success: true, data: await runTool('communication.message.send', '', input, { contentContext: result.context, userInboxService: service, requestKey: c.req.header('idempotency-key') }) }, 201); } catch (error) { return errorResponse(c, error); }
    },
  };
}

export const userInboxHandlers = createUserInboxHandlers();
