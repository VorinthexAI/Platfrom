import { describe, expect, test } from 'bun:test';
import { fanoutStorageDeletion, processStorageDeletionQueueJob, startStorageDeletion, STORAGE_DELETION_LANES, STORAGE_DELETION_REPEAT, STORAGE_DELETION_SCHEDULER_ID, storageDeletionLaneJobId, storageDeletionMinuteBucket } from './storage-deletion-queue';

function fakeQueue() {
  const added: any[] = [], schedulers: unknown[][] = [];
  return {
    added, schedulers,
    async add(name: string, data: unknown, options: unknown) { added.push({ name, data, options }); return { id: (options as any).jobId }; },
    async getJob() { return undefined; },
    async upsertJobScheduler(...args: unknown[]) { schedulers.push(args); return {}; },
  };
}

describe('storage deletion automation queue', () => {
  test('fans out deterministic bounded lanes for one UTC minute', async () => {
    const queue = fakeQueue();
    const now = new Date('2026-09-04T12:34:56.789Z');
    expect(storageDeletionMinuteBucket(now)).toBe('2026-09-04T12:34:00.000Z');
    await expect(fanoutStorageDeletion({ queue: queue as never, now: () => now })).resolves.toEqual({ enqueued: STORAGE_DELETION_LANES, bucket: '2026-09-04T12:34:00.000Z' });
    expect(queue.added.map(({ data }) => data.lane)).toEqual([0, 1, 2, 3]);
    expect(new Set(queue.added.map(({ options }) => options.jobId)).size).toBe(4);
    expect(storageDeletionLaneJobId('2026-09-04T12:34:00.000Z', 0)).toBe(queue.added[0]!.options.jobId);
  });

  test('isolates a lane failure so BullMQ can retry it', async () => {
    const job = { schemaVersion: 1, kind: 'delete-lane', bucket: '2026-09-04T12:34:00.000Z', lane: 2 };
    await expect(processStorageDeletionQueueJob(job, {
      list: async () => [{ key: 'failed', storageKey: 'objects/failed', createdAt: '2026-08-19T00:00:00.000Z', status: 'deleting', claimToken: '11111111-1111-4111-8111-111111111111', claimedAt: '2026-08-19T00:00:01.000Z' }],
      resolveClaim: async () => 'unreferenced', bulkDelete: async () => ({ succeeded: [], failed: ['objects/failed'] }), release: async () => true, closeInventory: async () => {},
    })).rejects.toThrow('lane 2');
  });

  test('removes a failed deterministic lane during same-minute recovery', async () => {
    const queue = fakeQueue(); let removed = 0;
    queue.getJob = async () => ({ async getState() { return 'failed'; }, async remove() { removed += 1; } }) as any;
    await fanoutStorageDeletion({ queue: queue as never, now: () => new Date('2026-09-04T12:34:30.000Z') });
    expect(removed).toBe(4);
    expect(queue.added).toHaveLength(4);
  });

  test('installs minute recovery, starts with fanout, and closes gracefully', async () => {
    const queue = fakeQueue(); let closed = 0;
    const handle = await startStorageDeletion({ queue: queue as never, now: () => new Date('2026-09-04T12:34:00.000Z'), workerFactory: () => ({ on() {}, async close() { closed += 1; } }) });
    expect(queue.schedulers[0]?.[0]).toBe(STORAGE_DELETION_SCHEDULER_ID);
    expect(queue.schedulers[0]?.[1]).toEqual(STORAGE_DELETION_REPEAT);
    expect(queue.added).toHaveLength(4);
    await handle.close();
    expect(closed).toBe(1);
  });
});
