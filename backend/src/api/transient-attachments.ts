import type { Context } from 'hono';
import { z } from 'zod';
import { authorizeContentExecution, ContentError, type ToolContext } from '@/lib/ai/tools';
import { completeTransientAttachments, normalizeTransientAttachmentError, reserveTransientAttachments, type TransientAttachmentOwner } from '@/lib/conversations/transient-attachments';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';

const selectedSchema = z.object({ organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200) }).strict();
const reserveSchema = selectedSchema.extend({ files: z.array(z.object({ clientKey: z.string().trim().min(1).max(120), filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(160), sizeBytes: z.number().int().positive() }).strict()).min(1).max(10) }).strict();
const completeSchema = selectedSchema.extend({ attachmentKeys: z.array(z.string().cuid()).min(1).max(10) }).strict();

export interface TransientAttachmentHandlerDependencies {
  getIdentity?: typeof getAuthIdentity;
  authorize?: (input: { organizationKey: string; scopeKey: string }, options: { authenticatedUserKey: string }) => Promise<{ context: ToolContext }>;
  reserve?: typeof reserveTransientAttachments;
  complete?: typeof completeTransientAttachments;
}

function owner(context: ToolContext): TransientAttachmentOwner {
  if (context.principal.kind !== 'member' || context.principal.userOrganization.status !== 'active' || context.principal.userOrganization.organizationId !== context.organizationKey || context.principal.userOrganization.userId !== context.principal.user.key) throw new ContentError('CONTENT_FORBIDDEN', 'An active matching user membership is required.', 'attachment.upload', { action: 'authorization' });
  return { organizationKey: context.organizationKey, scopeKey: context.runtimeScopeKey, userKey: context.principal.user.key };
}

function failure(c: Context, error: unknown) {
  if (error instanceof ContentError) return c.json({ success: false, error: error.toJSON() }, error.code === 'CONTENT_FORBIDDEN' ? 403 : 400);
  const normalized = normalizeTransientAttachmentError(error);
  return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status);
}

export function createTransientAttachmentHandlers(dependencies: TransientAttachmentHandlerDependencies = {}) {
  const invoke = async (c: Context, schema: typeof reserveSchema | typeof completeSchema, operation: 'reserve' | 'complete') => {
    try {
      const body = await parseJson(c, schema);
      const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
      if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
      if (identity.identityType !== 'user') return c.json({ success: false, error: 'user session required' }, 403);
      const context = (await (dependencies.authorize ?? authorizeContentExecution)({ organizationKey: body.organizationKey, scopeKey: body.scopeKey }, { authenticatedUserKey: identity.key })).context;
      const conversationKey = z.string().cuid().parse(c.req.param('conversationKey'));
      if (operation === 'reserve') {
        const input = reserveSchema.parse(body);
        const data = await (dependencies.reserve ?? reserveTransientAttachments)({ conversationKey, requestKey: input.requestKey, files: input.files }, owner(context));
        return c.json({ success: true, data }, 201);
      }
      const input = completeSchema.parse(body);
      const data = await (dependencies.complete ?? completeTransientAttachments)({ conversationKey, requestKey: input.requestKey, attachmentKeys: input.attachmentKeys }, owner(context));
      return c.json({ success: true, data }, 200);
    } catch (error) { return failure(c, error); }
  };
  return {
    reserve: (c: Context) => invoke(c, reserveSchema, 'reserve'),
    complete: (c: Context) => invoke(c, completeSchema, 'complete'),
  };
}

export const transientAttachmentHandlers = createTransientAttachmentHandlers();
