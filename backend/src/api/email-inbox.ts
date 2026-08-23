import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { FoundersAccessError } from '@/lib/founders/access';
import { createEmailOAuthService, type EmailOAuthService } from '@/lib/email-inbox/oauth';
import { createEmailService, EmailRepositoryError, emailMessageGeneratedListInputSchema, emailMessageSummarizeInputSchema, emailMessageTranslateInputSchema, emailReplyContextCreateInputSchema, emailReplyContextDeleteInputSchema, emailReplyContextUpdateInputSchema, emailSimilarFindInputSchema, emailThreadTrashInputSchema, emailToneCreateInputSchema, emailToneSelectorSchema, emailToneUpdateInputSchema, inboxSortInputSchema, inboxUpdateInputSchema, publicEmailSummaryListResultSchema, publicEmailSummaryResultSchema, publicEmailTranslationListResultSchema, publicEmailTranslationResultSchema, type EmailService } from '@/lib/email-inbox/service';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';
import { emailAttachmentRefsSchema } from '@/lib/email-inbox/archive-payloads';

const contextSchema = strictObject({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() });
const threadKeySchema = z.string().cuid();
const connectorKeySchema = z.string().cuid();
class EmailHttpError extends Error { constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 503, readonly code: string, message: string) { super(message); } }

export function createEmailHandlers(options: { service?: EmailService; oauth?: EmailOAuthService; getIdentity?: typeof getAuthIdentity } = {}) {
  const service = options.service ?? createEmailService();
  const oauth = options.oauth ?? createEmailOAuthService();
  const getIdentity = options.getIdentity ?? getAuthIdentity;
  const identity = async (c: Context) => {
    const current = await getIdentity(c);
    if (!current) throw new EmailHttpError(401, 'EMAIL_UNAUTHORIZED', 'Authentication required.');
    return current;
  };
  const actor = async (c: Context, body: unknown) => {
    const current = await identity(c);
    const value = z.record(z.unknown()).parse(body);
    const context = contextSchema.parse({ organizationKey: value.organizationKey, scopeKey: value.scopeKey });
    return { userKey: current.key, ...context };
  };
  const run = (operation: (c: Context) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    try { return c.json({ success: true, data: await operation(c) }, status); }
    catch (error) {
      if (error instanceof EmailHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof FoundersAccessError) return c.json({ success: false, error: { code: 'EMAIL_FORBIDDEN', message: 'Email scope access denied.' } }, 403);
      if (error instanceof EmailRepositoryError) {
        const status = error.reason === 'not_found' ? 404 : error.reason === 'forbidden' ? 403 : 409;
        return c.json({ success: false, error: { code: `EMAIL_${error.reason.toUpperCase()}`, message: error.message } }, status);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'EMAIL_INVALID_INPUT', message: 'Email request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'EMAIL_FAILED', message: 'Email request failed.' } }, 500);
    }
  };
  return {
    overview: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema.optional(), filter: z.enum(['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite']).optional(), search: z.string().trim().max(200).optional(), cursor: z.string().min(1).max(2_000).optional(), limit: z.number().int().min(1).max(50).optional() }).parse(await c.req.json());
      return service.overview(await actor(c, body), { connectorKey: body.connectorKey, filter: body.filter, search: body.search, cursor: body.cursor, limit: body.limit });
    }),
    startConnect: run(async (c) => {
       const body = strictObject({ ...contextSchema.shape, name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).optional(), returnUri: z.string().url() }).parse(await c.req.json());
      const current = await identity(c);
      return oauth.start({ userKey: current.key, organizationKey: body.organizationKey, scopeKey: body.scopeKey, name: body.name, description: body.description, returnUri: body.returnUri });
    }),
    callback: async (c: Context) => {
      try {
        const input = strictObject({
          state: z.string().startsWith('vrtx_email_state_').max(256), code: z.string().min(1).max(4096).optional(), error: z.string().max(200).optional(),
          scope: z.string().max(2000).optional(), authuser: z.string().max(20).optional(), prompt: z.string().max(200).optional(), hd: z.string().max(320).optional(),
          error_description: z.string().max(1000).optional(), error_subtype: z.string().max(200).optional(),
        }).parse(Object.fromEntries(new URL(c.req.url).searchParams));
        return c.redirect(await oauth.callback(input), 302);
      } catch { return c.json({ success: false, error: { code: 'EMAIL_OAUTH_FAILED', message: 'Email authorization failed.' } }, 400); }
    },
    exchangeConnect: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, code: z.string().startsWith('vrtx_email_grant_').max(256) }).parse(await c.req.json());
      const current = await identity(c);
      const result = await oauth.exchange({ userKey: current.key, organizationKey: body.organizationKey, scopeKey: body.scopeKey, code: body.code });
      if (!result) throw new EmailHttpError(401, 'EMAIL_GRANT_INVALID', 'Email connection grant is invalid or expired.');
      return result;
    }),
    sync: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return service.sync(await actor(c, body), body.connectorKey); }),
    sort: run(async (c) => { const body = strictObject({ ...contextSchema.shape, ...inboxSortInputSchema.shape }).parse(await c.req.json()); return service.sort(await actor(c, body), { connectorKey: body.connectorKey }); }),
    subscribe: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return service.subscribe(await actor(c, body), body.connectorKey); }),
    thread: run(async (c) => { const body = strictObject({ ...contextSchema.shape, markRead: z.boolean().optional() }).parse(await c.req.json()); const current = await actor(c, body); const threadKey = threadKeySchema.parse(c.req.param('threadKey')); return service.threadForHttp(current, threadKey, body.markRead !== false); }),
    favorite: run(async (c) => { const body = strictObject({ ...contextSchema.shape, isFavorite: z.boolean() }).parse(await c.req.json()); return service.setFavorite(await actor(c, body), threadKeySchema.parse(c.req.param('threadKey')), body.isFavorite); }),
    trashThread: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.trashThread(await actor(c, body), emailThreadTrashInputSchema.parse({ threadKey: c.req.param('threadKey') })); }),
    findSimilar: run(async (c) => { const body = strictObject({ ...contextSchema.shape, categories: z.array(z.enum(['Urgent', 'Important', 'Filtered'])).min(1).max(3).optional(), limit: z.number().int().min(1).max(20).optional() }).parse(await c.req.json()); return service.findSimilar(await actor(c, body), emailSimilarFindInputSchema.parse({ messageKey: c.req.param('messageKey'), categories: body.categories, limit: body.limit })); }),
    translateMessage: run(async (c) => { const body = strictObject({ ...contextSchema.shape, targetLanguage: emailMessageTranslateInputSchema.shape.targetLanguage, sourceLanguage: emailMessageTranslateInputSchema.shape.sourceLanguage }).parse(await c.req.json()); return publicEmailTranslationResultSchema.parse(await service.translateMessage(await actor(c, body), { messageKey: c.req.param('messageKey'), targetLanguage: body.targetLanguage, sourceLanguage: body.sourceLanguage })); }, 201),
    listMessageTranslations: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return publicEmailTranslationListResultSchema.parse(await service.listMessageTranslations(await actor(c, body), emailMessageGeneratedListInputSchema.parse({ messageKey: c.req.param('messageKey') }))); }),
    summarizeMessage: run(async (c) => { const body = strictObject({ ...contextSchema.shape, topic: emailMessageSummarizeInputSchema.shape.topic, style: emailMessageSummarizeInputSchema.shape.style.optional(), language: emailMessageSummarizeInputSchema.shape.language }).parse(await c.req.json()); return publicEmailSummaryResultSchema.parse(await service.summarizeMessage(await actor(c, body), { messageKey: c.req.param('messageKey'), topic: body.topic, style: body.style, language: body.language })); }, 201),
    listMessageSummaries: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return publicEmailSummaryListResultSchema.parse(await service.listMessageSummaries(await actor(c, body), emailMessageGeneratedListInputSchema.parse({ messageKey: c.req.param('messageKey') }))); }),
    draft: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, threadKey: threadKeySchema, tone: emailToneSelectorSchema, instruction: z.string().trim().max(1000).optional(), profileKey: z.string().cuid().optional(), attachments: emailAttachmentRefsSchema.optional() }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return service.draft(await actor(c, body), input);
    }, 201),
    draftNew: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema.optional(), to: z.array(z.string().email()).min(1).max(50), cc: z.array(z.string().email()).max(50).optional(), bcc: z.array(z.string().email()).max(50).optional(), subject: z.string().trim().min(1).max(998), tone: emailToneSelectorSchema, instruction: z.string().trim().max(1000).optional(), attachments: emailAttachmentRefsSchema.optional() }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return service.draftNew(await actor(c, body), input);
    }, 201),
    tones: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.tones(await actor(c, body)); }),
    listReplyContext: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.listReplyContext(await actor(c, body)); }),
    createReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, ...emailReplyContextCreateInputSchema.shape }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body; return service.createReplyContext(await actor(c, body), input); }, 201),
    updateReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, name: z.string().trim().min(1).max(255).optional(), text: z.string().trim().min(1).max(4_000).optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...patch } = body; return service.updateReplyContext(await actor(c, body), emailReplyContextUpdateInputSchema.parse({ noteKey: c.req.param('noteKey'), ...patch })); }),
    deleteReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, noteKeys: z.array(threadKeySchema).min(1).max(20) }).parse(await c.req.json()); return service.deleteReplyContext(await actor(c, body), emailReplyContextDeleteInputSchema.parse({ noteKeys: body.noteKeys })); }),
    createTone: run(async (c) => { const body = strictObject({ ...contextSchema.shape, ...emailToneCreateInputSchema.shape }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body; return service.createTone(await actor(c, body), input); }, 201),
    updateTone: run(async (c) => { const transport = strictObject({ ...contextSchema.shape, name: z.string().trim().min(1).max(255).optional(), description: z.string().trim().min(1).max(10_000).nullable().optional(), instruction: z.string().trim().min(1).max(20_000).optional(), coverImageKey: connectorKeySchema.nullable().optional(), isFavorite: z.boolean().optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...patch } = transport; const input = emailToneUpdateInputSchema.parse({ toneKey: c.req.param('toneKey'), ...patch }); return service.updateTone(await actor(c, transport), input); }),
    updateInbox: run(async (c) => { const transport = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema, name: z.string().trim().min(1).max(255).optional(), description: z.string().trim().min(1).max(10_000).nullable().optional(), coverImageKey: connectorKeySchema.nullable().optional(), isFavorite: z.boolean().optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...rawInput } = transport; return service.updateInbox(await actor(c, transport), inboxUpdateInputSchema.parse(rawInput)); }),
    updateDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, finalContent: z.string().trim().min(1).max(50_000) }).parse(await c.req.json()); return service.updateDraft(await actor(c, body), z.string().cuid().parse(c.req.param('draftKey')), body.finalContent); }),
    assignDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return service.assignDraft(await actor(c, body), { draftKey: z.string().cuid().parse(c.req.param('draftKey')), connectorKey: body.connectorKey }); }),
    sendDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema.optional() }).parse(await c.req.json()); return service.sendDraft(await actor(c, body), z.string().cuid().parse(c.req.param('draftKey')), body.connectorKey); }),
    disconnect: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return service.disconnect(await actor(c, body), body.connectorKey); }),
  };
}

export const emailHandlers = createEmailHandlers();
