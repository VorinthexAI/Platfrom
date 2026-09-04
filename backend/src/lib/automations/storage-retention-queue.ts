import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { getDefaultStorageRetentionRepository, STORAGE_RETENTION_SCAN_BATCH_SIZE, type StorageRetentionRepository, type StorageRetentionState } from './storage-retention-repository';

export const STORAGE_RETENTION_QUEUE_NAME = 'daily-storage-retention';
export const STORAGE_RETENTION_SCHEDULER_ID = 'daily-storage-retention-wakeup-v1';
export const STORAGE_RETENTION_REPEAT = { pattern: '0 0 * * *', tz: 'UTC' } as const;
export const storageRetentionJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: { age: 90 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 90 * 24 * 60 * 60, count: 10_000 } };

const wakeSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wake') }).strict();
const wipeSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wipe-user'), userKey: z.string().min(1).max(160), expectedWipeDueAt: z.string().datetime(), batch: z.number().int().nonnegative() }).strict();
export const storageRetentionJobSchema = z.discriminatedUnion('kind', [wakeSchema, wipeSchema]);
export type StorageRetentionJob = z.infer<typeof storageRetentionJobSchema>;
type Result = { scanned: number; funded: number; enqueued: number } | { status: 'stale' } | { status: 'continued'; nextBatch: number; processed: number } | { status: 'wiped'; processed: number };
type QueueAccess = Pick<Queue<StorageRetentionJob, Result>, 'add' | 'getJob' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };
export interface StorageRetentionDependencies {
  repository?: StorageRetentionRepository;
  now?: () => Date;
  queue?: QueueAccess;
  workerFactory?: (processor: (data: unknown) => Promise<Result>) => WorkerHandle;
}

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<StorageRetentionJob, Result> | undefined;
const getQueue = () => {
  if (queue) return queue;
  queue = new Queue(STORAGE_RETENTION_QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('storage retention queue error', { error }));
  return queue;
};

export const storageWipeJobId = (userKey: string, expectedWipeDueAt: string, batch: number) => createHash('sha256').update(`storage-wipe\0${userKey}\0${expectedWipeDueAt}\0${z.number().int().nonnegative().parse(batch)}`).digest('hex');

export function storageRetentionAction(state: StorageRetentionState & { balanceMicroSparks: number }, now: Date): 'fund' | 'wipe' | 'wait' {
  if (!Number.isFinite(now.getTime())) throw new TypeError('A valid retention scan time is required.');
  if (state.wipeStartedAt && !state.wipedAt) return 'wipe';
  if (state.wipeStartedAt || state.wipedAt) return 'wait';
  if (state.balanceMicroSparks >= state.minimumBalanceMicroSparks) return 'fund';
  if (Date.parse(state.wipeDueAt) <= now.getTime()) return 'wipe';
  return 'wait';
}

export async function enqueueStorageWipe(userKey: string, expectedWipeDueAt: string, batch: number, targetQueue: QueueAccess = getQueue()) {
  const data = wipeSchema.parse({ schemaVersion: 1, kind: 'wipe-user', userKey, expectedWipeDueAt, batch });
  const jobId = storageWipeJobId(data.userKey, data.expectedWipeDueAt, data.batch);
  const existing = await targetQueue.getJob(jobId);
  if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  await targetQueue.add('wipe-user', data, { ...storageRetentionJobOptions, jobId });
  return { jobId };
}

export async function scanStorageRetention(dependencies: StorageRetentionDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultStorageRetentionRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  let scanned = 0, funded = 0, enqueued = 0;
  let afterKey: string | undefined;
  while (true) {
    const states = await repository.listUnfunded({ afterKey, limit: STORAGE_RETENTION_SCAN_BATCH_SIZE });
    scanned += states.length;
    let failure: unknown;
    for (const state of states) {
      try {
        const action = storageRetentionAction(state, new Date(now));
        if (action === 'fund') {
          if (await repository.markFunded(state.userKey, now)) funded += 1;
        } else if (action === 'wipe') {
          await enqueueStorageWipe(state.userKey, state.wipeDueAt, state.wipeBatch ?? 0, targetQueue);
          enqueued += 1;
        }
      } catch (error) { failure ??= error; }
    }
    if (failure) throw failure;
    if (states.length < STORAGE_RETENTION_SCAN_BATCH_SIZE) break;
    const nextAfterKey = states.at(-1)!.key;
    if (nextAfterKey === afterKey) throw new Error('Storage retention scan did not advance.');
    afterKey = nextAfterKey;
  }
  return { scanned, funded, enqueued };
}

export async function processStorageRetentionJob(raw: unknown, dependencies: StorageRetentionDependencies = {}): Promise<Result> {
  const job = storageRetentionJobSchema.parse(raw);
  if (job.kind === 'wake') return scanStorageRetention(dependencies);
  const repository = dependencies.repository ?? getDefaultStorageRetentionRepository();
  const result = await repository.wipe({ userKey: job.userKey, expectedWipeDueAt: job.expectedWipeDueAt, batch: job.batch, now: (dependencies.now ?? (() => new Date()))().toISOString() });
  if (result.status === 'continued') await enqueueStorageWipe(job.userKey, job.expectedWipeDueAt, result.nextBatch, dependencies.queue ?? getQueue());
  return result;
}

export async function startStorageRetention(dependencies: StorageRetentionDependencies = {}) {
  const targetQueue = dependencies.queue ?? getQueue();
  await targetQueue.upsertJobScheduler(STORAGE_RETENTION_SCHEDULER_ID, STORAGE_RETENTION_REPEAT, { name: 'wake', data: wakeSchema.parse({ schemaVersion: 1, kind: 'wake' }), opts: storageRetentionJobOptions });
  await scanStorageRetention({ ...dependencies, queue: targetQueue });
  const worker = dependencies.workerFactory
    ? dependencies.workerFactory((data) => processStorageRetentionJob(data, dependencies))
    : new Worker<StorageRetentionJob, Result>(STORAGE_RETENTION_QUEUE_NAME, (job) => processStorageRetentionJob(job.data, dependencies), { connection: connection(), concurrency: 1 });
  worker.on('error', (error: Error) => console.error('storage retention worker error', { error }));
  return { close: () => worker.close() };
}

export async function closeStorageRetentionQueue() {
  await queue?.close();
  queue = undefined;
}
