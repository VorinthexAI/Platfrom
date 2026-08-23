import type { Context } from 'hono';
import { z, ZodError } from 'zod';
import { FoundersAccessError } from '@/lib/founders/access';
import { createEmailOAuthService, type EmailOAuthService } from '@/lib/email-inbox/oauth';
import { createEmailService, EmailRepositoryError, type EmailService } from '@/lib/email-inbox/service';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';
import { emailAttachmentRefsSchema } from '@/lib/email-inbox/archive-payloads';

const contextSchema = strictObject({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() });
const threadKeySchema = z.string().cuid();
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
      const body = strictObject({ ...contextSchema.shape, filter: z.enum(['all', 'important', 'urgent', 'needs_action', 'filtered', 'unread', 'favorite']).optional(), search: z.string().trim().max(200).optional() }).parse(await c.req.json());
      return service.overview(await actor(c, body), { filter: body.filter, search: body.search });
    }),
    startConnect: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, returnUri: z.string().url() }).parse(await c.req.json());
      const current = await identity(c);
      return oauth.start({ userKey: current.key, organizationKey: body.organizationKey, scopeKey: body.scopeKey, returnUri: body.returnUri });
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
    sync: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.sync(await actor(c, body)); }),
    thread: run(async (c) => { const body = strictObject({ ...contextSchema.shape, markRead: z.boolean().optional() }).parse(await c.req.json()); const current = await actor(c, body); const threadKey = threadKeySchema.parse(c.req.param('threadKey')); return service.threadForHttp(current, threadKey, body.markRead !== false); }),
    favorite: run(async (c) => { const body = strictObject({ ...contextSchema.shape, isFavorite: z.boolean() }).parse(await c.req.json()); return service.setFavorite(await actor(c, body), threadKeySchema.parse(c.req.param('threadKey')), body.isFavorite); }),
    draft: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, threadKey: threadKeySchema, tone: z.enum(['concise', 'warm', 'formal', 'direct']), instruction: z.string().trim().max(1000).optional(), profileKey: z.string().cuid().optional(), attachments: emailAttachmentRefsSchema.optional() }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return service.draft(await actor(c, body), input);
    }, 201),
    draftNew: run(async (c) => {
      const body = strictObject({ ...contextSchema.shape, to: z.array(z.string().email()).min(1).max(50), cc: z.array(z.string().email()).max(50).optional(), bcc: z.array(z.string().email()).max(50).optional(), subject: z.string().trim().min(1).max(998), tone: z.enum(['concise', 'warm', 'formal', 'direct']), instruction: z.string().trim().max(1000).optional(), attachments: emailAttachmentRefsSchema.optional() }).parse(await c.req.json());
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...input } = body;
      return service.draftNew(await actor(c, body), input);
    }, 201),
    tones: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.tones(await actor(c, body)); }),
    updateDraft: run(async (c) => { const body = strictObject({ ...contextSchema.shape, finalContent: z.string().trim().min(1).max(50_000) }).parse(await c.req.json()); return service.updateDraft(await actor(c, body), z.string().cuid().parse(c.req.param('draftKey')), body.finalContent); }),
    sendDraft: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.sendDraft(await actor(c, body), z.string().cuid().parse(c.req.param('draftKey'))); }),
    disconnect: run(async (c) => { const body = contextSchema.parse(await c.req.json()); return service.disconnect(await actor(c, body)); }),
  };
}

export const emailHandlers = createEmailHandlers();
