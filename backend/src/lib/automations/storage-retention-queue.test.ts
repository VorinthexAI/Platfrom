import { describe, expect, test } from 'bun:test';
import { enqueueStorageWipe, processStorageRetentionJob, scanStorageRetention, STORAGE_RETENTION_REPEAT, STORAGE_RETENTION_SCHEDULER_ID, startStorageRetention, storageRetentionAction, storageRetentionJobSchema, storageWipeJobId } from './storage-retention-queue';
import { STORAGE_RETENTION_MS, storageWipeDueAt } from './storage-charger-repository';
import { STORAGE_RETENTION_SCAN_BATCH_SIZE } from './storage-retention-repository';

function fakeQueue() {
  const added: any[] = [], schedulers: unknown[][] = [];
  return {
    added, schedulers,
    async add(name: string, data: unknown, options: unknown) { added.push({ name, data, options }); return { id: (options as any).jobId }; },
    async getJob() { return undefined; },
    async upsertJobScheduler(...args: unknown[]) { schedulers.push(args); return {}; },
  };
}

describe('storage retention queue', () => {
  test('uses exactly 90 elapsed days across calendar and daylight-saving boundaries', () => {
    const failedAt = '2026-03-01T01:30:00.000Z';
    const due = storageWipeDueAt(failedAt);
    expect(Date.parse(due) - Date.parse(failedAt)).toBe(STORAGE_RETENTION_MS);
    expect(due).toBe('2026-05-30T01:30:00.000Z');
    const base = { key: 'state', userKey: 'user-1', paymentPastDueAt: failedAt, wipeDueAt: due, minimumBalanceMicroSparks: 10, balanceMicroSparks: 0 };
    expect(storageRetentionAction(base, new Date(Date.parse(due) - 1))).toBe('wait');
    expect(storageRetentionAction(base, new Date(due))).toBe('wipe');
    expect(storageRetentionAction({ ...base, balanceMicroSparks: 9 }, new Date(due))).toBe('wipe');
    expect(storageRetentionAction({ ...base, balanceMicroSparks: 10 }, new Date(due))).toBe('fund');
    expect(storageRetentionAction({ ...base, wipeStartedAt: due, wipeBatch: 1, balanceMicroSparks: 10 }, new Date(due))).toBe('wipe');
    expect(storageRetentionAction({ ...base, wipedAt: due }, new Date(Date.parse(due) + 1))).toBe('wait');
  });

  test('uses strict deterministic per-user wipe jobs', async () => {
    const queue = fakeQueue();
    const due = '2026-09-04T00:00:00.000Z';
    await enqueueStorageWipe('user-1', due, 0, queue as never);
    expect(storageWipeJobId('user-1', due, 0)).toMatch(/^[a-f0-9]{64}$/);
    expect(storageWipeJobId('user-1', due, 0)).not.toBe(storageWipeJobId('user-1', due, 1));
    expect(queue.added[0]).toMatchObject({ name: 'wipe-user', data: { schemaVersion: 1, kind: 'wipe-user', userKey: 'user-1', expectedWipeDueAt: due, batch: 0 } });
    expect(() => storageRetentionJobSchema.parse({ schemaVersion: 1, kind: 'wipe-user', userKey: 'user-1', expectedWipeDueAt: due, batch: 0, extra: true })).toThrow();
  });

  test('removes an exhausted failed wipe before deterministically re-enqueueing it', async () => {
    let removed = 0;
    const queue = fakeQueue();
    queue.getJob = async () => ({ async getState() { return 'failed'; }, async remove() { removed += 1; } }) as any;
    const due = '2026-09-04T00:00:00.000Z';
    const first = await enqueueStorageWipe('user-1', due, 0, queue as never);
    const second = await enqueueStorageWipe('user-1', due, 0, queue as never);
    expect(removed).toBe(2);
    expect(first.jobId).toBe(second.jobId);
  });

  test('removes a completed batch job so persisted progress can recover it', async () => {
    let removed = 0;
    const queue = fakeQueue();
    queue.getJob = async () => ({ async getState() { return 'completed'; }, async remove() { removed += 1; } }) as any;
    await enqueueStorageWipe('user-1', '2026-09-04T00:00:00.000Z', 1, queue as never);
    expect(removed).toBe(1);
    expect(queue.added[0]?.data.batch).toBe(1);
  });

  test('clears positive balances prospectively and queues only due zero balances', async () => {
    const queue = fakeQueue(), funded: string[] = [];
    const base = { key: 'state', paymentPastDueAt: '2026-01-01T00:00:00.000Z' };
    const repository = {
      async listUnfunded() { return [
        { ...base, userKey: 'restored', wipeDueAt: '2026-02-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, balanceMicroSparks: 10 },
        { ...base, userKey: 'restored-after-wipe', wipeDueAt: '2026-02-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, wipedAt: '2026-02-02T00:00:00.000Z', balanceMicroSparks: 20 },
        { ...base, userKey: 'due', wipeDueAt: '2026-02-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, balanceMicroSparks: 1 },
        { ...base, userKey: 'later', wipeDueAt: '2027-02-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, balanceMicroSparks: 0 },
      ]; },
      async markFunded(userKey: string) { funded.push(userKey); return true; },
      async wipe() { return { status: 'stale' as const }; },
    };
    expect(await scanStorageRetention({ repository, queue: queue as never, now: () => new Date('2026-09-04T00:00:00.000Z') })).toEqual({ scanned: 4, funded: 1, enqueued: 1 });
    expect(funded).toEqual(['restored']);
    expect(queue.added.map((item) => item.data.userKey)).toEqual(['due']);
  });

  test('scans unfunded users in bounded keyset pages', async () => {
    const queue = fakeQueue();
    const states = Array.from({ length: STORAGE_RETENTION_SCAN_BATCH_SIZE + 1 }, (_, index) => ({ key: `state-${String(index).padStart(3, '0')}`, userKey: `user-${index}`, paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, balanceMicroSparks: 0 }));
    const pages: Array<{ afterKey?: string; limit?: number } | undefined> = [];
    const repository = {
      async listUnfunded(input?: { afterKey?: string; limit?: number }) {
        pages.push(input);
        const start = input?.afterKey ? states.findIndex(({ key }) => key === input.afterKey) + 1 : 0;
        return states.slice(start, start + (input?.limit ?? states.length));
      },
      async markFunded() { return false; }, async wipe() { return { status: 'stale' as const }; },
    };
    await expect(scanStorageRetention({ repository, queue: queue as never, now: () => new Date('2026-04-01T00:00:00.000Z') })).resolves.toEqual({ scanned: states.length, funded: 0, enqueued: states.length });
    expect(pages).toEqual([{ afterKey: undefined, limit: STORAGE_RETENTION_SCAN_BATCH_SIZE }, { afterKey: states[STORAGE_RETENTION_SCAN_BATCH_SIZE - 1]!.key, limit: STORAGE_RETENTION_SCAN_BATCH_SIZE }]);
  });

  test('installs a daily UTC scheduler and performs startup recovery', async () => {
    const queue = fakeQueue(); let closed = 0;
    const repository = { async listUnfunded() { return []; }, async markFunded() { return false; }, async wipe() { return { status: 'stale' as const }; } };
    const handle = await startStorageRetention({ repository, queue: queue as never, workerFactory: () => ({ on() {}, async close() { closed += 1; } }) });
    expect(queue.schedulers[0]?.[0]).toBe(STORAGE_RETENTION_SCHEDULER_ID);
    expect(queue.schedulers[0]?.[1]).toEqual(STORAGE_RETENTION_REPEAT);
    await handle.close();
    expect(closed).toBe(1);
  });

  test('continues scheduling due users when one enqueue fails, then retries the wake job', async () => {
    const attempted: string[] = [];
    const queue = fakeQueue();
    queue.add = async (_name, data: any, options: any) => { attempted.push(data.userKey); if (data.userKey === 'first') throw new Error('redis write failed'); queue.added.push({ data, options }); return { id: options.jobId }; };
    const state = { key: 'state', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: '2026-04-01T00:00:00.000Z', minimumBalanceMicroSparks: 10, balanceMicroSparks: 0 };
    const repository = { async listUnfunded() { return [{ ...state, userKey: 'first' }, { ...state, userKey: 'second' }]; }, async markFunded() { return false; }, async wipe() { return { status: 'stale' as const }; } };
    await expect(scanStorageRetention({ repository, queue: queue as never, now: () => new Date('2026-04-01T00:00:00.000Z') })).rejects.toThrow('redis write failed');
    expect(attempted).toEqual(['first', 'second']);
    expect(queue.added.map(({ data }) => data.userKey)).toEqual(['second']);
  });

  test('passes timestamp fences to wipe processing so a post-enqueue top-up is stale', async () => {
    const due = '2026-04-01T00:00:00.000Z';
    const calls: unknown[] = [];
    const repository = { async listUnfunded() { return []; }, async markFunded() { return false; }, async wipe(input: unknown) { calls.push(input); return { status: 'stale' as const }; } };
    await expect(processStorageRetentionJob({ schemaVersion: 1, kind: 'wipe-user', userKey: 'user-1', expectedWipeDueAt: due, batch: 0 }, { repository, queue: fakeQueue() as never, now: () => new Date('2026-04-01T00:00:00.001Z') })).resolves.toEqual({ status: 'stale' });
    expect(calls).toEqual([{ userKey: 'user-1', expectedWipeDueAt: due, batch: 0, now: '2026-04-01T00:00:00.001Z' }]);
  });

  test('runs the 90-day boundary and top-up race as one lifecycle', async () => {
    const queue = fakeQueue();
    const failedAt = '2026-01-01T00:00:00.000Z';
    const due = storageWipeDueAt(failedAt);
    const state = { key: 'state', userKey: 'user-1', paymentPastDueAt: failedAt, wipeDueAt: due, minimumBalanceMicroSparks: 25, balanceMicroSparks: 0, fundedAt: undefined as string | undefined };
    const repository = {
      async listUnfunded() { return state.fundedAt ? [] : [{ ...state }]; },
      async markFunded(_userKey: string, fundedAt: string) { if (state.balanceMicroSparks < state.minimumBalanceMicroSparks) return false; state.fundedAt = fundedAt; return true; },
      async wipe(input: { expectedWipeDueAt: string; now: string }) { return !state.fundedAt && state.balanceMicroSparks < state.minimumBalanceMicroSparks && input.expectedWipeDueAt === state.wipeDueAt && input.now >= state.wipeDueAt ? { status: 'wiped' as const, processed: 1 } : { status: 'stale' as const }; },
    };

    await scanStorageRetention({ repository, queue: queue as never, now: () => new Date(Date.parse(due) - 1) });
    expect(queue.added).toHaveLength(0);
    await scanStorageRetention({ repository, queue: queue as never, now: () => new Date(due) });
    expect(queue.added).toHaveLength(1);

    state.balanceMicroSparks = 25;
    await expect(processStorageRetentionJob(queue.added[0]!.data, { repository, now: () => new Date(Date.parse(due) + 1) })).resolves.toEqual({ status: 'stale' });
    await expect(scanStorageRetention({ repository, queue: queue as never, now: () => new Date(Date.parse(due) + 2) })).resolves.toMatchObject({ funded: 1, enqueued: 0 });
    expect(state.fundedAt).toBe(new Date(Date.parse(due) + 2).toISOString());
  });

  test('enqueues the persisted next batch and scanner recovers a commit-before-enqueue crash', async () => {
    const due = '2026-04-01T00:00:00.000Z';
    const queue = fakeQueue();
    const state = { key: 'state', userKey: 'user', paymentPastDueAt: '2026-01-01T00:00:00.000Z', wipeDueAt: due, minimumBalanceMicroSparks: 10, balanceMicroSparks: 100, wipeBatch: 1, wipeStartedAt: due };
    const repository = {
      async listUnfunded() { return [state]; }, async markFunded() { return false; },
      async wipe(input: { batch: number }) { return input.batch === 1 ? { status: 'continued' as const, nextBatch: 2, processed: 1000 } : { status: 'stale' as const }; },
    };
    await scanStorageRetention({ repository, queue: queue as never, now: () => new Date(due) });
    expect(queue.added[0]?.data.batch).toBe(1);
    await processStorageRetentionJob(queue.added[0]!.data, { repository, queue: queue as never, now: () => new Date(due) });
    expect(queue.added[1]?.data.batch).toBe(2);
  });

  test('progresses multiple batches to completion and rejects old-batch replay', async () => {
    const due = '2026-04-01T00:00:00.000Z';
    const queue = fakeQueue();
    let currentBatch = 0;
    const repository = {
      async listUnfunded() { return []; }, async markFunded() { return false; },
      async wipe(input: { batch: number }) {
        if (input.batch !== currentBatch) return { status: 'stale' as const };
        if (currentBatch === 0) { currentBatch = 1; return { status: 'continued' as const, nextBatch: 1, processed: 1000 }; }
        return { status: 'wiped' as const, processed: 1 };
      },
    };
    const first = { schemaVersion: 1 as const, kind: 'wipe-user' as const, userKey: 'user', expectedWipeDueAt: due, batch: 0 };
    await expect(processStorageRetentionJob(first, { repository, queue: queue as never })).resolves.toEqual({ status: 'continued', nextBatch: 1, processed: 1000 });
    await expect(processStorageRetentionJob(first, { repository, queue: queue as never })).resolves.toEqual({ status: 'stale' });
    await expect(processStorageRetentionJob(queue.added[0]!.data, { repository, queue: queue as never })).resolves.toEqual({ status: 'wiped', processed: 1 });
  });
});
