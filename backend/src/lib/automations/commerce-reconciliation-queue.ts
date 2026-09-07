import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { commerceService, type CommerceService } from '@/lib/commerce/service';
import { createPolarProvider, type PolarReconciliationProvider } from '@/lib/commerce/polar';
import { createRedisConnection } from '@/lib/redis';
import { commerceReconciliationWindowSchema, reconcileCommerceDay, type CommerceReconciliationWindow } from './commerce-reconciliation';
import { getDefaultCommerceReconciliationRepository, type CommerceReconciliationRepository } from './commerce-reconciliation-repository';

export const COMMERCE_RECONCILIATION_QUEUE_NAME = 'nightly-commerce-reconciliation';
export const COMMERCE_RECONCILIATION_SCHEDULER_ID = 'nightly-commerce-reconciliation-wakeup-v1';
export const COMMERCE_RECONCILIATION_REPEAT = { pattern: '0 0 * * *', tz: 'UTC' } as const;
export const commerceReconciliationJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 } };

export const commerceReconciliationWakeJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wake') }).strict();
export const commerceReconciliationDayJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('reconcile-day'), window: commerceReconciliationWindowSchema }).strict();
export const commerceReconciliationJobSchema = z.discriminatedUnion('kind', [commerceReconciliationWakeJobSchema, commerceReconciliationDayJobSchema]);
type ReconciliationJob = z.infer<typeof commerceReconciliationJobSchema>;
type ReconciliationResult = { enqueued: number } | { orders: number; appliedOrders: number; refunds: number; subscriptions: number };
type QueueAccess = Pick<Queue<ReconciliationJob, ReconciliationResult>, 'add' | 'getJob' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };

export interface CommerceReconciliationDependencies {
  repository?: CommerceReconciliationRepository;
  provider?: PolarReconciliationProvider;
  service?: Pick<CommerceService, 'applyPaidOrderFacts' | 'applyRefundFacts' | 'applySubscriptionFacts'>;
  now?: () => Date;
  queue?: QueueAccess;
  workerFactory?: (processor: (data: unknown) => Promise<ReconciliationResult>) => WorkerHandle;
}

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ReconciliationJob, ReconciliationResult> | undefined;
const getQueue = () => {
  if (queue) return queue;
  queue = new Queue<ReconciliationJob, ReconciliationResult>(COMMERCE_RECONCILIATION_QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('commerce reconciliation queue error', { error }));
  return queue;
};

export const commerceReconciliationDayJobId = (window: CommerceReconciliationWindow) => createHash('sha256').update(`commerce-reconcile-day\0${commerceReconciliationWindowSchema.parse(window).start}`).digest('hex');

export async function enqueueCommerceReconciliationDay(rawWindow: unknown, targetQueue: QueueAccess = getQueue()) {
  const window = commerceReconciliationWindowSchema.parse(rawWindow);
  const data = commerceReconciliationDayJobSchema.parse({ schemaVersion: 1, kind: 'reconcile-day', window });
  const jobId = commerceReconciliationDayJobId(window);
  const existing = await targetQueue.getJob(jobId);
  if (existing && await existing.getState() === 'failed') await existing.remove();
  const job = await targetQueue.add('reconcile-day', data, { ...commerceReconciliationJobOptions, jobId });
  return { jobId: job.id! };
}

export async function recoverCommerceReconciliation(dependencies: CommerceReconciliationDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultCommerceReconciliationRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const window = await repository.prepareLatestMissingDay((dependencies.now ?? (() => new Date()))());
  if (!window) return { enqueued: 0 };
  await enqueueCommerceReconciliationDay(window, targetQueue);
  return { enqueued: 1 };
}

export async function processCommerceReconciliationJob(raw: unknown, dependencies: CommerceReconciliationDependencies = {}): Promise<ReconciliationResult> {
  const job = commerceReconciliationJobSchema.parse(raw);
  if (job.kind === 'wake') return recoverCommerceReconciliation(dependencies);
  const repository = dependencies.repository ?? getDefaultCommerceReconciliationRepository();
  const now = dependencies.now ?? (() => new Date());
  await repository.ensurePending(job.window, now().toISOString());
  const result = await reconcileCommerceDay(job.window, { provider: dependencies.provider ?? createPolarProvider(), service: dependencies.service ?? commerceService, now });
  await repository.complete(job.window, now().toISOString());
  return result;
}

function hasPolarConfiguration() {
  return (process.env.POLAR_ENV === 'sandbox' || process.env.POLAR_ENV === 'production') && Boolean(process.env.POLAR_ACCESS_TOKEN?.trim());
}

export async function startCommerceReconciliation(dependencies: CommerceReconciliationDependencies = {}) {
  if (Object.keys(dependencies).length === 0 && !hasPolarConfiguration()) return { async close() {} };
  const targetQueue = dependencies.queue ?? getQueue();
  await targetQueue.upsertJobScheduler(COMMERCE_RECONCILIATION_SCHEDULER_ID, COMMERCE_RECONCILIATION_REPEAT, { name: 'wake', data: commerceReconciliationWakeJobSchema.parse({ schemaVersion: 1, kind: 'wake' }), opts: commerceReconciliationJobOptions });
  await recoverCommerceReconciliation({ ...dependencies, queue: targetQueue });
  const worker = dependencies.workerFactory
    ? dependencies.workerFactory((data) => processCommerceReconciliationJob(data, dependencies))
    : new Worker<ReconciliationJob, ReconciliationResult>(COMMERCE_RECONCILIATION_QUEUE_NAME, (job) => processCommerceReconciliationJob(job.data, dependencies), { connection: connection(), concurrency: 1 });
  worker.on('error', (error: Error) => console.error('commerce reconciliation worker error', { error }));
  return { close: () => worker.close() };
}

export async function closeCommerceReconciliationQueue() {
  await queue?.close();
  queue = undefined;
}
