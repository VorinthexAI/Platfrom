import { createHash, randomUUID } from 'node:crypto';
import { Job, Queue, QueueEvents, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { computeDispatch, computeDispatchConfigured } from '@/lib/compute-jobs';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { createRedisConnection } from '@/lib/redis';
import { computePerceptualHashBatch, perceptualHashSchema } from '@/lib/perceptual-hash';

const QUEUE_NAME = 'image-hashing';
const JOB_TIMEOUT_MS = 10 * 60_000;
const QUEUE_RETENTION_MS = 24 * 60 * 60_000;
const QUEUE_REGISTRY_KEY = 'image-hashing:queues';
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
};
const imageHashJobSchema = z.object({
  schemaVersion: z.literal(1),
  storageKeys: z.array(z.string().min(1)).min(1).max(20),
}).strict();
type ImageHashJob = z.infer<typeof imageHashJobSchema>;
const imageHashResultSchema = z.object({ hashes: z.array(perceptualHashSchema).min(1).max(20) }).strict();
type ImageHashResult = z.infer<typeof imageHashResultSchema>;

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let redis: ReturnType<typeof createRedisConnection> | undefined;
const queueName = (jobId: string) => `${QUEUE_NAME}-${jobId}`;
const targetQueue = (jobId: string) => new Queue<ImageHashJob, ImageHashResult>(queueName(jobId), { connection: connection() });
const jobRedis = () => redis ??= connection();

export function imageHashComputeConfigured(): boolean {
  return computeDispatchConfigured() && Boolean(process.env.JOB_REDIS_URL?.trim());
}

async function registerQueue(jobId: string): Promise<void> {
  const registry = jobRedis();
  const expired = await registry.zrangebyscore(QUEUE_REGISTRY_KEY, 0, Date.now() - QUEUE_RETENTION_MS, 'LIMIT', 0, 20);
  for (const expiredJobId of expired) {
    if (expiredJobId === jobId) continue;
    const expiredQueue = targetQueue(expiredJobId);
    try { await expiredQueue.obliterate({ force: true }); } finally { await expiredQueue.close(); }
    await registry.zrem(QUEUE_REGISTRY_KEY, expiredJobId);
  }
  await registry.zadd(QUEUE_REGISTRY_KEY, Date.now(), jobId);
}

async function launchWorker(jobId: string, recoverStale = false): Promise<void> {
  const lock = `image-hashing:launch:${jobId}`;
  if (recoverStale) {
    const ttl = await jobRedis().ttl(lock);
    if (ttl >= 0 && ttl <= 5 * 60) await jobRedis().del(lock);
  }
  if (!await jobRedis().set(lock, randomUUID(), 'EX', 15 * 60, 'NX')) return;
  try {
    await computeDispatch({ jobType: 'image-hashing', jobKey: jobId });
  } catch (error) {
    await jobRedis().del(lock).catch(() => undefined);
    throw error;
  }
}

export async function computePerceptualHashBatchDispatched(images: readonly Uint8Array[]): Promise<string[]> {
  if (images.length === 0 || images.length > 20) throw new Error('Image hash batches must contain between 1 and 20 images.');
  if (!imageHashComputeConfigured()) return computePerceptualHashBatch(images);
  const digest = createHash('sha256').update('phash-64-dct-v1\0');
  for (const image of images) digest.update(String(image.byteLength)).update('\0').update(image);
  const jobId = digest.digest('hex');
  await registerQueue(jobId);
  const storageKeys = images.map((_, index) => `pending/image-hashing/${jobId}/${index}`);
  try {
    await Promise.all(images.map((bytes, index) => documentStorage.upload({ key: storageKeys[index]!, bytes, mimeType: 'application/octet-stream' })));
  } catch (error) {
    await Promise.all(storageKeys.map((key) => documentStorage.delete(key).catch(() => undefined)));
    throw error;
  }
  const events = new QueueEvents(queueName(jobId), { connection: connection() });
  const jobQueue = targetQueue(jobId);
  let completed = false;
  try {
    await events.waitUntilReady();
    const existing = await Job.fromId<ImageHashJob, ImageHashResult>(jobQueue, jobId);
    const job = existing ?? await jobQueue.add('hash-images', imageHashJobSchema.parse({ schemaVersion: 1, storageKeys }), { ...jobOptions, jobId });
    let state = await job.getState();
    if (state === 'failed') {
      await job.retry();
      state = 'waiting';
    }
    if (state === 'active' && job.processedOn && Date.now() - job.processedOn >= JOB_TIMEOUT_MS) {
      await jobRedis().del(`image-hashing:launch:${jobId}`);
      await launchWorker(jobId);
    } else if (state !== 'completed' && state !== 'active') {
      await launchWorker(jobId, true);
    }
    const result = imageHashResultSchema.parse(await job.waitUntilFinished(events, JOB_TIMEOUT_MS));
    if (result.hashes.length !== images.length) throw new Error('Image hashing worker returned the wrong number of hashes.');
    completed = true;
    return result.hashes;
  } finally {
    await events.close();
    await jobQueue.close();
    if (completed) await Promise.all(storageKeys.map((key) => documentStorage.delete(key).catch(() => undefined)));
  }
}

async function processJob(job: Job<ImageHashJob>): Promise<ImageHashResult> {
  const data = imageHashJobSchema.parse(job.data);
  const stored = await Promise.all(data.storageKeys.map((key) => documentStorage.download(key)));
  return imageHashResultSchema.parse({ hashes: await computePerceptualHashBatch(stored.map(({ bytes }) => bytes)) });
}

export async function runImageHashWorker(): Promise<void> {
  const targetJobId = z.string().length(64).regex(/^[a-f0-9]+$/).parse(process.env.IMAGE_HASHING_JOB_ID);
  let worker!: Worker<ImageHashJob, ImageHashResult>;
  let settled = false;
  const finish = async (job?: Job<ImageHashJob>) => {
    if (settled || !job) return;
    settled = true;
    await Promise.all(job.data.storageKeys.map((key) => documentStorage.delete(key).catch(() => undefined)));
    if (job.id) await jobRedis().del(`image-hashing:launch:${job.id}`).catch(() => undefined);
    await worker.close();
  };
  worker = new Worker<ImageHashJob, ImageHashResult>(queueName(targetJobId), async (job) => {
    const result = await processJob(job);
    await worker.pause(true);
    return result;
  }, { connection: connection(), concurrency: 1, autorun: false, lockDuration: JOB_TIMEOUT_MS, stalledInterval: 30_000, maxStalledCount: 2 });
  worker.on('completed', (job) => { void finish(job); });
  worker.on('failed', (job) => { if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) void finish(job); });
  const idleTimeout = setTimeout(() => { if (!settled) void worker.close(); }, 5 * 60_000);
  try {
    await worker.run();
  } finally {
    clearTimeout(idleTimeout);
    if (!settled) await worker.close();
    console.info(JSON.stringify({ action: 'image.hash.worker', status: 'stopped', targetJobId }));
  }
}
