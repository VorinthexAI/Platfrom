import type { Context } from 'hono';
import { Webhook } from 'svix';
import { z } from 'zod';
import { insertEvent } from '@/lib/db/events.node';
import { claimWebhookEvent, deleteProcessedWebhookEventByProviderAndEventId, updateProcessedWebhookEventByProviderAndEventId } from '@/lib/db/processed-webhook-events.node';
import { deleteUser, getUserByEmailHash } from '@/lib/db/users.node';
import { newId } from '@/lib/ids';
import { getDefaultPlatformId } from '@/platform/events';
import { hashUserEmail } from './users';

export const RESEND_WEBHOOK_V1_PATH = '/api/v1/webhooks/resend';
export const RESEND_WEBHOOK_PUBLIC_PATHS = [RESEND_WEBHOOK_V1_PATH] as const;

const WEBHOOK_CLAIM_STALE_MS = 5 * 60 * 1000;

const resendEventSchema = z.object({
  id: z.string().min(1).optional(),
  type: z.string().min(1),
  created_at: z.string().optional(),
  data: z.object({
    to: z.array(z.string().email()).min(1),
    created_at: z.string().optional(),
  }).passthrough(),
}).passthrough();

type ResendEvent = z.infer<typeof resendEventSchema>;
type ResendEmailEventType = 'email.opened' | 'email.delivered' | 'email.bounced' | 'email.complained';

export function isResendWebhookPath(path: string) {
  const normalized = path.length > 1 ? path.replace(/\/+$/, '') : path;
  return RESEND_WEBHOOK_PUBLIC_PATHS.some((candidate) => normalized === candidate);
}

function eventTimestamp(event: ResendEvent) {
  const value = event.data.created_at ?? event.created_at;
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

export function recipientEmailFromResendEvent(payload: unknown) {
  const event = resendEventSchema.parse(payload);
  return event.data.to[0];
}

export interface ResendWebhookDeps {
  getUserByEmailHash: typeof getUserByEmailHash;
  insertEvent: typeof insertEvent;
  deleteUser: typeof deleteUser;
  getDefaultPlatformId: typeof getDefaultPlatformId;
  hashUserEmail: typeof hashUserEmail;
  newId: typeof newId;
}

const defaultDeps: ResendWebhookDeps = {
  getUserByEmailHash,
  insertEvent,
  deleteUser,
  getDefaultPlatformId,
  hashUserEmail,
  newId,
};

function isTrackedResendEmailEvent(type: string): type is ResendEmailEventType {
  return type === 'email.opened'
    || type === 'email.delivered'
    || type === 'email.bounced'
    || type === 'email.complained';
}

export async function recordResendEmailEvent(
  event: ResendEvent,
  eventId: string,
  deps: ResendWebhookDeps = defaultDeps,
) {
  if (!isTrackedResendEmailEvent(event.type)) return { ignored: true };

  const recipientEmail = event.data.to[0];
  const emailHash = await deps.hashUserEmail(recipientEmail);
  const user = await deps.getUserByEmailHash(emailHash);
  if (!user) {
    console.warn('resend webhook recipient hash not found', { emailHash });
    return { processed: true, matched: false, inserted: false, deleted: false };
  }

  await deps.insertEvent({
    key: deps.newId(),
    sourceId: await deps.getDefaultPlatformId(),
    belongsTo: 'platform',
    userId: user.key,
    slug: event.type,
    data: {
      provider: 'resend',
      user_id: user.key,
      email_hash: emailHash,
      resend_event_id: eventId,
      message_id: typeof event.data.email_id === 'string' ? event.data.email_id : null,
      occurred_at: eventTimestamp(event),
    },
    createdAt: new Date().toISOString(),
  });

  if (event.type === 'email.bounced') {
    await deps.deleteUser(user.key);
    return { processed: true, matched: true, inserted: true, deleted: true };
  }

  return { processed: true, matched: true, inserted: true, deleted: false };
}

export async function processResendWebhookPayload(payload: unknown, eventId: string, deps: ResendWebhookDeps = defaultDeps) {
  const event = resendEventSchema.parse(payload);
  return recordResendEmailEvent(event, eventId, deps);
}

export function verifyResendWebhookSignature(input: {
  rawBody: string;
  svixId?: string;
  svixTimestamp?: string;
  svixSignature?: string;
  secret?: string;
}) {
  const secret = input.secret ?? process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) throw new Error('RESEND_WEBHOOK_SECRET is required');
  if (!input.svixId || !input.svixTimestamp || !input.svixSignature) return null;

  return new Webhook(secret).verify(input.rawBody, {
    'svix-id': input.svixId,
    'svix-timestamp': input.svixTimestamp,
    'svix-signature': input.svixSignature,
  });
}

async function completeWebhookEvent(eventId: string) {
  await updateProcessedWebhookEventByProviderAndEventId('resend', eventId, { status: 'processed', processedAt: new Date().toISOString() });
}

async function releaseWebhookEvent(eventId: string) {
  await deleteProcessedWebhookEventByProviderAndEventId('resend', eventId);
}

export async function handleResendWebhook(c: Context) {
  const rawBody = await c.req.text();
  const svixId = c.req.header('svix-id');

  let verifiedPayload: unknown;
  try {
    verifiedPayload = verifyResendWebhookSignature({
      rawBody,
      svixId,
      svixTimestamp: c.req.header('svix-timestamp'),
      svixSignature: c.req.header('svix-signature'),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'RESEND_WEBHOOK_SECRET is required') {
      throw error;
    }
    return c.json({ error: 'invalid webhook signature' }, 400);
  }

  if (!verifiedPayload) return c.json({ error: 'invalid webhook signature' }, 400);
  if (!svixId) return c.json({ error: 'svix-id header is required' }, 400);

  const event = resendEventSchema.parse(verifiedPayload);
  const eventId = event.id ?? svixId;
  const claim = await claimWebhookEvent('resend', eventId, event.type, WEBHOOK_CLAIM_STALE_MS);
  if (claim === 'duplicate') return c.json({ ok: true, duplicate: true });
  if (claim === 'in_progress') {
    return c.json({ error: 'event is already being processed' }, 409);
  }

  try {
    await processResendWebhookPayload(event, eventId);
    await completeWebhookEvent(eventId);
    return c.json({ ok: true });
  } catch (error) {
    await releaseWebhookEvent(eventId);
    throw error;
  }
}
