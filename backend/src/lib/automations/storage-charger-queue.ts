import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { toolEventService } from '@/lib/ai/events/service';
import type { ToolEventRecorder } from '@/lib/ai/events/service';
import { APP_KEYS } from '@/lib/apps/registry';
import { sha256 } from '@/lib/crypto';
import { getUserById } from '@/lib/db/users.node';
import { newId } from '@/lib/ids';
import { sparkService } from '@/lib/sparks/service';
import { getDefaultStorageChargingRepository } from './storage-charger-repository';
import { processStorageChargingHour, storageHourWindowSchema, type StorageChargeService, type StorageHourWindow, type StorageUsageRepository } from './storage-charger';

export const STORAGE_CHARGER_QUEUE_NAME = 'hourly-storage-charging';
export const STORAGE_CHARGER_SCHEDULER_ID = 'hourly-storage-charging-wakeup-v1';
export const STORAGE_CHARGER_REPEAT = { pattern: '0 * * * *', tz: 'UTC' } as const;
export const storageChargerJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 } };

const wakeJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wake') }).strict();
const hourJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('charge-hour'), window: storageHourWindowSchema }).strict();
export const storageChargerJobSchema = z.discriminatedUnion('kind', [wakeJobSchema, hourJobSchema]);
export type StorageChargerJob = z.infer<typeof storageChargerJobSchema>;
type StorageChargerResult = { enqueued: number } | { users: number; chargedUsers: number; chargedMicroSparks: string };

export interface StorageHourRecoverySource { listMissedClosedHours(now: Date): Promise<StorageHourWindow[]> }
type QueueAccess = Pick<Queue<StorageChargerJob, StorageChargerResult>, 'add' | 'getJob' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };
export interface StorageChargerDependencies {
  repository?: StorageUsageRepository & StorageHourRecoverySource;
  chargeService?: StorageChargeService;
  now?: () => Date;
  queue?: QueueAccess;
  workerFactory?: (processor: (data: unknown) => Promise<StorageChargerResult>) => WorkerHandle;
}

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<StorageChargerJob, StorageChargerResult> | undefined;
const getQueue = () => {
  if (queue) return queue;
  queue = new Queue<StorageChargerJob, StorageChargerResult>(STORAGE_CHARGER_QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('storage charger queue error', { error }));
  return queue;
};

export const storageChargerHourJobId = (window: StorageHourWindow) => createHash('sha256').update(`storage-charge-hour\0${storageHourWindowSchema.parse(window).start}`).digest('hex');

export function createStorageChargeService(dependencies: {
  charge?: typeof sparkService.charge;
  getUser?: typeof getUserById;
  record?: ToolEventRecorder;
  hash?: typeof sha256;
  id?: () => string;
} = {}): StorageChargeService {
  return {
    async charge(input) {
      const microSparks = Number(input.amountMicroSparks);
      if (!Number.isSafeInteger(microSparks) || microSparks <= 0) throw new RangeError('Storage charge exceeds the supported microSpark range.');
      const charged = await (dependencies.charge ?? sparkService.charge)(input.userKey, {
        kind: 'storage',
        microSparks,
        idempotencyKey: input.idempotencyKey,
        requestHash: await (dependencies.hash ?? sha256)(JSON.stringify({ userKey: input.userKey, hourStart: input.hourStart, hourEnd: input.hourEnd, microSparks })),
        eventKey: (dependencies.id ?? newId)(),
        metadata: { hourStart: input.hourStart, hourEnd: input.hourEnd },
      });
      if (charged.status === 'conflict') throw new Error(`Storage charge conflicted for ${input.userKey} at ${input.hourStart}.`);
      const user = await (dependencies.getUser ?? getUserById)(input.userKey);
      if (!user) throw new Error(`Storage charge user ${input.userKey} was not found.`);
      const eventKey = charged.transaction.eventKey;
      if (!eventKey) throw new Error('Storage charge did not retain its analytics event key.');
      await (dependencies.record ?? toolEventService.record)({
        userId: user.key,
        scopeKey: user.currentScopeKey,
        slug: 'storage.hourly',
        appKey: APP_KEYS.CORE,
        status: 'completed',
        microSparks,
        sparkTransactionKey: charged.transaction.key,
      }, { key: eventKey });
    },
  };
}

export async function enqueueStorageChargingHour(rawWindow: unknown, targetQueue: QueueAccess = getQueue()) {
  const window = storageHourWindowSchema.parse(rawWindow);
  const data = hourJobSchema.parse({ schemaVersion: 1, kind: 'charge-hour', window });
  const jobId = storageChargerHourJobId(window);
  const existing = await targetQueue.getJob(jobId);
  if (existing && await existing.getState() === 'failed') await existing.remove();
  const job = await targetQueue.add('charge-hour', data, { ...storageChargerJobOptions, jobId });
  return { jobId: job.id! };
}

export async function recoverStorageChargingHours(dependencies: StorageChargerDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultStorageChargingRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const windows = [...new Map((await repository.listMissedClosedHours((dependencies.now ?? (() => new Date()))()))
    .map((window) => storageHourWindowSchema.parse(window))
    .map((window) => [window.start, window])).values()];
  windows.sort((left, right) => left.start.localeCompare(right.start));
  let failure: unknown;
  for (const window of windows) {
    try { await enqueueStorageChargingHour(window, targetQueue); }
    catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
  return { enqueued: windows.length };
}

export async function processStorageChargerJob(raw: unknown, dependencies: StorageChargerDependencies = {}): Promise<StorageChargerResult> {
  const job = storageChargerJobSchema.parse(raw);
  if (job.kind === 'wake') return recoverStorageChargingHours(dependencies);
  const repository = dependencies.repository ?? getDefaultStorageChargingRepository();
  return processStorageChargingHour(job.window, { repository, chargeService: dependencies.chargeService ?? createStorageChargeService(), now: dependencies.now });
}

export async function startStorageCharger(dependencies: StorageChargerDependencies = {}) {
  const targetQueue = dependencies.queue ?? getQueue();
  await targetQueue.upsertJobScheduler(STORAGE_CHARGER_SCHEDULER_ID, STORAGE_CHARGER_REPEAT, { name: 'wake', data: wakeJobSchema.parse({ schemaVersion: 1, kind: 'wake' }), opts: storageChargerJobOptions });
  await recoverStorageChargingHours({ ...dependencies, queue: targetQueue });
  const worker = dependencies.workerFactory
    ? dependencies.workerFactory((data) => processStorageChargerJob(data, dependencies))
    : new Worker<StorageChargerJob, StorageChargerResult>(STORAGE_CHARGER_QUEUE_NAME, (job) => processStorageChargerJob(job.data, dependencies), { connection: connection(), concurrency: 1 });
  worker.on('error', (error: Error) => console.error('storage charger worker error', { error }));
  return { close: () => worker.close() };
}

export async function closeStorageChargerQueue() {
  await queue?.close();
  queue = undefined;
}
