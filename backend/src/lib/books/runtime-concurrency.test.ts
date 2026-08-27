import { describe, expect, test } from 'bun:test';
import { boundedMap } from './runtime';

describe('book generation concurrency', () => {
  test('stops scheduling new work and waits for started lanes after a failure', async () => {
    const events: string[] = [];
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => { release = resolve; });
    const operation = boundedMap([0, 1, 2, 3], 2, async (value) => {
      events.push(`start:${value}`);
      if (value === 0) throw new Error('chapter failed');
      await delayed;
      events.push(`finish:${value}`);
    });
    await Promise.resolve();
    expect(events).toEqual(['start:0', 'start:1']);
    let settled = false;
    void operation.finally(() => { settled = true; }).catch(() => undefined);
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(operation).rejects.toThrow('chapter failed');
    expect(events).toEqual(['start:0', 'start:1', 'finish:1']);
  });
});
