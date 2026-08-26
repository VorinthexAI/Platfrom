import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { FoundersAccessError } from '@/lib/founders/access';
import { createEmailOAuthService, type EmailOAuthService } from '@/lib/email-inbox/oauth';
import { createEmailService, EmailIdempotencyError, EmailRepositoryError, emailDraftComposeInputSchema, emailDraftComposeInputShape, emailDraftCreateInputSchema, emailDraftDeleteInputSchema, emailDraftUpdateInputSchema, emailMessageGeneratedListInputSchema, emailMessageSummarizeInputSchema, emailMessageSummaryDeleteInputSchema, emailMessageTranslationDeleteInputSchema, emailOverviewInputSchema, emailOverviewInputShape, emailReplyContextCreateInputSchema, emailReplyContextDeleteInputSchema, emailReplyContextUpdateInputSchema, emailSemanticSearchInputSchema, emailSimilarFindInputSchema, emailThreadFavoriteInputSchema, emailThreadReadStateInputSchema, emailThreadTrashInputSchema, emailToneCreateInputSchema, emailToneDeleteInputSchema, emailToneUpdateInputSchema, emailTrashClearInputSchema, inboxUpdateInputSchema, publicEmailDraftSchema, publicEmailGeneratedDeleteResultSchema, publicEmailInboxSchema, publicEmailOverviewSchema, publicEmailSummaryListResultSchema, publicEmailSummaryResultSchema, publicEmailTranslationListResultSchema, type EmailService } from '@/lib/email-inbox/service';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';

const contextSchema = strictObject({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() });
const threadKeySchema = z.string().cuid();
const connectorKeySchema = z.string().cuid();
const connectorSelectorSchema = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema });
const legacyConnectorSchema = publicEmailInboxSchema.transform(({ initialSyncCompleted: _initialSyncCompleted, ...connector }) => connector);
const legacyOverviewSchema = publicEmailOverviewSchema.transform((overview) => ({
  ...overview,
  accounts: overview.accounts.map((connector) => legacyConnectorSchema.parse(connector)),
  selectedAccount: overview.selectedAccount ? legacyConnectorSchema.parse(overview.selectedAccount) : null,
}));
const legacyScoredConnectorSchema = publicEmailInboxSchema.extend({ score: z.number().min(-1).max(1) }).strict()
  .transform(({ initialSyncCompleted: _initialSyncCompleted, ...connector }) => connector);
const legacyInboxSearchSchema = z.object({ inboxes: z.array(legacyScoredConnectorSchema) }).strict();
const legacySyncResultSchema = z.object({ synced: z.number().int().nonnegative(), busy: z.boolean().optional(), lastSyncedAt: z.string().datetime().nullable() }).passthrough()
  .transform(({ synced, busy, lastSyncedAt }) => ({ synced, ...(busy === undefined ? {} : { busy }), lastSyncedAt }));
const legacySubscribeResultSchema = z.object({ watchExpiresAt: z.string().datetime().nullable().optional(), skipped: z.literal(true).optional() }).passthrough()
  .transform(({ watchExpiresAt, skipped }) => ({ ...(watchExpiresAt ? { watchExpiresAt } : {}), ...(skipped ? { skipped } : {}) }));
const usesCurrentConnectorTransport = (c: Context) => c.req.header('x-vorinthex-email-transport') === '2';
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
  const requestKey = (c: Context) => {
    const value = c.req.header('idempotency-key')?.trim();
    return value ? z.string().min(1).max(200).parse(value) : undefined;
  };
  const run = (operation: (c: Context) => Promise<unknown>, status: 200 | 201 = 200) => async (c: Context) => {
    try { return c.json({ success: true, data: await operation(c) }, status); }
    catch (error) {
      if (error instanceof EmailHttpError) return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status);
      if (error instanceof FoundersAccessError) return c.json({ success: false, error: { code: 'EMAIL_FORBIDDEN', message: 'Email scope access denied.' } }, 403);
      if (error instanceof EmailIdempotencyError) return c.json({ success: false, error: { code: error.code, message: error.message, retryable: error.retryable } }, 409);
      if (error instanceof EmailRepositoryError) {
        const status = error.reason === 'not_found' ? 404 : error.reason === 'forbidden' ? 403 : 409;
        return c.json({ success: false, error: { code: `EMAIL_${error.reason.toUpperCase()}`, message: error.message } }, status);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'EMAIL_INVALID_INPUT', message: 'Email request input was invalid.' } }, 400);
      return c.json({ success: false, error: { code: 'EMAIL_FAILED', message: 'Email request failed.' } }, 500);
    }
  };
  const singularThread = (result: Awaited<ReturnType<EmailService['setFavorite']>>) => {
    const item = result.items[0];
    if (item?.status === 'succeeded') return item.thread;
    throw new EmailRepositoryError(item?.error.toLowerCase().includes('not found') ? 'not_found' : 'conflict', item?.error ?? 'Email thread operation failed');
  };
  return {
    overview: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, ...emailOverviewInputShape }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      const result = await service.overview(await actor(c, body), emailOverviewInputSchema.parse(input));
      return (usesCurrentConnectorTransport(c) ? publicEmailOverviewSchema : legacyOverviewSchema).parse(result);
    }),
    searchInboxes: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, ...emailSemanticSearchInputSchema.shape }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      const result = await service.searchInboxes(await actor(c, body), input, { signal: c.req.raw.signal, timeoutMs: 10_000 });
      return usesCurrentConnectorTransport(c)
        ? z.object({ inboxes: z.array(publicEmailInboxSchema.extend({ score: z.number().min(-1).max(1) }).strict()) }).strict().parse(result)
        : legacyInboxSearchSchema.parse(result);
    }),
    searchTones: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, ...emailSemanticSearchInputSchema.shape }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return service.searchTones(await actor(c, body), input, { signal: c.req.raw.signal, timeoutMs: 10_000 });
    }),
    startConnect: run(async (c) => {
       const body = strictObject({ ...contextSchema.shape, provider: z.literal('gmail').default('gmail'), name: z.string().trim().min(1).max(255), description: z.string().trim().min(1).max(10_000).optional(), returnUri: z.string().url() }).parse(await c.req.json());
      const current = await identity(c);
      return oauth.start({ userKey: current.key, organizationKey: body.organizationKey, scopeKey: body.scopeKey, provider: body.provider, name: body.name, description: body.description, returnUri: body.returnUri });
    }),
    callback: async (c: Context) => {
      try {
        const input = strictObject({
          state: z.string().startsWith('vrtx_email_state_').max(256), code: z.string().min(1).max(4096).optional(), error: z.string().max(200).optional(),
          scope: z.string().max(2000).optional(), authuser: z.string().max(20).optional(), prompt: z.string().max(200).optional(), hd: z.string().max(320).optional(),
          error_description: z.string().max(1000).optional(), error_subtype: z.string().max(200).optional(), session_state: z.string().max(500).optional(),
        }).parse(Object.fromEntries(new URL(c.req.url).searchParams));
        return c.redirect(await oauth.callback(input), 302);
      } catch { return c.json({ success: false, error: { code: 'EMAIL_OAUTH_FAILED', message: 'Email authorization failed.' } }, 400); }
    },
    exchangeConnect: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, code: z.string().startsWith('vrtx_email_grant_').max(256) }).parse(await c.req.json());
      const current = await identity(c);
      const result = await oauth.exchange({ userKey: current.key, organizationKey: body.organizationKey, scopeKey: body.scopeKey, code: body.code });
      if (!result) throw new EmailHttpError(401, 'EMAIL_GRANT_INVALID', 'Email connection grant is invalid or expired.');
      return (usesCurrentConnectorTransport(c) ? publicEmailInboxSchema : legacyConnectorSchema).parse(result);
    }),
    sync: run(async (c) => { const body = connectorSelectorSchema.parse(await c.req.json()); return legacySyncResultSchema.parse(await service.sync(await actor(c, body), body.connectorKey)); }),
    subscribe: run(async (c) => { const body = connectorSelectorSchema.parse(await c.req.json()); return legacySubscribeResultSchema.parse(await service.registerWatch(await actor(c, body), body.connectorKey)); }),
    thread: run(async (c) => { const body = strictObject({ ...contextSchema.shape, cursor: z.string().min(1).max(2_000).optional() }).parse(await c.req.json()); return service.threadForTool(await actor(c, body), threadKeySchema.parse(c.req.param('threadKey')), body.cursor); }),
    favorite: run(async (c) => { const body = strictObject({ ...contextSchema.shape, isFavorite: z.boolean() }).parse(await c.req.json()); return singularThread(await service.setFavorite(await actor(c, body), { threadKey: threadKeySchema.parse(c.req.param('threadKey')), isFavorite: body.isFavorite }, false, requestKey(c))); }),
    favoriteBulk: run(async (c) => { const body = strictObject({ ...contextSchema.shape, threadKeys: emailThreadFavoriteInputSchema.options[1].shape.threadKeys, isFavorite: z.boolean() }).parse(await c.req.json()); return service.setFavorite(await actor(c, body), { threadKeys: body.threadKeys, isFavorite: body.isFavorite }, false, requestKey(c)); }),
    readState: run(async (c) => { const body = strictObject({ ...contextSchema.shape, isRead: z.boolean() }).parse(await c.req.json()); return singularThread(await service.setReadState(await actor(c, body), { threadKey: threadKeySchema.parse(c.req.param('threadKey')), isRead: body.isRead }, false, requestKey(c))); }),
    readStateBulk: run(async (c) => { const body = strictObject({ ...contextSchema.shape, threadKeys: emailThreadReadStateInputSchema.options[1].shape.threadKeys, isRead: z.boolean() }).parse(await c.req.json()); return service.setReadState(await actor(c, body), { threadKeys: body.threadKeys, isRead: body.isRead }, false, requestKey(c)); }),
    trashThread: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return singularThread(await service.trashThread(await actor(c, body), emailThreadTrashInputSchema.parse({ threadKey: c.req.param('threadKey') }), false, requestKey(c))); }),
    trashThreads: run(async (c) => { const body = strictObject({ ...contextSchema.shape, threadKeys: emailThreadTrashInputSchema.options[1].shape.threadKeys }).parse(await c.req.json()); return service.trashThread(await actor(c, body), { threadKeys: body.threadKeys }, false, requestKey(c)); }),
    clearTrash: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: emailTrashClearInputSchema.shape.connectorKey }).parse(await c.req.json()); return service.clearTrash(await actor(c, body), { connectorKey: body.connectorKey }, false, undefined, requestKey(c)); }),
    findSimilar: run(async (c) => { const body = strictObject({ ...contextSchema.shape, limit: z.number().int().min(1).max(10).optional() }).parse(await c.req.json()); return service.findSimilar(await actor(c, body), emailSimilarFindInputSchema.parse({ messageKey: c.req.param('messageKey'), limit: body.limit })); }),
    listMessageTranslations: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return publicEmailTranslationListResultSchema.parse(await service.listMessageTranslations(await actor(c, body), emailMessageGeneratedListInputSchema.parse({ messageKey: c.req.param('messageKey') }))); }),
    deleteMessageTranslations: run(async (c) => { const body = strictObject({ ...contextSchema.shape, translationKeys: emailMessageTranslationDeleteInputSchema.shape.translationKeys }).parse(await c.req.json()); return publicEmailGeneratedDeleteResultSchema.parse(await service.deleteMessageTranslations(await actor(c, body), { messageKey: c.req.param('messageKey'), translationKeys: body.translationKeys }, requestKey(c))); }),
    summarizeMessage: run(async (c) => { const body = strictObject({ ...contextSchema.shape, topic: emailMessageSummarizeInputSchema.shape.topic, style: emailMessageSummarizeInputSchema.shape.style.optional(), language: emailMessageSummarizeInputSchema.shape.language }).parse(await c.req.json()); return publicEmailSummaryResultSchema.parse(await service.summarizeMessage(await actor(c, body), { messageKey: c.req.param('messageKey'), topic: body.topic, style: body.style, language: body.language }, requestKey(c))); }, 201),
    listMessageSummaries: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return publicEmailSummaryListResultSchema.parse(await service.listMessageSummaries(await actor(c, body), emailMessageGeneratedListInputSchema.parse({ messageKey: c.req.param('messageKey') }))); }),
    deleteMessageSummaries: run(async (c) => { const body = strictObject({ ...contextSchema.shape, summaryKeys: emailMessageSummaryDeleteInputSchema.shape.summaryKeys }).parse(await c.req.json()); return publicEmailGeneratedDeleteResultSchema.parse(await service.deleteMessageSummaries(await actor(c, body), { messageKey: c.req.param('messageKey'), summaryKeys: body.summaryKeys }, requestKey(c))); }),
    draft: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, ...emailDraftCreateInputSchema.shape }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return publicEmailDraftSchema.parse(await service.draft(await actor(c, body), input, requestKey(c)));
    }, 201),
    draftNew: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, ...emailDraftComposeInputShape }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...rawInput } = body;
      const input = emailDraftComposeInputSchema.parse(rawInput);
      return publicEmailDraftSchema.parse(await service.draftNew(await actor(c, body), input, requestKey(c)));
    }, 201),
    tones: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.tones(await actor(c, body)); }),
    listReplyContext: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.listReplyContext(await actor(c, body)); }),
    createReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, ...emailReplyContextCreateInputSchema.shape }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body; return service.createReplyContext(await actor(c, body), input, requestKey(c)); }, 201),
    updateReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, name: z.string().trim().min(1).max(255).optional(), text: z.string().trim().min(1).max(4_000).optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...patch } = body; return service.updateReplyContext(await actor(c, body), emailReplyContextUpdateInputSchema.parse({ noteKey: c.req.param('noteKey'), ...patch }), requestKey(c)); }),
    deleteReplyContext: run(async (c) => { const body = strictObject({ ...contextSchema.shape, noteKeys: z.array(threadKeySchema).min(1).max(20) }).parse(await c.req.json()); return service.deleteReplyContext(await actor(c, body), emailReplyContextDeleteInputSchema.parse({ noteKeys: body.noteKeys }), requestKey(c)); }),
    createTone: run(async (c) => { const body = strictObject({ ...contextSchema.shape, ...emailToneCreateInputSchema.shape }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body; return service.createTone(await actor(c, body), input, requestKey(c)); }, 201),
    updateTone: run(async (c) => { const transport = strictObject({ ...contextSchema.shape, name: z.string().trim().min(1).max(255).optional(), instruction: z.string().trim().min(1).max(20_000).optional(), isFavorite: z.boolean().optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...patch } = transport; const input = emailToneUpdateInputSchema.parse({ toneKey: c.req.param('toneKey'), ...patch }); return service.updateTone(await actor(c, transport), input, requestKey(c)); }),
    deleteTone: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.deleteTone(await actor(c, body), emailToneDeleteInputSchema.parse({ toneKey: c.req.param('toneKey') }), requestKey(c)); }),
    updateInbox: run(async (c) => { const transport = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema, name: z.string().trim().min(1).max(255).optional(), description: z.string().trim().min(1).max(10_000).nullable().optional(), coverImageKey: connectorKeySchema.nullable().optional(), isFavorite: z.boolean().optional() }).parse(await c.req.json()); const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...rawInput } = transport; const result = await service.updateInbox(await actor(c, transport), inboxUpdateInputSchema.parse(rawInput), requestKey(c)); return (usesCurrentConnectorTransport(c) ? publicEmailInboxSchema : legacyConnectorSchema).parse(result); }),
    updateDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, finalContent: z.string().max(50_000).optional(), attachments: z.array(z.object({ type: z.enum(['document', 'image']), key: z.string().cuid() }).strict()).max(20).optional() }).parse(await c.req.json()); return publicEmailDraftSchema.parse(await service.updateDraft(await actor(c, body), emailDraftUpdateInputSchema.parse({ draftKey: c.req.param('draftKey'), finalContent: body.finalContent, attachments: body.attachments }), requestKey(c))); }),
    deleteDraft: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.deleteDraft(await actor(c, body), emailDraftDeleteInputSchema.parse({ draftKey: c.req.param('draftKey') }), requestKey(c)); }),
    assignDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return publicEmailDraftSchema.parse(await service.assignDraft(await actor(c, body), { draftKey: z.string().cuid().parse(c.req.param('draftKey')), connectorKey: body.connectorKey }, requestKey(c))); }),
    sendDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema.optional(), replyMode: z.enum(['reply', 'reply_all']).optional() }).parse(await c.req.json()); return service.sendDraft(await actor(c, body), z.string().cuid().parse(c.req.param('draftKey')), body.connectorKey, requestKey(c), body.replyMode); }),
    disconnect: run(async (c) => { const body = strictObject({ ...contextSchema.shape, connectorKey: connectorKeySchema }).parse(await c.req.json()); return service.disconnect(await actor(c, body), body.connectorKey); }),
  };
}

export const emailHandlers = createEmailHandlers();
