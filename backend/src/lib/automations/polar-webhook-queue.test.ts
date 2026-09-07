import { describe, expect, test } from 'bun:test';
import { enqueuePolarWebhook, POLAR_WEBHOOK_RECOVERY_REPEAT, POLAR_WEBHOOK_RECOVERY_SCHEDULER_ID, polarWebhookJobId, polarWebhookJobOptions, processPolarWebhookJob, recoverFailedPolarWebhooks, startPolarWebhookWorker } from './polar-webhook-queue';

const event = { type: 'order.paid', data: { id: 'order-1' } };

describe('Polar webhook queue', () => {
  test('uses a deterministic job ID and durable retries', async () => {
    let added: { name: string; data: unknown; options: unknown } | undefined;
    const queue = { getJob: async () => undefined, add: async (name: string, data: unknown, options: unknown) => { added = { name, data, options }; return { id: 'job-1' }; } };
    await expect(enqueuePolarWebhook('webhook-1', event, queue as never)).resolves.toEqual({ jobId: 'job-1' });
    expect(added).toMatchObject({ name: 'process', data: { schemaVersion: 1, kind: 'process', webhookId: 'webhook-1', event }, options: { attempts: 8, jobId: polarWebhookJobId('webhook-1') } });
    expect(polarWebhookJobOptions.backoff).toEqual({ type: 'exponential', delay: 5_000 });
  });

  test('atomically retries a retained failed job when Polar redelivers it', async () => {
    let retried = false;
    const queue = {
      getJob: async () => ({ id: 'original', getState: async () => 'failed', retry: async () => { retried = true; } }),
      add: async () => { throw new Error('must not replace a failed job'); },
    };
    await expect(enqueuePolarWebhook('webhook-1', event, queue as never)).resolves.toEqual({ jobId: 'original' });
    expect(retried).toBe(true);
  });

  test('processes through the canonical service before completing the claim', async () => {
    const calls: string[] = [];
    await processPolarWebhookJob({ schemaVersion: 1, kind: 'process', webhookId: 'webhook-1', event }, {
      service: { processWebhook: async () => { calls.push('processed'); return { ignored: true }; } },
      complete: async (_provider, webhookId, patch) => { calls.push(`${webhookId}:${patch.status}`); return null; },
      now: () => new Date('2026-09-05T12:00:00.000Z'),
    });
    expect(calls).toEqual(['processed', 'webhook-1:processed']);
  });

  test('periodically requeues exhausted processing jobs', async () => {
    let retried = 0;
    const failed = { data: { schemaVersion: 1, kind: 'process', webhookId: 'webhook-1', event }, retry: async () => { retried += 1; } };
    const queue = { getJobs: async () => [failed] };
    await expect(recoverFailedPolarWebhooks(queue as never)).resolves.toEqual({ requeued: 1 });
    expect(retried).toBe(1);
  });

  test('starts and closes one injected worker', async () => {
    let processor: ((data: unknown) => Promise<unknown>) | undefined;
    let closed = false;
    let scheduler: unknown;
    const queue = { upsertJobScheduler: async (...input: unknown[]) => { scheduler = input; }, getJob: async () => undefined, getJobs: async () => [], add: async () => ({ id: 'job' }) };
    const handle = await startPolarWebhookWorker({ queue: queue as never, workerFactory: (value) => { processor = value; return { on: () => {}, close: async () => { closed = true; } }; }, service: { processWebhook: async () => ({ ignored: true }) }, complete: async () => null });
    expect(processor).toBeDefined();
    expect(scheduler).toEqual([POLAR_WEBHOOK_RECOVERY_SCHEDULER_ID, POLAR_WEBHOOK_RECOVERY_REPEAT, expect.any(Object)]);
    await handle.close();
    expect(closed).toBe(true);
  });
});
