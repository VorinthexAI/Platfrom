import { createHash } from 'node:crypto';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { bookRefundIntentSchema, type BookRefundIntent } from '@/lib/db/book-refund-intents.node';
import { sparkService } from '@/lib/sparks/service';
import { newId } from '@/lib/ids';

const LEASE_MS = 5 * 60_000;
const RECOVERY_MS = 60_000;

export interface BookRefundRepository {
  claim(limit: number, leaseToken: string, now: string, leaseExpiresAt: string): Promise<BookRefundIntent[]>;
  acknowledge(key: string, leaseToken: string): Promise<boolean>;
  release(key: string, leaseToken: string, now: string): Promise<boolean>;
}

export function createBookRefundRepository(): BookRefundRepository {
  return {
    async claim(limit, leaseToken, now, leaseExpiresAt) {
      const cursor = await db.query('FOR intent IN bookRefundIntents FILTER intent.status == "pending" || (intent.status == "processing" && intent.leaseExpiresAt <= @now) SORT intent.createdAt ASC, intent._key ASC LIMIT @limit UPDATE intent WITH { status: "processing", leaseToken: @leaseToken, leaseExpiresAt: @leaseExpiresAt, updatedAt: @now } IN bookRefundIntents RETURN NEW', { limit, leaseToken, now, leaseExpiresAt });
      return (await cursor.all()).map((value) => bookRefundIntentSchema.parse(withArangoKey(value)));
    },
    async acknowledge(key, leaseToken) { const cursor = await db.query('FOR intent IN bookRefundIntents FILTER intent._key == @key && intent.status == "processing" && intent.leaseToken == @leaseToken REMOVE intent IN bookRefundIntents RETURN true', { key, leaseToken }); return await cursor.next() === true; },
    async release(key, leaseToken, now) { const cursor = await db.query('FOR intent IN bookRefundIntents FILTER intent._key == @key && intent.status == "processing" && intent.leaseToken == @leaseToken UPDATE intent WITH { status: "pending", leaseToken: null, leaseExpiresAt: null, updatedAt: @now } IN bookRefundIntents OPTIONS { keepNull: false } RETURN true', { key, leaseToken, now }); return await cursor.next() === true; },
  };
}

export function createBookRefundProcessor(options: { repository?: BookRefundRepository; refund?: typeof sparkService.refund; id?: () => string; now?: () => Date } = {}) {
  const repository = options.repository ?? createBookRefundRepository(); const refund = options.refund ?? sparkService.refund; const id = options.id ?? newId; const now = options.now ?? (() => new Date());
  return async (limit = 25) => {
    const leaseToken = id(); const claimedAt = now(); const intents = await repository.claim(limit, leaseToken, claimedAt.toISOString(), new Date(claimedAt.getTime() + LEASE_MS).toISOString());
    let completed = 0;
    for (const intent of intents) {
      try {
        const requestHash = createHash('sha256').update(JSON.stringify({ refundOfTransactionKey: intent.chargeTransactionKey, microSparks: intent.microSparks })).digest('hex');
        const result = await refund(intent.userKey, { microSparks: intent.microSparks, idempotencyKey: `refund:${intent.chargeTransactionKey}`, requestHash, chargeTransactionKey: intent.chargeTransactionKey, executionIdentity: intent.executionIdentity });
        if (result.status === 'conflict') throw new Error('Spark terminal refund conflicted.');
        if (!await repository.acknowledge(intent.key, leaseToken)) throw new Error('Book refund intent lease was lost after refund.');
        completed += 1;
      } catch (error) {
        await repository.release(intent.key, leaseToken, now().toISOString()).catch(() => false);
        console.error('book terminal refund failed', { intentKey: intent.key, error });
      }
    }
    return { claimed: intents.length, completed };
  };
}

let active: { timer: ReturnType<typeof setInterval>; close(): Promise<void> } | null = null;
export function startBookRefundWorker(options: { process?: ReturnType<typeof createBookRefundProcessor>; intervalMs?: number } = {}) {
  if (active) return active;
  const process = options.process ?? createBookRefundProcessor(); let running = Promise.resolve();
  const recover = () => { running = running.then(() => process()).then(() => undefined).catch((error) => console.error('book refund recovery failed', { error })); };
  recover();
  const timer = setInterval(recover, options.intervalMs ?? RECOVERY_MS); timer.unref();
  active = { timer, async close() { clearInterval(timer); await running; active = null; } };
  return active;
}

export async function closeBookRefundWorker() { await active?.close(); }
