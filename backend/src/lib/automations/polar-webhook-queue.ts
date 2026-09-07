import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { commerceService, polarWebhookEventSchema, type CommerceService } from '@/lib/commerce/service';
import { updateProcessedWebhookEventByProviderAndEventId } from '@/lib/db/processed-webhook-events.node';
import { createRedisConnection } from '@/lib/redis';

export const POLAR_WEBHOOK_QUEUE_NAME = 'polar-webhook-processing';
export const POLAR_WEBHOOK_RECOVERY_SCHEDULER_ID = 'polar-webhook-failed-recovery-v1';
export const POLAR_WEBHOOK_RECOVERY_REPEAT = { pattern: '*/5 * * * *', tz: 'UTC' } as const;
export const polarWebhookJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 } };
export const polarWebhookProcessJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('process'), webhookId: z.string().trim().min(1).max(200), event: polarWebhookEventSchema }).strict();
export const polarWebhookRecoveryJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('recover-failed') }).strict();
export const polarWebhookJobSchema = z.discriminatedUnion('kind', [polarWebhookProcessJobSchema, polarWebhookRecoveryJobSchema]);
type PolarWebhookJob = z.infer<typeof polarWebhookJobSchema>;
type PolarWebhookResult = void | { requeued: number };
type EnqueueQueueAccess = Pick<Queue<PolarWebhookJob, PolarWebhookResult>, 'add' | 'getJob'>;
type QueueAccess = Pick<Queue<PolarWebhookJob, PolarWebhookResult>, 'add' | 'getJob' | 'getJobs' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };
export type PolarWebhookEnqueuer = (webhookId: string, event: z.infer<typeof polarWebhookEventSchema>) => Promise<unknown>;

export interface PolarWebhookWorkerDependencies {
  service?: Pick<CommerceService, 'processWebhook'>;
  complete?: typeof updateProcessedWebhookEventByProviderAndEventId;
  queue?: QueueAccess;
  workerFactory?: (processor: (data: unknown) => Promise<PolarWebhookResult>) => WorkerHandle;
  now?: () => Date;
}

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<PolarWebhookJob, PolarWebhookResult> | undefined;
const getQueue = () => {
  if (queue) return queue;
  queue = new Queue<PolarWebhookJob, PolarWebhookResult>(POLAR_WEBHOOK_QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('polar webhook queue error', { error }));
  return queue;
};

export const polarWebhookJobId = (webhookId: string) => createHash('sha256').update(`polar-webhook\0${webhookId}`).digest('hex');

export async function enqueuePolarWebhook(webhookId: string, rawEvent: unknown, targetQueue: EnqueueQueueAccess = getQueue()) {
  const data = polarWebhookProcessJobSchema.parse({ schemaVersion: 1, kind: 'process', webhookId, event: rawEvent });
  const jobId = polarWebhookJobId(data.webhookId);
  const existing = await targetQueue.getJob(jobId);
  if (existing && await existing.getState() === 'failed') {
    await existing.retry('failed');
    return { jobId: existing.id! };
  }
  const job = await targetQueue.add('process', data, { ...polarWebhookJobOptions, jobId });
  return { jobId: job.id! };
}

export async function recoverFailedPolarWebhooks(targetQueue: QueueAccess = getQueue()) {
  const failed = await targetQueue.getJobs(['failed'], 0, 99);
  let requeued = 0;
  for (const job of failed) {
    const parsed = polarWebhookProcessJobSchema.safeParse(job.data);
    if (!parsed.success) continue;
    await job.retry('failed');
    requeued += 1;
  }
  return { requeued };
}

export async function processPolarWebhookJob(raw: unknown, dependencies: PolarWebhookWorkerDependencies = {}) {
  const job = polarWebhookJobSchema.parse(raw);
  if (job.kind === 'recover-failed') return recoverFailedPolarWebhooks(dependencies.queue ?? getQueue());
  await (dependencies.service ?? commerceService).processWebhook(job.event);
  await (dependencies.complete ?? updateProcessedWebhookEventByProviderAndEventId)('polar', job.webhookId, { status: 'processed', processedAt: (dependencies.now ?? (() => new Date()))().toISOString() });
}

export async function startPolarWebhookWorker(dependencies: PolarWebhookWorkerDependencies = {}) {
  if (Object.keys(dependencies).length === 0 && !process.env.POLAR_WEBHOOK_SECRET?.trim()) return { async close() {} };
  const targetQueue = dependencies.queue ?? getQueue();
  await targetQueue.upsertJobScheduler(POLAR_WEBHOOK_RECOVERY_SCHEDULER_ID, POLAR_WEBHOOK_RECOVERY_REPEAT, { name: 'recover-failed', data: polarWebhookRecoveryJobSchema.parse({ schemaVersion: 1, kind: 'recover-failed' }), opts: polarWebhookJobOptions });
  await recoverFailedPolarWebhooks(targetQueue);
  const worker = dependencies.workerFactory
    ? dependencies.workerFactory((data) => processPolarWebhookJob(data, dependencies))
    : new Worker<PolarWebhookJob, PolarWebhookResult>(POLAR_WEBHOOK_QUEUE_NAME, (job) => processPolarWebhookJob(job.data, dependencies), { connection: connection(), concurrency: 4 });
  worker.on('error', (error: Error) => console.error('polar webhook worker error', { error }));
  return { close: () => worker.close() };
}

export async function closePolarWebhookQueue() {
  await queue?.close();
  queue = undefined;
}
