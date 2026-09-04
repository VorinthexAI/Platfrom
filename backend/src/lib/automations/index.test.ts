import { describe, expect, test } from 'bun:test';
import { createAutomationLifecycle } from './index';

describe('automation lifecycle', () => {
  test('includes connected inbox charging in the unified startup and shutdown lifecycle', async () => {
    const source = await Bun.file(new URL('./index.ts', import.meta.url)).text();
    expect(source).toContain('startInboxCharger(dependencies.inbox)');
    expect(source).toContain('closeInboxChargerQueue()');
    expect(source).toContain("export * from './inbox-charger-queue'");
  });

  test('starts once, closes worker and queue, and can restart', async () => {
    let starts = 0;
    let workerCloses = 0;
    let queueCloses = 0;
    const lifecycle = createAutomationLifecycle(async () => { starts += 1; return { async close() { workerCloses += 1; } }; }, async () => { queueCloses += 1; });
    const first = lifecycle.start();
    expect(lifecycle.start()).toBe(first);
    await first;
    await lifecycle.close();
    await lifecycle.start();
    await lifecycle.close();
    expect({ starts, workerCloses, queueCloses }).toEqual({ starts: 2, workerCloses: 2, queueCloses: 2 });
  });

  test('allows startup retry after a failed start', async () => {
    let attempts = 0;
    const lifecycle = createAutomationLifecycle(async () => { attempts += 1; if (attempts === 1) throw new Error('redis unavailable'); return { async close() {} }; }, async () => {});
    await expect(lifecycle.start()).rejects.toThrow('redis unavailable');
    await expect(lifecycle.start()).resolves.toBeDefined();
  });

  test('still closes the queue when worker shutdown fails', async () => {
    let queueCloses = 0;
    const lifecycle = createAutomationLifecycle(async () => ({ async close() { throw new Error('worker close failed'); } }), async () => { queueCloses += 1; });
    await lifecycle.start();
    await expect(lifecycle.close()).rejects.toThrow('worker close failed');
    expect(queueCloses).toBe(1);
  });

  test('coalesces concurrent shutdown and waits before restarting', async () => {
    let workerCloses = 0, queueCloses = 0, starts = 0;
    let releaseClose!: () => void;
    const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
    const lifecycle = createAutomationLifecycle(async () => { starts += 1; return { async close() { workerCloses += 1; await closeGate; } }; }, async () => { queueCloses += 1; });
    await lifecycle.start();
    const firstClose = lifecycle.close();
    expect(lifecycle.close()).toBe(firstClose);
    const restart = lifecycle.start();
    await Promise.resolve();
    expect(starts).toBe(1);
    releaseClose();
    await firstClose;
    await restart;
    expect({ starts, workerCloses, queueCloses }).toEqual({ starts: 2, workerCloses: 1, queueCloses: 1 });
    await lifecycle.close();
  });
});
