import { afterEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { computePerceptualHashBatch } from '@/lib/perceptual-hash';
import { computePerceptualHashBatchDispatched, imageHashComputeConfigured } from './perceptual-hash-queue';

const environmentKeys = ['JOB_REDIS_URL', 'COMPUTE_ECS_CLUSTER', 'COMPUTE_ECS_TASK_DEFINITION', 'COMPUTE_ECS_SUBNETS', 'COMPUTE_ECS_SECURITY_GROUPS'] as const;
const original = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of environmentKeys) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('perceptual hash compute queue', () => {
  test('falls back to ordered local Sharp hashing when compute is unavailable', async () => {
    for (const key of environmentKeys) delete process.env[key];
    const images = await Promise.all(['#112233', '#abcdef'].map((background) => sharp({ create: { width: 24, height: 24, channels: 3, background } }).png().toBuffer()));
    expect(imageHashComputeConfigured()).toBe(false);
    await expect(computePerceptualHashBatchDispatched(images)).resolves.toEqual(await computePerceptualHashBatch(images));
    await expect(computePerceptualHashBatchDispatched([])).rejects.toThrow('between 1 and 20');
  });

  test('isolates each dispatched job and leaves timed-out staging for worker cleanup', async () => {
    const source = await Bun.file(new URL('./perceptual-hash-queue.ts', import.meta.url)).text();
    expect(source).toContain('new QueueEvents(queueName(jobId)');
    expect(source).toContain('new Worker<ImageHashJob, ImageHashResult>(queueName(targetJobId)');
    expect(source).toContain('if (completed) await Promise.all(storageKeys.map');
    expect(source).toContain('job.data.storageKeys.map');
    expect(source).toContain("state !== 'completed' && state !== 'active'");
    expect(source).toContain('ttl >= 0 && ttl <= 5 * 60');
    expect(source).toContain("state === 'active' && job.processedOn");
    expect(source).toContain('expiredQueue.obliterate({ force: true })');
    expect(source).toContain('QUEUE_RETENTION_MS = 24 * 60 * 60_000');
  });
});
