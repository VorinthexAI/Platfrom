import type { Context } from 'hono';
import { z } from 'zod';
import { verifyGoogleOidcToken } from '@/lib/google-oidc';
import { enqueueEmailSyncNotification } from '@/lib/email-inbox/sync-queue';

export const GMAIL_WEBHOOK_V1_PATH = '/api/v1/webhooks/gmail/pubsub';
const envelopeSchema = z.object({
  message: z.object({ data: z.string().min(1), messageId: z.string().min(1).max(500), publishTime: z.string().datetime().optional(), attributes: z.record(z.string()).optional() }).strict(),
  subscription: z.string().min(1).max(1000),
  deliveryAttempt: z.number().int().positive().optional(),
}).strict();
const notificationSchema = z.object({ emailAddress: z.string().email(), historyId: z.string().regex(/^\d+$/) }).strict();

export function isGmailWebhookPath(path: string) {
  return path.replace(/\/+$/, '') === GMAIL_WEBHOOK_V1_PATH;
}

function required(name: 'GMAIL_PUBSUB_PUSH_AUDIENCE' | 'GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL' | 'GMAIL_PUBSUB_SUBSCRIPTION') {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function createGmailWebhookHandler(options: {
  verify?: typeof verifyGoogleOidcToken;
  enqueue?: typeof enqueueEmailSyncNotification;
} = {}) {
  return async (c: Context) => {
    const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return c.json({ error: 'webhook authentication required' }, 401);
    const identity = await (options.verify ?? verifyGoogleOidcToken)(token, { audience: required('GMAIL_PUBSUB_PUSH_AUDIENCE'), email: required('GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL') }).catch(() => null);
    if (!identity) return c.json({ error: 'invalid webhook identity' }, 401);
    let envelope: z.infer<typeof envelopeSchema>;
    let notification: z.infer<typeof notificationSchema>;
    try {
      envelope = envelopeSchema.parse(await c.req.json());
      if (envelope.subscription !== required('GMAIL_PUBSUB_SUBSCRIPTION')) return c.json({ error: 'invalid webhook subscription' }, 403);
      const decoded = Buffer.from(envelope.message.data, 'base64').toString('utf8');
      notification = notificationSchema.parse(JSON.parse(decoded));
    } catch {
      return c.json({ error: 'invalid webhook payload' }, 400);
    }
    await (options.enqueue ?? enqueueEmailSyncNotification)({
      emailAddress: notification.emailAddress, historyId: notification.historyId, messageId: envelope.message.messageId,
      subscription: envelope.subscription, publishTime: envelope.message.publishTime,
    });
    return c.body(null, 204);
  };
}

export const handleGmailWebhook = createGmailWebhookHandler();
