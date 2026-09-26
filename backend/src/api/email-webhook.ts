import type { Context } from 'hono';
import { z } from 'zod';
import { verifyGoogleOidcToken } from '@/lib/google-oidc';
import { logEmailFlow } from '@/lib/email-inbox/flow-log';
import { enqueueEmailSyncNotification } from '@/lib/email-inbox/sync-queue';

export const GMAIL_WEBHOOK_V1_PATH = '/api/v1/webhooks/gmail/pubsub';
const pubsubMessageSchema = z.object({
  data: z.string().min(1).max(8192),
  messageId: z.coerce.string().min(1).max(500).optional(),
  message_id: z.coerce.string().min(1).max(500).optional(),
  publishTime: z.string().min(1).max(100).optional(),
  publish_time: z.string().min(1).max(100).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
  orderingKey: z.string().max(1000).optional(),
  ordering_key: z.string().max(1000).optional(),
}).passthrough().superRefine((message, context) => {
  if (!message.messageId && !message.message_id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'message ID is required' });
  if (message.messageId && message.message_id && String(message.messageId) !== String(message.message_id)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'message ID aliases disagree' });
}).transform((message) => ({
  data: message.data,
  messageId: String(message.messageId ?? message.message_id),
  publishTime: message.publishTime ?? message.publish_time,
}));
const envelopeSchema = z.object({
  message: pubsubMessageSchema,
  subscription: z.string().min(1).max(1000),
  deliveryAttempt: z.coerce.number().int().positive().optional(),
}).passthrough();
const notificationSchema = z.object({
  emailAddress: z.string().email(),
  historyId: z.union([z.string(), z.number()]).transform((value) => String(value)).pipe(z.string().regex(/^\d+$/)),
}).passthrough();

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
    if (!token) {
      logEmailFlow('ingest.webhook.unauthenticated', { path: c.req.path });
      return c.json({ error: 'webhook authentication required' }, 401);
    }
    const identity = await (options.verify ?? verifyGoogleOidcToken)(token, { audience: required('GMAIL_PUBSUB_PUSH_AUDIENCE'), email: required('GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT_EMAIL') }).catch(() => null);
    if (!identity) {
      logEmailFlow('ingest.webhook.invalid-identity', { path: c.req.path });
      return c.json({ error: 'invalid webhook identity' }, 401);
    }
    let envelope: z.infer<typeof envelopeSchema>;
    let notification: z.infer<typeof notificationSchema>;
    try {
      envelope = envelopeSchema.parse(await c.req.json());
      if (envelope.subscription !== required('GMAIL_PUBSUB_SUBSCRIPTION')) return c.json({ error: 'invalid webhook subscription' }, 403);
      const bytes = Buffer.from(envelope.message.data, 'base64');
      if (bytes.byteLength > 2048) throw new Error('Webhook notification is too large');
      const decoded = bytes.toString('utf8');
      notification = notificationSchema.parse(JSON.parse(decoded));
    } catch (error) {
      logEmailFlow('ingest.webhook.invalid-payload', { error: error instanceof Error ? error.message.slice(0, 400) : 'invalid webhook payload' });
      return c.json({ error: 'invalid webhook payload' }, 400);
    }
      logEmailFlow('ingest.webhook.received', { historyId: notification.historyId, messageId: envelope.message.messageId, emailAddress: notification.emailAddress, subscription: envelope.subscription, publishTime: envelope.message.publishTime ?? null, deliveryAttempt: envelope.deliveryAttempt ?? null });
      const queued = await (options.enqueue ?? enqueueEmailSyncNotification)({
        emailAddress: notification.emailAddress, historyId: notification.historyId, messageId: envelope.message.messageId,
        subscription: envelope.subscription, publishTime: envelope.message.publishTime,
      });
      logEmailFlow('ingest.webhook.enqueued', { historyId: notification.historyId, messageId: envelope.message.messageId, emailAddress: notification.emailAddress, jobId: queued && typeof queued === 'object' && 'jobId' in queued ? queued.jobId : null });
    return c.body(null, 204);
  };
}

export const handleGmailWebhook = createGmailWebhookHandler();
