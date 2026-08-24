import { createHash } from 'node:crypto';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { createConnectorRepository } from './connector-repository';
import { createSystemEmailService } from './service';
import { GmailApiError, isRetryableGmailError } from './gmail';

const SYNC_QUEUE_NAME = 'email-incremental-sync';
const RENEWAL_QUEUE_NAME = 'email-watch-renewal';
const jobOptions: JobsOptions = {
  attempts: 12,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 50_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 50_000 },
};
export const emailRepairJobOptions: JobsOptions = { ...jobOptions, delay: 5_000, removeOnComplete: true };
const clearTrashJobOptions: JobsOptions = { ...emailRepairJobOptions, removeOnComplete: { age: 24 * 60 * 60, count: 50_000 } };
const watchRenewalJobOptions: JobsOptions = { ...jobOptions, removeOnComplete: true };

const notificationJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('notification'), emailAddress: z.string().email(), historyId: z.string().regex(/^\d+$/),
  messageId: z.string().min(1).max(500), subscription: z.string().min(1).max(1000), publishTime: z.string().datetime().optional(),
}).strict();
const renewalJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('renew-watches'), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();
const pollingJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('poll-connectors'), bucket: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }).strict();
const connectorSyncJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('connector-sync'), organizationKey: z.string().min(1).max(160), scopeKey: z.string().min(1).max(160), connectorKey: z.string().min(1).max(160), sourceKey: z.string().regex(/^[a-f0-9]{64}$/), requestedAt: z.string().datetime(),
}).strict();
const connectorWatchJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('connector-watch-renewal'), organizationKey: z.string().min(1).max(160), scopeKey: z.string().min(1).max(160), connectorKey: z.string().min(1).max(160), sourceKey: z.string().regex(/^[a-f0-9]{64}$/), requestedAt: z.string().datetime(),
}).strict();
const repairThreadKeys = z.array(z.string().cuid()).min(1).max(50).refine((keys) => new Set(keys).size === keys.length, 'thread keys must be distinct');
const connectorOperationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('favorite'), threadKeys: repairThreadKeys, isFavorite: z.boolean() }).strict(),
  z.object({ kind: z.literal('read-state'), threadKeys: repairThreadKeys, isRead: z.boolean() }).strict(),
  z.object({ kind: z.literal('trash'), threadKeys: repairThreadKeys }).strict(),
]);
const connectorJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('connector-reconciliation'), organizationKey: z.string().min(1).max(160), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(), reason: z.enum(['favorite', 'read-state', 'trash', 'send']), operationKey: z.string().uuid(), requestedAt: z.string().datetime(),
  operation: connectorOperationSchema.optional(), sendDraftKey: z.string().cuid().optional(),
}).strict();
const clearTrashJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('clear-trash-continuation'), organizationKey: z.string().min(1).max(160), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(), operationKey: z.string().uuid(), requestedAt: z.string().datetime(),
  trashSnapshotAt: z.string().datetime(),
  messages: z.array(z.object({ id: z.string().min(1).max(500), threadId: z.string().min(1).max(500) }).strict()).max(100_000),
}).strict();
const watchJobSchema = z.object({
  schemaVersion: z.literal(1), kind: z.literal('watch-reconciliation'), organizationKey: z.string().min(1).max(160), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(), operationKey: z.string().uuid(), requestedAt: z.string().datetime(),
}).strict();
export const emailSyncJobSchema = z.discriminatedUnion('kind', [notificationJobSchema, renewalJobSchema, pollingJobSchema, connectorSyncJobSchema, connectorWatchJobSchema, connectorJobSchema, clearTrashJobSchema, watchJobSchema]).superRefine((value, context) => {
  if (value.kind !== 'connector-reconciliation') return;
  if ((value.reason === 'send') === Boolean(value.operation)) context.addIssue({ code: 'custom', message: 'send repair must omit operation; thread repair must include operation', path: ['operation'] });
  if ((value.reason === 'send') !== Boolean(value.sendDraftKey)) context.addIssue({ code: 'custom', message: 'send repair must identify exactly one draft', path: ['sendDraftKey'] });
  if (value.operation && value.operation.kind !== value.reason) context.addIssue({ code: 'custom', message: 'repair reason and operation must match', path: ['operation', 'kind'] });
});
export type EmailSyncJob = z.infer<typeof emailSyncJobSchema>;
type EmailSyncResult = { synchronized: number } | { renewed: number } | { cleared: number };

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
export const emailRepairJobId = (input: { connectorKey: string; reason: string; operationKey: string }) => stableId('connector-reconciliation', input.connectorKey, input.reason, input.operationKey);
export const emailClearTrashJobId = (input: { connectorKey: string; operationKey: string }) => stableId('clear-trash-continuation', input.connectorKey, input.operationKey);
export const emailWatchRepairJobId = (input: { connectorKey: string; operationKey: string }) => stableId('watch-reconciliation', input.connectorKey, input.operationKey);
export const emailWatchRenewalJobId = (day: string) => stableId('renew-watches', day);
export const emailPollingJobId = (bucket: string) => stableId('poll-connectors', bucket);
type QueueAccess = Pick<Queue<EmailSyncJob, EmailSyncResult>, 'add' | 'getJob'>;
type ChildQueueAccess = Pick<Queue<EmailSyncJob, EmailSyncResult>, 'add'>;

async function enqueueConnectorChildren(input: {
  kind: 'connector-sync' | 'connector-watch-renewal';
  sourceKey: string;
  targets: Array<{ organizationKey: string; scopeKey: string; connectorKey: string }>;
  queue: ChildQueueAccess;
}) {
  let failures = 0;
  for (const target of input.targets) {
    const child = emailSyncJobSchema.parse({ schemaVersion: 1, kind: input.kind, ...target, sourceKey: input.sourceKey, requestedAt: new Date().toISOString() });
    try {
      await input.queue.add(input.kind, child, { ...jobOptions, jobId: stableId(input.kind, input.sourceKey, target.organizationKey, target.scopeKey, target.connectorKey) });
    } catch { failures += 1; }
  }
  if (failures) throw new Error(`Email connector job scheduling failed for ${failures} account(s)`);
}

export async function enqueueEmailSyncNotification(input: Omit<z.input<typeof notificationJobSchema>, 'schemaVersion' | 'kind'>) {
  const job = notificationJobSchema.parse({ schemaVersion: 1, kind: 'notification', ...input, emailAddress: input.emailAddress.toLowerCase() });
  const queued = await getQueue(SYNC_QUEUE_NAME).add('notification', job, { ...jobOptions, jobId: stableId(job.subscription, job.messageId) });
  return { jobId: queued.id! };
}

export async function enqueueEmailWatchRenewal(now = new Date(), targetQueue: QueueAccess = getQueue(RENEWAL_QUEUE_NAME)) {
  const day = now.toISOString().slice(0, 10);
  const job = renewalJobSchema.parse({ schemaVersion: 1, kind: 'renew-watches', day });
  const queued = await targetQueue.add('renew-watches', job, { ...watchRenewalJobOptions, jobId: emailWatchRenewalJobId(day) });
  return { jobId: queued.id! };
}

export async function enqueueEmailConnectorPolling(now = new Date(), targetQueue: QueueAccess = getQueue(SYNC_QUEUE_NAME)) {
  const bucket = now.toISOString().slice(0, 16);
  const job = pollingJobSchema.parse({ schemaVersion: 1, kind: 'poll-connectors', bucket });
  const queued = await targetQueue.add('poll-connectors', job, { ...watchRenewalJobOptions, jobId: emailPollingJobId(bucket) });
  return { jobId: queued.id! };
}

export async function enqueueEmailConnectorReconciliation(input: Omit<z.input<typeof connectorJobSchema>, 'schemaVersion' | 'kind' | 'requestedAt'>, targetQueue: QueueAccess = getQueue(SYNC_QUEUE_NAME)) {
  const job = connectorJobSchema.parse({ schemaVersion: 1, kind: 'connector-reconciliation', ...input, requestedAt: new Date().toISOString() });
  const queued = await targetQueue.add('connector-reconciliation', job, { ...emailRepairJobOptions, jobId: emailRepairJobId(job) });
  return { jobId: queued.id! };
}

export async function enqueueEmailClearTrashContinuation(input: Omit<z.input<typeof clearTrashJobSchema>, 'schemaVersion' | 'kind' | 'requestedAt'>, targetQueue: QueueAccess = getQueue(SYNC_QUEUE_NAME)) {
  const job = clearTrashJobSchema.parse({ schemaVersion: 1, kind: 'clear-trash-continuation', ...input, requestedAt: new Date().toISOString() });
  const queued = await targetQueue.add('clear-trash-continuation', job, { ...clearTrashJobOptions, jobId: emailClearTrashJobId(job) });
  const durable = clearTrashJobSchema.parse(queued.data);
  return { jobId: queued.id!, messages: durable.messages, trashSnapshotAt: durable.trashSnapshotAt };
}

export async function enqueueEmailWatchReconciliation(input: Omit<z.input<typeof watchJobSchema>, 'schemaVersion' | 'kind' | 'requestedAt'>, targetQueue: QueueAccess = getQueue(RENEWAL_QUEUE_NAME)) {
  const job = watchJobSchema.parse({ schemaVersion: 1, kind: 'watch-reconciliation', ...input, requestedAt: new Date().toISOString() });
  const queued = await targetQueue.add('watch-reconciliation', job, { ...emailRepairJobOptions, jobId: emailWatchRepairJobId(job) });
  return { jobId: queued.id! };
}

async function completeIntent(jobId: string, targetQueue: QueueAccess) {
  const job = await targetQueue.getJob(jobId) as Pick<Job, 'getState' | 'remove'> | undefined;
  if (!job) return true;
  if (await job.getState() === 'active') return false;
  await job.remove();
  return true;
}

export async function completeEmailConnectorReconciliation(jobId: string, targetQueue: QueueAccess = getQueue(SYNC_QUEUE_NAME)) {
  return completeIntent(jobId, targetQueue);
}
export const completeEmailClearTrashContinuation = completeEmailConnectorReconciliation;
export async function completeEmailWatchReconciliation(jobId: string, targetQueue: QueueAccess = getQueue(RENEWAL_QUEUE_NAME)) {
  return completeIntent(jobId, targetQueue);
}

export async function processEmailSyncJob(raw: unknown, dependencies: {
  connectors?: ReturnType<typeof createConnectorRepository>;
  service?: ReturnType<typeof createSystemEmailService>;
  queue?: ChildQueueAccess;
} = {}): Promise<EmailSyncResult> {
  const job = emailSyncJobSchema.parse(raw);
  const connectors = dependencies.connectors ?? createConnectorRepository();
  const service = dependencies.service ?? createSystemEmailService({ connectors });
  if (job.kind === 'notification') {
    const targets = await connectors.listSyncTargetsByEmail(job.emailAddress);
    await enqueueConnectorChildren({ kind: 'connector-sync', sourceKey: stableId(job.subscription, job.messageId), targets, queue: dependencies.queue ?? getQueue(SYNC_QUEUE_NAME) });
    return { synchronized: targets.length };
  }
  if (job.kind === 'poll-connectors') {
    const targets = await connectors.listPollingTargets();
    await enqueueConnectorChildren({ kind: 'connector-sync', sourceKey: stableId('poll-connectors', job.bucket), targets, queue: dependencies.queue ?? getQueue(SYNC_QUEUE_NAME) });
    return { synchronized: targets.length };
  }
  if (job.kind === 'connector-sync') {
    const result = await service.sync({ userKey: 'system', organizationKey: job.organizationKey, scopeKey: job.scopeKey }, job.connectorKey);
    if (result.busy) throw new Error('Email connector synchronization is busy');
    return { synchronized: 1 };
  }
  if (job.kind === 'connector-watch-renewal') {
    try { await service.subscribe({ userKey: 'system', organizationKey: job.organizationKey, scopeKey: job.scopeKey }, job.connectorKey, undefined, true); }
    catch (error) {
      if (error instanceof GmailApiError && !isRetryableGmailError(error)) return { renewed: 0 };
      throw error;
    }
    return { renewed: 1 };
  }
  if (job.kind === 'connector-reconciliation') {
    const actor = { userKey: 'system', organizationKey: job.organizationKey, scopeKey: job.scopeKey };
    if (job.reason === 'send') {
      const result = await service.reconcileSends(actor, job.connectorKey, job.sendDraftKey!);
      if (result.busy || result.pending) throw new Error('Email send reconciliation remains incomplete');
      return { synchronized: result.recovered };
    }
    if (job.operation) {
      const result = job.operation.kind === 'favorite'
        ? await service.setFavorite(actor, { threadKeys: job.operation.threadKeys, isFavorite: job.operation.isFavorite }, true)
        : job.operation.kind === 'read-state'
          ? await service.setReadState(actor, { threadKeys: job.operation.threadKeys, isRead: job.operation.isRead }, true)
          : await service.trashThread(actor, { threadKeys: job.operation.threadKeys }, true);
      if (result.repairPending) throw new Error('Gmail thread reconciliation remains incomplete');
      return { synchronized: result.succeeded };
    }
    const result = await service.sync(actor, job.connectorKey);
    if (result.busy) throw new Error('Gmail connector reconciliation is busy');
    return { synchronized: 1 };
  }
  if (job.kind === 'clear-trash-continuation') {
    const result = await service.clearTrash({ userKey: 'system', organizationKey: job.organizationKey, scopeKey: job.scopeKey }, { connectorKey: job.connectorKey }, true, job.messages, undefined, job.trashSnapshotAt);
    return { cleared: result.providerMessagesDeleted };
  }
  if (job.kind === 'watch-reconciliation') {
    try { await service.subscribe({ userKey: 'system', organizationKey: job.organizationKey, scopeKey: job.scopeKey }, job.connectorKey, undefined, true); }
    catch (error) {
      if (error instanceof GmailApiError && !isRetryableGmailError(error)) return { renewed: 0 };
      throw error;
    }
    return { renewed: 1 };
  }
  const before = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
  const targets = await connectors.listWatchRenewalTargets(before);
  await enqueueConnectorChildren({ kind: 'connector-watch-renewal', sourceKey: stableId('renew-watches', job.day), targets, queue: dependencies.queue ?? getQueue(RENEWAL_QUEUE_NAME) });
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
