import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { COMMERCE_RECONCILIATION_REPEAT, COMMERCE_RECONCILIATION_SCHEDULER_ID, commerceReconciliationDayJobId, commerceReconciliationJobOptions, commerceReconciliationJobSchema, processCommerceReconciliationJob, recoverCommerceReconciliation, startCommerceReconciliation } from './commerce-reconciliation-queue';

const window = { start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' };
const originalEnvironment = process.env.POLAR_ENV, originalToken = process.env.POLAR_ACCESS_TOKEN;
afterEach(() => { process.env.POLAR_ENV = originalEnvironment; process.env.POLAR_ACCESS_TOKEN = originalToken; });

describe('commerce reconciliation queue', () => {
  test('uses stable UTC scheduler, SHA-256 day IDs, retries, concurrency one, and strict v1 payloads', async () => {
    expect(COMMERCE_RECONCILIATION_SCHEDULER_ID).toBe('nightly-commerce-reconciliation-wakeup-v1');
    expect(COMMERCE_RECONCILIATION_REPEAT).toEqual({ pattern: '0 0 * * *', tz: 'UTC' });
    expect(commerceReconciliationJobOptions).toMatchObject({ attempts: 8, backoff: { type: 'exponential', delay: 5_000 } });
    expect(commerceReconciliationDayJobId(window)).toBe(createHash('sha256').update(`commerce-reconcile-day\0${window.start}`).digest('hex'));
    expect(() => commerceReconciliationJobSchema.parse({ schemaVersion: 1, kind: 'wake', extra: true })).toThrow();
    expect(() => commerceReconciliationJobSchema.parse({ schemaVersion: 2, kind: 'reconcile-day', window })).toThrow();
    expect(await Bun.file(new URL('./commerce-reconciliation-queue.ts', import.meta.url)).text()).toContain('concurrency: 1');
  });

  test('marks a run complete only after every provider projection succeeds', async () => {
    let completed = 0;
    const repository = { prepareLatestMissingDay: async () => null, ensurePending: async () => ({}), complete: async () => { completed += 1; } };
    const dependencies = { repository: repository as never, provider: { listOrders: async () => { throw new Error('provider unavailable'); }, listSubscriptions: async () => [] }, service: {} as never, now: () => new Date('2026-01-19T00:00:00.000Z') };
    await expect(processCommerceReconciliationJob({ schemaVersion: 1, kind: 'reconcile-day', window }, dependencies)).rejects.toThrow('provider unavailable');
    expect(completed).toBe(0);
  });

  test('recovers only the latest missing closed day and registers the scheduler before worker startup', async () => {
    const calls: string[] = [];
    const repository = { prepareLatestMissingDay: async () => window, ensurePending: async () => ({}), complete: async () => {} };
    const queue = { upsertJobScheduler: async (id: string, repeat: unknown) => { calls.push(`scheduler:${id}:${JSON.stringify(repeat)}`); }, getJob: async () => undefined, add: async (_name: string, _data: unknown, options: { jobId: string }) => { calls.push(`job:${options.jobId}`); return { id: options.jobId }; } };
    expect(await recoverCommerceReconciliation({ repository: repository as never, queue: queue as never, now: () => new Date('2026-01-18T12:00:00.000Z') })).toEqual({ enqueued: 1 });
    const handle = await startCommerceReconciliation({ repository: repository as never, queue: queue as never, provider: { listOrders: async () => [], listSubscriptions: async () => [] }, service: {} as never, workerFactory: () => ({ on() {}, async close() { calls.push('close'); } }) });
    expect(calls[1]).toContain(`scheduler:${COMMERCE_RECONCILIATION_SCHEDULER_ID}`);
    await handle.close();
  });

  test('is a clean no-op without Polar configuration or injected dependencies', async () => {
    delete process.env.POLAR_ENV; delete process.env.POLAR_ACCESS_TOKEN;
    const handle = await startCommerceReconciliation();
    await expect(handle.close()).resolves.toBeUndefined();
  });
});
