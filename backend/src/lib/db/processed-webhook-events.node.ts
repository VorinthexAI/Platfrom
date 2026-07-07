import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, isArangoUniqueConstraintError, withArangoKey } from './base';
import { newId } from '@/lib/ids';

export const PROCESSED_WEBHOOK_EVENTS_COLLECTION = 'processedWebhookEvents';

export const processedWebhookEventSchema = z.object({
  key: z.string(),
  provider: z.enum(['polar', 'resend']),
  eventId: z.string(),
  eventType: z.string(),
  status: z.enum(['processing', 'processed']).default('processed'),
  processedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type ProcessedWebhookEvent = z.infer<typeof processedWebhookEventSchema>;

// A short-lived idempotency ledger, not something anyone searches — never embedded.
const helpers = createNodeHelpers(PROCESSED_WEBHOOK_EVENTS_COLLECTION, processedWebhookEventSchema);

export async function insertProcessedWebhookEvent(
  input: Omit<z.input<typeof processedWebhookEventSchema>, 'key'>,
): Promise<ProcessedWebhookEvent> {
  return helpers.insert({ ...input, key: newId() });
}

export async function getProcessedWebhookEvent(
  provider: string,
  eventId: string,
): Promise<ProcessedWebhookEvent | null> {
  const cursor = await db.query(aql`
    FOR e IN ${db.collection(PROCESSED_WEBHOOK_EVENTS_COLLECTION)}
      FILTER e.provider == ${provider} && e.eventId == ${eventId}
      LIMIT 1
      RETURN e
  `);
  const doc = await cursor.next();
  return doc ? processedWebhookEventSchema.parse(withArangoKey(doc)) : null;
}

export const updateProcessedWebhookEvent = helpers.updateById;
export const deleteProcessedWebhookEvent = helpers.deleteById;
export const upsertProcessedWebhookEventByKey = helpers.upsertByKey;
export const getAllProcessedWebhookEventsChunked = helpers.getAllChunked;
export const listProcessedWebhookEventsPage = helpers.listPage;

export async function updateProcessedWebhookEventByProviderAndEventId(
  provider: string,
  eventId: string,
  patch: Partial<Omit<z.input<typeof processedWebhookEventSchema>, 'embedding' | 'key'>>,
): Promise<ProcessedWebhookEvent | null> {
  const existing = await getProcessedWebhookEvent(provider, eventId);
  return existing ? updateProcessedWebhookEvent(existing.key, patch) : null;
}

export async function deleteProcessedWebhookEventByProviderAndEventId(provider: string, eventId: string): Promise<void> {
  const existing = await getProcessedWebhookEvent(provider, eventId);
  if (existing) await deleteProcessedWebhookEvent(existing.key);
}

export type WebhookClaim = 'claimed' | 'duplicate' | 'in_progress';

/**
 * Claims a webhook event for processing, or reports duplicate/in_progress.
 * A 'processing' claim whose owner crashed goes stale after staleMs and can
 * be taken over, so the event is retried instead of being lost forever.
 */
export async function claimWebhookEvent(
  provider: 'polar' | 'resend',
  eventId: string,
  eventType: string,
  staleMs: number,
): Promise<WebhookClaim> {
  try {
    await insertProcessedWebhookEvent({ provider, eventId, eventType, status: 'processing', processedAt: new Date().toISOString() });
    return 'claimed';
  } catch (err) {
    if (!isArangoUniqueConstraintError(err)) throw err;
  }

  const existing = await getProcessedWebhookEvent(provider, eventId);
  if (!existing) return 'in_progress';
  if (existing.status === 'processed') return 'duplicate';

  const staleThreshold = new Date(Date.now() - staleMs).toISOString();
  const cursor = await db.query(aql`
    FOR e IN ${db.collection(PROCESSED_WEBHOOK_EVENTS_COLLECTION)}
      FILTER e.provider == ${provider} && e.eventId == ${eventId} && e.status == 'processing' && e.processedAt < ${staleThreshold}
      UPDATE e WITH { processedAt: ${new Date().toISOString()} } IN ${db.collection(PROCESSED_WEBHOOK_EVENTS_COLLECTION)}
      RETURN NEW
  `);
  const reclaimed = await cursor.all();
  return reclaimed.length > 0 ? 'claimed' : 'in_progress';
}
