import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type ToolContext } from '@/lib/ai/tools';
import { createConversationService, getDefaultConversationService, ConversationError, type ConversationService, type ConversationTurnEvent } from '@/lib/conversations/service';
import { conversationCreateInputSchema, conversationFavoriteInputSchema, conversationImageTurnRequestKeySchema, conversationImageTurnShape, conversationKeyInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationRenameInputSchema, conversationSafeMessageSchema, conversationSearchInputSchema, conversationSendInputSchema } from '@/lib/conversations/schemas';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { publishUserEvent } from './events';

const selector = { organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() };
const selected = <T extends z.ZodRawShape>(shape: T) => z.object({ ...selector, ...shape }).strict();
export const conversationStartEventSchema = z.object({ type: z.literal('start'), correlationKey: z.string().min(1), conversationKey: z.string().cuid(), userMessageKey: z.string().cuid(), assistantMessageKey: z.string().cuid() }).strict();
export const conversationDeltaEventSchema = z.object({ type: z.literal('delta'), correlationKey: z.string().min(1), assistantMessageKey: z.string().cuid(), text: z.string().min(1) }).strict();
export const conversationDoneEventSchema = z.object({ type: z.literal('done'), correlationKey: z.string().min(1), conversationKey: z.string().cuid(), message: conversationSafeMessageSchema, name: z.string().trim().min(1).max(200).optional(), replayed: z.boolean() }).strict();
export const conversationErrorEventSchema = z.object({ type: z.literal('error'), correlationKey: z.string().min(1), code: z.string().min(1), message: z.string().min(1) }).strict();

export function bindConversationStreamAbort(stream: { onAbort(callback: () => void): void }, requestSignal: AbortSignal) {
  const controller = new AbortController(); let active = true;
  const abort = () => { active = false; controller.abort(); };
  stream.onAbort(abort); requestSignal.addEventListener('abort', abort, { once: true });
  if (requestSignal.aborted) abort();
  return { signal: controller.signal, active: () => active && !controller.signal.aborted, dispose: () => { active = false; requestSignal.removeEventListener('abort', abort); } };
}

export interface ConversationHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: { authenticatedUserKey: string }) => Promise<{ context: ToolContext }>;
  service?: ConversationService;
  createTurnService?: (signal: AbortSignal) => ConversationService;
  publishChanged?: typeof publishUserEvent;
}

async function authenticated(c: Context, organizationKey: string, scopeKey: string, dependencies: ConversationHandlerDependencies): Promise<ToolContext | Response> {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
  if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
  const authorize = dependencies.authorize ?? authorizeContentExecution;
  return (await authorize({ organizationKey, scopeKey }, { authenticatedUserKey: identity.key })).context;
}
function failure(c: Context, error: unknown) {
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
  if (error instanceof ConversationError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 500);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid conversation request' }, 400);
  console.error('conversation request failed', { error }); return c.json({ success: false, error: 'conversation request failed' }, 500);
}
async function invoke(c: Context, schema: z.ZodTypeAny, run: (service: ConversationService, input: any, context: ToolContext) => Promise<unknown>, changed: boolean, dependencies: ConversationHandlerDependencies) {
  try {
    const body = await parseJson(c, schema); const { organizationKey, scopeKey, ...input } = body;
    const context = await authenticated(c, organizationKey, scopeKey, dependencies); if (context instanceof Response) return context;
    const data = await run(dependencies.service ?? getDefaultConversationService(), input, context);
    if (changed && context.principal.kind === 'member') await (dependencies.publishChanged ?? publishUserEvent)(context.principal.user.key, 'conversation.changed');
    return c.json({ success: true, data });
  } catch (error) { return failure(c, error); }
}

export function createConversationHandlers(dependencies: ConversationHandlerDependencies = {}) { return {
  create: (c: Context) => invoke(c, selected(conversationCreateInputSchema.shape), (service, input, context) => service.create(input, context), true, dependencies),
  list: (c: Context) => invoke(c, selected(conversationListInputSchema.shape), (service, input, context) => service.list(input, context), false, dependencies),
  search: (c: Context) => invoke(c, selected(conversationSearchInputSchema.shape), (service, input, context) => service.search(input, context), false, dependencies),
  rename: (c: Context) => invoke(c, selected({ name: conversationRenameInputSchema.shape.name }), (service, input, context) => service.rename({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  favorite: (c: Context) => invoke(c, selected({ isFavorite: conversationFavoriteInputSchema.shape.isFavorite }), (service, input, context) => service.favorite({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  delete: (c: Context) => invoke(c, selected({}), (service, _input, context) => service.delete(conversationKeyInputSchema.parse({ conversationKey: c.req.param('conversationKey') }), context), true, dependencies),
  messages: (c: Context) => invoke(c, selected({ cursor: conversationMessageListInputSchema.shape.cursor, limit: conversationMessageListInputSchema.shape.limit }), (service, input, context) => service.messages({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), false, dependencies),
  deleteMessage: (c: Context) => invoke(c, selected({}), (service, _input, context) => service.deleteMessage(conversationMessageDeleteInputSchema.parse({ conversationKey: c.req.param('conversationKey'), messageKey: c.req.param('messageKey') }), context), true, dependencies),
  async imageTurn(c: Context) {
    try {
      const body = await parseJson(c, selected({ prompt: conversationImageTurnShape.prompt, requestKey: conversationImageTurnRequestKeySchema, referenceImageKeys: conversationImageTurnShape.referenceImageKeys, size: conversationImageTurnShape.size, quality: conversationImageTurnShape.quality, mode: conversationImageTurnShape.mode }));
      const context = await authenticated(c, body.organizationKey, body.scopeKey, dependencies); if (context instanceof Response) return context;
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      const data = await (dependencies.service ?? getDefaultConversationService()).enqueueImageTurn({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context);
      if (context.principal.kind === 'member') await (dependencies.publishChanged ?? publishUserEvent)(context.principal.user.key, 'conversation.changed');
      return c.json({ success: true, data }, 202);
    } catch (error) { return failure(c, error); }
  },
  async turn(c: Context) {
    try {
      const body = await parseJson(c, selected({ message: z.string().trim().min(1).max(20_000), requestKey: z.string().trim().min(1).max(180), attachmentKeys: z.array(z.string().cuid()).max(10).default([]), referenceImageKeys: z.array(z.string().cuid()).max(1).default([]) }));
      const context = await authenticated(c, body.organizationKey, body.scopeKey, dependencies); if (context instanceof Response) return context;
      const input = conversationSendInputSchema.parse({ conversationKey: c.req.param('conversationKey'), message: body.message, requestKey: body.requestKey, attachmentKeys: body.attachmentKeys, referenceImageKeys: body.referenceImageKeys });
      return streamSSE(c, async (stream) => {
        const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
        const service = dependencies.createTurnService?.(abort.signal) ?? createConversationService({ router: { signal: abort.signal } });
        let correlationKey = body.requestKey;
        try {
          await service.turn(input, context, async (event: ConversationTurnEvent) => {
            if (!abort.active()) return;
            correlationKey = event.correlationKey;
            const schema = event.type === 'start' ? conversationStartEventSchema : event.type === 'delta' ? conversationDeltaEventSchema : conversationDoneEventSchema;
            const parsed = schema.parse(event); await stream.writeSSE({ event: event.type, data: JSON.stringify(parsed), id: event.correlationKey });
            if (event.type === 'done' && context.principal.kind === 'member') {
              await (dependencies.publishChanged ?? publishUserEvent)(context.principal.user.key, 'conversation.changed').catch((error) => {
                console.error('conversation change publication failed', { conversationKey: input.conversationKey, correlationKey, error });
              });
            }
          });
        } catch (error) {
          if (!abort.active()) return;
          console.error('conversation turn failed', { conversationKey: input.conversationKey, correlationKey, error });
          const event = conversationErrorEventSchema.parse({ type: 'error', correlationKey, code: error instanceof ConversationError ? error.code : 'FAILED', message: error instanceof ConversationError ? error.message : 'Conversation turn failed.' });
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
        } finally { abort.dispose(); }
      });
    } catch (error) { return failure(c, error); }
  },
}; }

export const conversationHandlers = createConversationHandlers();
