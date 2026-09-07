import type { Context } from 'hono';
import { polarWebhookEventSchema } from '@/lib/commerce/service';
import { enqueuePolarWebhook, type PolarWebhookEnqueuer } from '@/lib/automations/polar-webhook-queue';
import { PolarProviderError, verifyPolarWebhookSignature } from '@/lib/commerce/polar';
import { claimWebhookEvent, deleteProcessedWebhookEventByProviderAndEventId } from '@/lib/db/processed-webhook-events.node';

export const POLAR_WEBHOOK_V1_PATH = '/api/v1/webhooks/polar';
const CLAIM_STALE_MS = 5 * 60_000;
export const POLAR_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

export function isPolarWebhookPath(path: string) { return path.replace(/\/+$/, '') === POLAR_WEBHOOK_V1_PATH; }

export interface PolarWebhookDependencies {
  verify?: typeof verifyPolarWebhookSignature;
  claim?: typeof claimWebhookEvent;
  enqueue?: PolarWebhookEnqueuer;
  release?: typeof deleteProcessedWebhookEventByProviderAndEventId;
}

async function readBoundedRawBody(c: Context): Promise<string | null> {
  const declared = c.req.header('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > POLAR_WEBHOOK_MAX_BODY_BYTES)) return null;
  const reader = c.req.raw.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > POLAR_WEBHOOK_MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(body); } catch { return null; }
}

export function createPolarWebhookHandler(dependencies: PolarWebhookDependencies = {}) {
  return async (c: Context) => {
    const rawBody = await readBoundedRawBody(c);
    if (rawBody === null) return c.json({ error: 'webhook body too large or invalid' }, 413);
    const webhookId = c.req.header('webhook-id');
    let payload: unknown;
    try {
      payload = (dependencies.verify ?? verifyPolarWebhookSignature)({ rawBody, webhookId, webhookTimestamp: c.req.header('webhook-timestamp'), webhookSignature: c.req.header('webhook-signature') });
    } catch (error) {
      if (error instanceof PolarProviderError && error.code === 'NOT_CONFIGURED') throw error;
      return c.json({ error: 'invalid webhook signature' }, 400);
    }
    if (!payload || !webhookId) return c.json({ error: 'invalid webhook signature' }, 400);
    const event = polarWebhookEventSchema.parse(payload);
    const claim = await (dependencies.claim ?? claimWebhookEvent)('polar', webhookId, event.type, CLAIM_STALE_MS);
    if (claim === 'duplicate') return c.json({ ok: true, duplicate: true }, 202);
    try {
      await (dependencies.enqueue ?? enqueuePolarWebhook)(webhookId, event);
      return c.json(claim === 'in_progress' ? { ok: true, pending: true } : { ok: true }, 202);
    } catch (error) {
      if (claim === 'claimed') await (dependencies.release ?? deleteProcessedWebhookEventByProviderAndEventId)('polar', webhookId);
      throw error;
    }
  };
}

export const handlePolarWebhook = createPolarWebhookHandler();
