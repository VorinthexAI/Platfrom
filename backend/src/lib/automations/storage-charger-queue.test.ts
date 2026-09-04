import { describe, expect, test } from 'bun:test';
import { HOUR_MS, type StorageHourWindow } from './storage-charger';
import { createStorageChargeService, STORAGE_CHARGER_REPEAT, STORAGE_CHARGER_SCHEDULER_ID, enqueueStorageChargingHour, recoverStorageChargingHours, startStorageCharger, storageChargerHourJobId, storageChargerJobOptions, storageChargerJobSchema } from './storage-charger-queue';

const windowAt = (hour: number): StorageHourWindow => ({ start: `2026-09-04T${String(hour).padStart(2, '0')}:00:00.000Z`, end: new Date(Date.parse(`2026-09-04T${String(hour).padStart(2, '0')}:00:00.000Z`) + HOUR_MS).toISOString() });

function fakeQueue() {
  const added: Array<{ name: string; data: any; options: any }> = [];
  const schedulers: unknown[][] = [];
  return {
    added, schedulers,
    async add(name: string, data: unknown, options: unknown) { added.push({ name, data, options }); return { id: (options as any).jobId }; },
    async getJob() { return undefined; },
    async upsertJobScheduler(...args: unknown[]) { schedulers.push(args); return {} as any; },
  };
}

describe('storage charger queue', () => {
  test('uses strict versioned payloads and colon-free SHA-256 concrete-hour IDs', () => {
    const window = windowAt(10);
    const id = storageChargerHourJobId(window);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    expect(id).not.toContain(':');
    expect(storageChargerHourJobId(window)).toBe(id);
    expect(() => storageChargerJobSchema.parse({ schemaVersion: 1, kind: 'wake', extra: true })).toThrow();
    expect(() => storageChargerJobSchema.parse({ schemaVersion: 2, kind: 'wake' })).toThrow();
  });

  test('enqueues missed closed hours oldest first with deterministic IDs', async () => {
    const queue = fakeQueue();
    const windows = [windowAt(11), windowAt(9), windowAt(10)];
    const repository = { async listMissedClosedHours() { return windows; } } as any;
    expect(await recoverStorageChargingHours({ repository, queue: queue as any, now: () => new Date('2026-09-04T12:00:00.000Z') })).toEqual({ enqueued: 3 });
    expect(queue.added.map(({ data }) => data.window.start)).toEqual([windows[1]!.start, windows[2]!.start, windows[0]!.start]);
    expect(new Set(queue.added.map(({ options }) => options.jobId)).size).toBe(3);
  });

  test('deduplicates repeated recovery windows before queueing', async () => {
    const queue = fakeQueue(), repeated = windowAt(10);
    const repository = { async listMissedClosedHours() { return [repeated, repeated, windowAt(11)]; } } as any;
    expect(await recoverStorageChargingHours({ repository, queue: queue as any })).toEqual({ enqueued: 2 });
    expect(queue.added.map(({ data }) => data.window.start)).toEqual([repeated.start, windowAt(11).start]);
  });

  test('attempts every missed hour before surfacing an enqueue failure', async () => {
    const attempted: string[] = [];
    const queue = fakeQueue();
    queue.add = async (_name, data: any, options: any) => { attempted.push(data.window.start); if (data.window.start === windowAt(10).start) throw new Error('redis unavailable'); queue.added.push({ name: 'charge-hour', data, options }); return { id: options.jobId }; };
    const repository = { async listMissedClosedHours() { return [windowAt(10), windowAt(11)]; } } as any;
    await expect(recoverStorageChargingHours({ repository, queue: queue as any })).rejects.toThrow('redis unavailable');
    expect(attempted).toEqual([windowAt(10).start, windowAt(11).start]);
    expect(queue.added.map(({ data }) => data.window.start)).toEqual([windowAt(11).start]);
  });

  test('removes an exhausted failed job before recovery re-enqueues it', async () => {
    let removed = 0;
    const queue = fakeQueue();
    queue.getJob = async () => ({ async getState() { return 'failed'; }, async remove() { removed += 1; } }) as any;
    await enqueueStorageChargingHour(windowAt(10), queue as any);
    expect(removed).toBe(1);
    expect(queue.added).toHaveLength(1);
  });

  test('configures an hourly UTC scheduler, retries, startup recovery, and graceful worker close', async () => {
    const queue = fakeQueue();
    let workerClosed = 0;
    const repository = { async listMissedClosedHours() { return []; } } as any;
    const handle = await startStorageCharger({ repository, queue: queue as any, workerFactory: () => ({ on() {}, async close() { workerClosed += 1; } }) });
    expect(queue.schedulers[0]?.[0]).toBe(STORAGE_CHARGER_SCHEDULER_ID);
    expect(queue.schedulers[0]?.[1]).toEqual(STORAGE_CHARGER_REPEAT);
    expect(queue.schedulers[0]?.[2]).toMatchObject({ name: 'wake', data: { schemaVersion: 1, kind: 'wake' } });
    expect(storageChargerJobOptions).toMatchObject({ attempts: 8, backoff: { type: 'exponential', delay: 5_000 } });
    await handle.close();
    expect(workerClosed).toBe(1);
  });

  test('links an idempotent storage ledger charge to its scoped analytics event', async () => {
    const charges: any[] = [], events: any[] = [];
    const service = createStorageChargeService({
      hash: async () => 'a'.repeat(64), id: () => 'event-1',
      charge: async (userKey, input) => { charges.push({ userKey, input }); return { status: 'applied', transaction: { key: 'transaction-1', eventKey: input.eventKey } } as never; },
      getUser: async () => ({ key: 'user-1', currentScopeKey: 'scope-1' }) as never,
      record: async (input, options) => { events.push({ input, options }); },
    });
    await service.charge({ userKey: 'user-1', amountMicroSparks: '25', idempotencyKey: 'b'.repeat(64), kind: 'storage', hourStart: windowAt(10).start, hourEnd: windowAt(10).end });
    expect(charges).toEqual([{ userKey: 'user-1', input: expect.objectContaining({ kind: 'storage', microSparks: 25, eventKey: 'event-1', requestHash: 'a'.repeat(64) }) }]);
    expect(events).toEqual([{ input: expect.objectContaining({ userId: 'user-1', scopeKey: 'scope-1', slug: 'storage.hourly', microSparks: 25, sparkTransactionKey: 'transaction-1' }), options: { key: 'event-1' } }]);
  });

  test('rejects unsafe storage charges and ledger idempotency conflicts', async () => {
    const input = { userKey: 'user-1', idempotencyKey: 'b'.repeat(64), kind: 'storage' as const, hourStart: windowAt(10).start, hourEnd: windowAt(10).end };
    await expect(createStorageChargeService().charge({ ...input, amountMicroSparks: String(Number.MAX_SAFE_INTEGER + 1) })).rejects.toThrow('supported microSpark range');
    const service = createStorageChargeService({ charge: async () => ({ status: 'conflict', transaction: {} }) as never, hash: async () => 'a'.repeat(64) });
    await expect(service.charge({ ...input, amountMicroSparks: '1' })).rejects.toThrow('conflicted');
  });
});
