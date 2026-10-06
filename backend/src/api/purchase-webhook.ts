import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context } from 'hono';
import { commerceService, purchaseEventSchema } from '@/lib/commerce/service';

export const PURCHASE_WEBHOOK_PATH = '/api/v1/webhooks/revenuecat';
export const isPurchaseWebhookPath = (path: string) => path.replace(/\/+$/, '') === PURCHASE_WEBHOOK_PATH;

export async function handlePurchaseWebhook(c: Context) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim();
  const bearer = process.env.REVENUECAT_WEBHOOK_AUTH?.trim();
  if (!secret || !bearer || secret.includes('REPLACE_WITH') || bearer.includes('REPLACE_WITH')) return c.json({ error: 'webhook unavailable' }, 503);
  const size = c.req.header('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > 256 * 1024)) return c.json({ error: 'invalid webhook body' }, 413);
  const raw = await c.req.text();
  if (Buffer.byteLength(raw) > 256 * 1024) return c.json({ error: 'invalid webhook body' }, 413);
  const authorization = c.req.header('authorization') ?? '';
  const expectedAuth = Buffer.from(bearer);
  const actualAuth = Buffer.from(authorization);
  if (actualAuth.length !== expectedAuth.length || !timingSafeEqual(actualAuth, expectedAuth)) return c.json({ error: 'unauthorized' }, 401);
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/i.exec(c.req.header('x-revenuecat-webhook-signature') ?? '');
  if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) return c.json({ error: 'invalid signature' }, 401);
  const expected = createHmac('sha256', secret).update(`${match[1]}.${raw}`).digest();
  const signature = Buffer.from(match[2]!, 'hex');
  if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return c.json({ error: 'invalid signature' }, 401);
  let event: unknown;
  try { event = purchaseEventSchema.parse(JSON.parse(raw)); }
  catch { return c.json({ error: 'invalid event' }, 400); }
  await commerceService.processPurchaseEvent(event);
  return c.json({ ok: true });
}
