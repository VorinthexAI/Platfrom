import type { Context } from 'hono';
import { z } from 'zod';
import { verifyGoogleOidcToken } from '@/lib/google-oidc';
import { enqueueEmailSyncNotification } from '@/lib/email-inbox/sync-queue';

export const GMAIL_WEBHOOK_V1_PATH = '/api/v1/webhooks/gmail/pubsub';
const pubsubMessageSchema = z.object({
  data: z.string().min(1).max(4096).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  messageId: z.string().min(1).max(500).optional(),
  message_id: z.string().min(1).max(500).optional(),
  publishTime: z.string().datetime().optional(),
  publish_time: z.string().datetime().optional(),
  attributes: z.record(z.string().max(1000)).optional(),
  orderingKey: z.string().max(1000).optional(),
  ordering_key: z.string().max(1000).optional(),
}).strict().superRefine((message, context) => {
  if (!message.messageId && !message.message_id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'message ID is required' });
  if (message.messageId && message.message_id && message.messageId !== message.message_id) context.addIssue({ code: z.ZodIssueCode.custom, message: 'message ID aliases disagree' });
  if (message.publishTime && message.publish_time && message.publishTime !== message.publish_time) context.addIssue({ code: z.ZodIssueCode.custom, message: 'publish time aliases disagree' });
  if (message.orderingKey && message.ordering_key && message.orderingKey !== message.ordering_key) context.addIssue({ code: z.ZodIssueCode.custom, message: 'ordering key aliases disagree' });
  if (message.attributes && Object.keys(message.attributes).length > 20) context.addIssue({ code: z.ZodIssueCode.custom, message: 'too many message attributes' });
}).transform((message) => ({
  data: message.data,
  messageId: message.messageId ?? message.message_id!,
  publishTime: message.publishTime ?? message.publish_time,
  attributes: message.attributes,
  orderingKey: message.orderingKey ?? message.ordering_key,
}));
const envelopeSchema = z.object({
  message: pubsubMessageSchema,
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
      const bytes = Buffer.from(envelope.message.data, 'base64');
      if (bytes.byteLength > 2048) throw new Error('Webhook notification is too large');
      const decoded = bytes.toString('utf8');
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
