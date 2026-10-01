import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z, ZodError } from 'zod';
import { authorizeContentExecution, ContentError, type ToolContext } from '@/lib/ai/tools';
import { createConversationService, getDefaultConversationService, ConversationError, type ConversationService, type ConversationTurnEvent } from '@/lib/conversations/service';
import { conversationContextSeedInputSchema, conversationCreateServiceInputSchema, conversationFavoriteInputSchema, conversationHiddenInputSchema, conversationIncognitoSendInputSchema, conversationKeyInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationRenameInputSchema, conversationRoleInputSchema, conversationSafeMessageSchema, conversationSearchInputSchema, conversationSendInputSchema } from '@/lib/conversations/schemas';
import { roleKeySchema } from '@/lib/ai/roles';
import type { ConversationSeedEvent } from '@/lib/conversations/service';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { publishUserEvent } from './events';
import { projectSparkError, sparkErrorResponse } from './errors';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import { authenticatedTeamContext } from './auth';

const selector = { scopeKey: z.string().cuid() };
const selected = <T extends z.ZodRawShape>(shape: T) => z.object({ ...selector, ...shape }).strict();
export const conversationStartEventSchema = z.object({ type: z.literal('start'), correlationKey: z.string().min(1), conversationKey: z.string().cuid(), userMessageKey: z.string().cuid(), assistantMessageKey: z.string().cuid(), userMessage: conversationSafeMessageSchema }).strict();
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
  authorize?: (input: { scopeKey: string }, options: { authenticatedUserKey: string; teamAssurance?: ToolContext['teamAssurance'] }) => Promise<{ context: ToolContext }>;
  service?: ConversationService;
  createTurnService?: (signal: AbortSignal) => ConversationService;
  publishChanged?: typeof publishUserEvent;
  recordEvent?: ToolEventRecorder;
  billing?: ToolBillingDependencies;
}

async function authenticated(c: Context, scopeKey: string, dependencies: ConversationHandlerDependencies): Promise<ToolContext | Response> {
  const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
  if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
  const authorize = dependencies.authorize ?? authorizeContentExecution;
  return (await authorize({ scopeKey }, authenticatedTeamContext(identity))).context;
}
function failure(c: Context, error: unknown) {
  const billing = sparkErrorResponse(c, error); if (billing) return billing;
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
  if (error instanceof ConversationError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.code === 'FORBIDDEN' ? 403 : error.code === 'NOT_FOUND' ? 404 : error.code === 'CONFLICT' ? 409 : 500);
  if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: 'invalid conversation request' }, 400);
  console.error('conversation request failed', { error }); return c.json({ success: false, error: 'conversation request failed' }, 500);
}
async function invoke(c: Context, schema: z.ZodTypeAny, run: (service: ConversationService, input: any, context: ToolContext) => Promise<unknown>, changed: boolean, dependencies: ConversationHandlerDependencies) {
  try {
    const body = await parseJson(c, schema); const { scopeKey, ...input } = body;
    const context = await authenticated(c, scopeKey, dependencies); if (context instanceof Response) return context;
    const data = await run(dependencies.service ?? getDefaultConversationService(), input, context);
    if (changed && context.principal.kind === 'member') await (dependencies.publishChanged ?? publishUserEvent)(context.principal.user.key, 'conversation.changed');
    return c.json({ success: true, data });
  } catch (error) { return failure(c, error); }
}

export function createConversationHandlers(dependencies: ConversationHandlerDependencies = {}) { return {
  create: (c: Context) => invoke(c, selected({ name: z.string().trim().min(1).max(200).optional(), roleKey: roleKeySchema.optional(), openingGreetingToken: z.string().trim().min(1).max(20_000).optional(), openingContextSeedToken: z.string().trim().min(1).max(40_000).optional() }), (service, input, context) => service.create(input, context), true, dependencies),
  list: (c: Context) => invoke(c, selected(conversationListInputSchema.shape), (service, input, context) => service.list(input, context), false, dependencies),
  search: (c: Context) => invoke(c, selected(conversationSearchInputSchema.shape), (service, input, context) => service.search(input, context), false, dependencies),
  rename: (c: Context) => invoke(c, selected({ name: conversationRenameInputSchema.shape.name }), (service, input, context) => service.rename({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  favorite: (c: Context) => invoke(c, selected({ isFavorite: conversationFavoriteInputSchema.shape.isFavorite }), (service, input, context) => service.favorite({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  setRole: (c: Context) => invoke(c, selected({ roleKey: conversationRoleInputSchema.shape.roleKey }), (service, input, context) => service.setRole({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  hide: (c: Context) => invoke(c, selected({ isHidden: conversationHiddenInputSchema.shape.isHidden }), (service, input, context) => service.hide({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), true, dependencies),
  delete: (c: Context) => invoke(c, selected({}), (service, _input, context) => service.delete(conversationKeyInputSchema.parse({ conversationKey: c.req.param('conversationKey') }), context), true, dependencies),
  messages: (c: Context) => invoke(c, selected({ cursor: conversationMessageListInputSchema.shape.cursor, limit: conversationMessageListInputSchema.shape.limit }), (service, input, context) => service.messages({ ...input, conversationKey: z.string().cuid().parse(c.req.param('conversationKey')) }, context), false, dependencies),
  deleteMessage: (c: Context) => invoke(c, selected({}), (service, _input, context) => service.deleteMessage(conversationMessageDeleteInputSchema.parse({ conversationKey: c.req.param('conversationKey'), messageKey: c.req.param('messageKey') }), context), true, dependencies),
  async seedContext(c: Context) {
    try {
      const body = await parseJson(c, selected({ conversationKeys: conversationContextSeedInputSchema.shape.conversationKeys }));
      const context = await authenticated(c, body.scopeKey, dependencies); if (context instanceof Response) return context;
      const input = conversationContextSeedInputSchema.parse({ conversationKeys: body.conversationKeys });
      return streamSSE(c, async (stream) => {
        const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
        const service = dependencies.createTurnService?.(abort.signal) ?? createConversationService({ router: { signal: abort.signal } });
        let correlationKey = body.conversationKeys[0] ?? 'seed';
        try {
          await observeToolExecution('conversation.message.send', context, () => service.seedContext(input, context, async (event: ConversationSeedEvent) => {
            if (!abort.active()) return;
            correlationKey = event.correlationKey;
            await stream.writeSSE({ event: event.type, data: JSON.stringify(event), id: event.correlationKey });
          }), { recorder: dependencies.recordEvent, idempotencyKey: `seed:${body.conversationKeys.join(',')}`, input, ...dependencies.billing });
        } catch (error) {
          if (!abort.active()) return;
          console.error('conversation context seed failed', { correlationKey, error });
          const billing = projectSparkError(error);
          const event = conversationErrorEventSchema.parse({ type: 'error', correlationKey, code: billing?.body.error.code ?? (error instanceof ConversationError ? error.code : 'FAILED'), message: billing?.body.error.message ?? (error instanceof ConversationError ? error.message : 'Conversation context seed failed.') });
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
        } finally { abort.dispose(); }
      });
    } catch (error) { return failure(c, error); }
  },
  async incognitoTurn(c: Context) {
    try {
      if (c.req.query('incognito') !== 'true') return c.json({ success: false, error: 'incognito query is required' }, 400);
       const body = await parseJson(c, selected({ message: z.string().trim().min(1).max(20_000), requestKey: z.string().trim().min(1).max(180), attachmentKeys: z.array(z.string().cuid()).max(0).default([]), referenceImageKeys: z.array(z.string().cuid()).max(0).default([]), workspaceFileKeys: z.array(z.string().cuid()).max(50).default([]), workspaceFolderKeys: z.array(z.string().cuid()).max(50).default([]), history: z.array(z.object({ role: z.enum(['USER', 'ASSISTANT']), content: z.string().trim().min(1).max(20_000) }).strict()).max(20).default([]) }));
      const context = await authenticated(c, body.scopeKey, dependencies); if (context instanceof Response) return context;
      const input = conversationIncognitoSendInputSchema.parse({ message: body.message, requestKey: body.requestKey, roleKey: c.req.query('role') ?? 'general', attachmentKeys: body.attachmentKeys, referenceImageKeys: body.referenceImageKeys, workspaceFileKeys: body.workspaceFileKeys, workspaceFolderKeys: body.workspaceFolderKeys, history: body.history });
       return streamSSE(c, async (stream) => {
         const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
         const service = dependencies.createTurnService?.(abort.signal) ?? createConversationService({ router: { signal: abort.signal, providers: c.req.query('reply') === 'reason' ? ['text.secondary'] : ['text.primary'] } });
         let correlationKey = body.requestKey;
         let doneEvent: z.infer<typeof conversationDoneEventSchema> | undefined;
         try {
          await observeToolExecution('conversation.message.send', context, () => service.incognitoTurn(input, context, async (event: ConversationTurnEvent) => {
            if (!abort.active()) return;
            correlationKey = event.correlationKey;
            const schema = event.type === 'start' ? conversationStartEventSchema : event.type === 'delta' ? conversationDeltaEventSchema : conversationDoneEventSchema;
            const parsed = schema.parse(event);
            if (event.type === 'done') { doneEvent = parsed as z.infer<typeof conversationDoneEventSchema>; return; }
            await stream.writeSSE({ event: event.type, data: JSON.stringify(parsed), id: event.correlationKey });
          }), { recorder: dependencies.recordEvent, idempotencyKey: body.requestKey, input, ...dependencies.billing });
          if (!abort.active()) return;
          if (!doneEvent) throw new ConversationError('FAILED', 'Conversation completed without a terminal event.');
          await stream.writeSSE({ event: 'done', data: JSON.stringify(doneEvent), id: doneEvent.correlationKey });
        } catch (error) {
          if (!abort.active()) return;
          console.error('incognito conversation turn failed', { correlationKey, error });
          const billing = projectSparkError(error);
          const event = conversationErrorEventSchema.parse({ type: 'error', correlationKey, code: billing?.body.error.code ?? (error instanceof ConversationError ? error.code : 'FAILED'), message: billing?.body.error.message ?? (error instanceof ConversationError ? error.message : 'Conversation turn failed.') });
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
          } finally { abort.dispose(); }
      });
    } catch (error) { return failure(c, error); }
  },
  async turn(c: Context) {
    try {
       const body = await parseJson(c, selected({ message: z.string().trim().min(1).max(20_000), requestKey: z.string().trim().min(1).max(180), attachmentKeys: z.array(z.string().cuid()).max(12).default([]), referenceImageKeys: z.array(z.string().cuid()).max(0).default([]), workspaceFileKeys: z.array(z.string().cuid()).max(50).default([]), workspaceFolderKeys: z.array(z.string().cuid()).max(50).default([]), contextConversationKeys: z.array(z.string().cuid()).max(20).default([]) }));
      const context = await authenticated(c, body.scopeKey, dependencies); if (context instanceof Response) return context;
       const input = conversationSendInputSchema.parse({ conversationKey: c.req.param('conversationKey'), message: body.message, requestKey: body.requestKey, roleKey: c.req.query('role'), attachmentKeys: body.attachmentKeys, referenceImageKeys: body.referenceImageKeys, workspaceFileKeys: body.workspaceFileKeys, workspaceFolderKeys: body.workspaceFolderKeys, contextConversationKeys: body.contextConversationKeys });
      return streamSSE(c, async (stream) => {
        const abort = bindConversationStreamAbort(stream, c.req.raw.signal);
        const service = dependencies.createTurnService?.(abort.signal) ?? createConversationService({ router: { signal: abort.signal, providers: c.req.query('reply') === 'reason' ? ['text.secondary'] : ['text.primary'] } });
        let correlationKey = body.requestKey;
         let doneEvent: z.infer<typeof conversationDoneEventSchema> | undefined;
        try {
          await observeToolExecution('conversation.message.send', context, () => service.turn(input, context, async (event: ConversationTurnEvent) => {
            if (!abort.active()) return;
            correlationKey = event.correlationKey;
            const schema = event.type === 'start' ? conversationStartEventSchema : event.type === 'delta' ? conversationDeltaEventSchema : conversationDoneEventSchema;
            const parsed = schema.parse(event);
            if (event.type === 'done') { doneEvent = parsed as z.infer<typeof conversationDoneEventSchema>; return; }
            await stream.writeSSE({ event: event.type, data: JSON.stringify(parsed), id: event.correlationKey });
          }), { recorder: dependencies.recordEvent, idempotencyKey: body.requestKey, input, ...dependencies.billing });
          if (!abort.active()) return;
          if (!doneEvent) throw new ConversationError('FAILED', 'Conversation completed without a terminal event.');
          await stream.writeSSE({ event: 'done', data: JSON.stringify(doneEvent), id: doneEvent.correlationKey });
          if (context.principal.kind === 'member') {
            void (dependencies.publishChanged ?? publishUserEvent)(context.principal.user.key, 'conversation.changed').catch((error) => {
              console.error('conversation change publication failed', { conversationKey: input.conversationKey, correlationKey, error });
            });
          }
        } catch (error) {
          if (!abort.active()) return;
          console.error('conversation turn failed', { conversationKey: input.conversationKey, correlationKey, error });
          const billing = projectSparkError(error);
          const event = conversationErrorEventSchema.parse({ type: 'error', correlationKey, code: billing?.body.error.code ?? (error instanceof ConversationError ? error.code : 'FAILED'), message: billing?.body.error.message ?? (error instanceof ConversationError ? error.message : 'Conversation turn failed.') });
          await stream.writeSSE({ event: 'error', data: JSON.stringify(event), id: correlationKey });
        } finally { abort.dispose(); }
      });
    } catch (error) { return failure(c, error); }
  },
}; }

export const conversationHandlers = createConversationHandlers();
