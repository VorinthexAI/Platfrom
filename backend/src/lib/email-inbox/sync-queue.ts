import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { createConnectorRepository } from './connector-repository';
import { createSystemEmailService } from './service';

const SYNC_QUEUE_NAME = 'email-incremental-sync';
const RENEWAL_QUEUE_NAME = 'email-watch-renewal';
const jobOptions: JobsOptions = {
  attempts: 12,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 50_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 50_000 },
};

const notificationJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('notification'), emailAddress: z.string().email(), historyId: z.string().regex(/^\d+$/),
  messageId: z.string().min(1).max(500), subscription: z.string().min(1).max(1000), publishTime: z.string().datetime().optional(),
}).strict();
const renewalJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('renew-watches'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
export const emailSyncJobSchema = z.discriminatedUnion('kind', [notificationJobSchema, renewalJobSchema]);
export type EmailSyncJob = z.infer<typeof emailSyncJobSchema>;
type EmailSyncResult = { synchronized: number } | { renewed: number };

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
const queues = new Map<string, Queue<EmailSyncJob, EmailSyncResult>>();
const getQueue = (name: string) => {
  const existing = queues.get(name);
  if (existing) return existing;
  const queue = new Queue<EmailSyncJob, EmailSyncResult>(name, { connection: connection() });
  queue.on('error', () => console.error('email queue error', { queue: name }));
  queues.set(name, queue);
  return queue;
};
const stableId = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex');

export async function enqueueEmailSyncNotification(input: Omit<z.input<typeof notificationJobSchema>, 'schemaVersion' | 'kind'>) {
  const job = notificationJobSchema.parse({ schemaVersion: 1, kind: 'notification', ...input, emailAddress: input.emailAddress.toLowerCase() });
  const queued = await getQueue(SYNC_QUEUE_NAME).add('notification', job, { ...jobOptions, jobId: stableId(job.subscription, job.messageId) });
  return { jobId: queued.id! };
}

export async function enqueueEmailWatchRenewal(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const job = renewalJobSchema.parse({ schemaVersion: 1, kind: 'renew-watches', day });
  const queued = await getQueue(RENEWAL_QUEUE_NAME).add('renew-watches', job, { ...jobOptions, jobId: stableId('renew-watches', day) });
  return { jobId: queued.id! };
}

export async function processEmailSyncJob(raw: unknown, dependencies: {
  connectors?: ReturnType<typeof createConnectorRepository>;
  service?: ReturnType<typeof createSystemEmailService>;
} = {}): Promise<EmailSyncResult> {
  const job = emailSyncJobSchema.parse(raw);
  const connectors = dependencies.connectors ?? createConnectorRepository();
  const service = dependencies.service ?? createSystemEmailService({ connectors });
  if (job.kind === 'notification') {
    const targets = await connectors.listSyncTargetsByEmail(job.emailAddress);
    let failures = 0;
    for (const target of targets) {
      try { await service.sync({ userKey: 'system', ...target }); }
      catch { failures += 1; }
    }
    if (failures > 0) throw new Error(`Gmail synchronization failed for ${failures} account(s)`);
    return { synchronized: targets.length };
  }
  const before = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const targets = await connectors.listWatchRenewalTargets(before);
  let failures = 0;
  for (const target of targets) {
    try { await service.renewWatch({ userKey: 'system', ...target }); }
    catch { failures += 1; }
  }
  if (failures > 0) throw new Error(`Gmail watch renewal failed for ${failures} account(s)`);
  return { renewed: targets.length };
}

export function startEmailSyncWorker() {
  const syncWorker = new Worker<EmailSyncJob, EmailSyncResult>(SYNC_QUEUE_NAME, (job) => processEmailSyncJob(job.data), { connection: connection(), concurrency: 4 });
  const renewalWorker = new Worker<EmailSyncJob, EmailSyncResult>(RENEWAL_QUEUE_NAME, (job) => processEmailSyncJob(job.data), { connection: connection(), concurrency: 1 });
  syncWorker.on('error', () => console.error('email synchronization worker error'));
  renewalWorker.on('error', () => console.error('email watch renewal worker error'));
  return { close: async () => { await Promise.all([syncWorker.close(), renewalWorker.close()]); } };
}

export async function closeEmailSyncQueue() {
  await Promise.all([...queues.values()].map((queue) => queue.close()));
  queues.clear();
}
