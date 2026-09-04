import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { bookRefundIntentSchema } from '@/lib/db/book-refund-intents.node';
import { createBookRefundProcessor, startBookRefundWorker } from './refund-worker';

const at = '2026-09-05T12:00:00.000Z';
const intent = () => bookRefundIntentSchema.parse({ key: newId(), bookKey: newId(), userKey: newId(), chargeTransactionKey: newId(), executionIdentity: 'a'.repeat(64), microSparks: 100_000_000, status: 'pending', createdAt: at, updatedAt: at });

describe('book terminal refund worker', () => {
  test('replays the exact refund identity and acknowledges only after ledger success', async () => {
    const item = intent(); const calls: unknown[][] = []; let pass = 0;
    const repository: any = { claim: async () => pass++ < 2 ? [item] : [], acknowledge: async (...args: unknown[]) => { calls.push(['ack', ...args]); return true; }, release: async (...args: unknown[]) => { calls.push(['release', ...args]); return true; } };
    const refund = async (...args: unknown[]) => { calls.push(['refund', ...args]); return { status: pass === 1 ? 'applied' : 'replayed', transaction: {} } as never; };
    const process = createBookRefundProcessor({ repository, refund: refund as never, id: () => 'lease', now: () => new Date(at) });
    await process(); await process();
    const refunds = calls.filter(([kind]) => kind === 'refund'); expect(refunds).toHaveLength(2);
    expect(refunds[0]?.[2]).toMatchObject({ idempotencyKey: `refund:${item.chargeTransactionKey}`, chargeTransactionKey: item.chargeTransactionKey, executionIdentity: item.executionIdentity, microSparks: item.microSparks });
    expect(calls.filter(([kind]) => kind === 'ack')).toHaveLength(2); expect(calls.filter(([kind]) => kind === 'release')).toHaveLength(0);
  });

  test('startup recovery processes persisted intents and waits during shutdown', async () => {
    let runs = 0; let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const handle = startBookRefundWorker({ process: async () => { runs += 1; await gate; return { claimed: 1, completed: 1 }; }, intervalMs: 60_000 });
    await Promise.resolve(); expect(runs).toBe(1);
    const closing = handle.close(); finish(); await closing;
  });
});
