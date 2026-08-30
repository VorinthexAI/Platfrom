import { expect, test } from 'bun:test';
import { executeQueueAction } from './queue';

test('retries retryable execution with configurable exponential timing', async () => {
  let attempts = 0;
  const started = Date.now();
  const result = await executeQueueAction({
    action: 'text',
    baseDelayMs: 5,
    maxAttempts: 3,
    shouldRetry: () => true,
    run: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('retry');
      return 'ok';
    },
  });
  expect(result).toBe('ok');
  expect(attempts).toBe(3);
  expect(Date.now() - started).toBeGreaterThanOrEqual(15);
});

test('does not retry non-retryable execution', async () => {
  let attempts = 0;
  await expect(executeQueueAction({ action: 'image', shouldRetry: () => false, run: async () => { attempts += 1; throw new Error('invalid'); } })).rejects.toThrow('invalid');
  expect(attempts).toBe(1);
});
