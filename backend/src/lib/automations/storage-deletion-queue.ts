import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { drainStorageDeletionJobs, type StorageDeletionDependencies } from '@/lib/storage-deletion';

export const STORAGE_DELETION_QUEUE_NAME = 'storage-object-deletion';
export const STORAGE_DELETION_SCHEDULER_ID = 'storage-object-deletion-wakeup-v1';
export const STORAGE_DELETION_REPEAT = { pattern: '* * * * *', tz: 'UTC' } as const;
export const STORAGE_DELETION_LANES = 4;
export const STORAGE_DELETION_LANE_BATCH_SIZE = 1000;
export const storageDeletionJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 } };

const wakeSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wake') }).strict();
const laneSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('delete-lane'), bucket: z.string().datetime(), lane: z.number().int().min(0).max(STORAGE_DELETION_LANES - 1) }).strict();
export const storageDeletionQueueJobSchema = z.discriminatedUnion('kind', [wakeSchema, laneSchema]);
export type StorageDeletionQueueJob = z.infer<typeof storageDeletionQueueJobSchema>;
type Result = { enqueued: number; bucket: string } | { deleted: number; pending: number };
type QueueAccess = Pick<Queue<StorageDeletionQueueJob, Result>, 'add' | 'getJob' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };

export interface StorageDeletionQueueDependencies extends StorageDeletionDependencies {
  now?: () => Date;
  queue?: QueueAccess;
  workerFactory?: (processor: (data: unknown) => Promise<Result>) => WorkerHandle;
}

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<StorageDeletionQueueJob, Result> | undefined;
const getQueue = () => {
  if (queue) return queue;
  queue = new Queue(STORAGE_DELETION_QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('storage deletion queue error', { error }));
  return queue;
};

export const storageDeletionMinuteBucket = (now: Date) => {
  if (!Number.isFinite(now.getTime())) throw new TypeError('A valid storage deletion time is required.');
  return new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
};
export const storageDeletionLaneJobId = (bucket: string, lane: number) => createHash('sha256').update(`storage-delete-lane\0${z.string().datetime().parse(bucket)}\0${z.number().int().min(0).max(STORAGE_DELETION_LANES - 1).parse(lane)}`).digest('hex');

async function enqueueLane(bucket: string, lane: number, targetQueue: QueueAccess) {
  const data = laneSchema.parse({ schemaVersion: 1, kind: 'delete-lane', bucket, lane });
  const jobId = storageDeletionLaneJobId(bucket, lane);
  const existing = await targetQueue.getJob(jobId);
  if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  await targetQueue.add('delete-lane', data, { ...storageDeletionJobOptions, jobId });
}

export async function fanoutStorageDeletion(dependencies: StorageDeletionQueueDependencies = {}) {
  const targetQueue = dependencies.queue ?? getQueue();
  const bucket = storageDeletionMinuteBucket((dependencies.now ?? (() => new Date()))());
  let failure: unknown;
  for (let lane = 0; lane < STORAGE_DELETION_LANES; lane += 1) {
    try { await enqueueLane(bucket, lane, targetQueue); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
  return { enqueued: STORAGE_DELETION_LANES, bucket };
}

export async function processStorageDeletionQueueJob(raw: unknown, dependencies: StorageDeletionQueueDependencies = {}): Promise<Result> {
  const job = storageDeletionQueueJobSchema.parse(raw);
  if (job.kind === 'wake') return fanoutStorageDeletion(dependencies);
  const result = await drainStorageDeletionJobs(STORAGE_DELETION_LANE_BATCH_SIZE, dependencies);
  if (result.pending > 0) throw new Error(`${result.pending} storage deletion jobs remain pending in lane ${job.lane}.`);
  return result;
}

export async function startStorageDeletion(dependencies: StorageDeletionQueueDependencies = {}) {
  const targetQueue = dependencies.queue ?? getQueue();
  await targetQueue.upsertJobScheduler(STORAGE_DELETION_SCHEDULER_ID, STORAGE_DELETION_REPEAT, { name: 'wake', data: wakeSchema.parse({ schemaVersion: 1, kind: 'wake' }), opts: storageDeletionJobOptions });
  await fanoutStorageDeletion({ ...dependencies, queue: targetQueue });
  const worker = dependencies.workerFactory
    ? dependencies.workerFactory((data) => processStorageDeletionQueueJob(data, dependencies))
    : new Worker<StorageDeletionQueueJob, Result>(STORAGE_DELETION_QUEUE_NAME, (job) => processStorageDeletionQueueJob(job.data, dependencies), { connection: connection(), concurrency: STORAGE_DELETION_LANES });
  worker.on('error', (error: Error) => console.error('storage deletion worker error', { error }));
  return { close: () => worker.close() };
}

export async function closeStorageDeletionQueue() {
  await queue?.close();
  queue = undefined;
}
