import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { appNotificationRepository, type AppNotificationRepository } from './repository';
import { decryptPushToken } from './token-crypto';
import { getExpoPushReceipts, sendExpoPush } from './expo-provider';
import { getActivePresenceUserKeys } from '@/lib/presence/session-state';

const QUEUE_NAME = 'app-push-notifications';
const jobSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('send'), notificationKey: z.string().min(1), check: z.number().int().min(1).max(3) }).strict(),
  z.object({ kind: z.literal('receipts'), notificationKey: z.string().min(1), check: z.number().int().min(1).max(3) }).strict(),
]);
type Job = z.infer<typeof jobSchema>;
type ProcessorDependencies = {
  sendPush?: typeof sendExpoPush;
  getReceipts?: typeof getExpoPushReceipts;
  schedule?: (name: Job['kind'], data: Job, options: JobsOptions) => Promise<unknown>;
};
const options: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: { age: 86_400, count: 25_000 }, removeOnFail: { age: 604_800, count: 25_000 } };
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<Job> | undefined;
const getQueue = () => queue ??= new Queue<Job>(QUEUE_NAME, { connection: connection() });

export async function enqueueAppNotification(notificationKey: string) {
  const target = getQueue();
  const id = `send-${notificationKey}`;
  const existing = await target.getJob(id);
  if (existing && await existing.getState() === 'failed') await existing.remove();
  await target.add('send', { kind: 'send', notificationKey, check: 1 }, { ...options, jobId: id });
}

export async function processAppNotificationJob(raw: unknown, repository: AppNotificationRepository = appNotificationRepository, activeUsers: typeof getActivePresenceUserKeys = getActivePresenceUserKeys, dependencies: ProcessorDependencies = {}) {
  const job = jobSchema.parse(raw);
  const schedule = dependencies.schedule ?? ((name, data, jobOptions) => getQueue().add(name, data, jobOptions));
  if (job.kind === 'send') {
    const allPending = await repository.pendingDeliveries(job.notificationKey);
    const activeUserKeys = await activeUsers(allPending.map(({ userKey }) => userKey));
    const suppressed = allPending.filter(({ userKey }) => activeUserKeys.has(userKey));
    await repository.suppressDeliveries(suppressed.map(({ key }) => key));
    const pending = allPending.filter(({ userKey }) => !activeUserKeys.has(userKey));
    const byProject = new Map<string, typeof pending>();
    for (const delivery of pending) byProject.set(delivery.projectId, [...(byProject.get(delivery.projectId) ?? []), delivery]);
    for (const deliveries of byProject.values()) for (let index = 0; index < deliveries.length; index += 100) {
      const group = deliveries.slice(index, index + 100);
      const tickets = await (dependencies.sendPush ?? sendExpoPush)(group.map((item) => ({ to: decryptPushToken(item.tokenCiphertext), title: item.title, body: item.message, data: { v: '2', target: 'signal-inbox', notificationKey: item.notificationKey, signalThreadKey: item.signalThreadKey, signalMessageKey: item.signalMessageKey } })));
      await repository.recordTickets(tickets.map((ticket, ticketIndex) => {
        const error = ticket.status === 'error' ? ticket.details?.error ?? ticket.message ?? 'Expo ticket error' : undefined;
        const retry = error === 'MessageRateExceeded' && job.check < 3;
        return { key: group[ticketIndex]!.key, status: ticket.status === 'ok' && ticket.id ? 'receipt_pending' as const : retry ? 'queued' as const : 'failed' as const, ...(ticket.id ? { receiptId: ticket.id } : {}), ...(error ? { error } : {}), deviceNotRegistered: error === 'DeviceNotRegistered' };
      }));
    }
    if (job.check < 3 && (await repository.pendingDeliveries(job.notificationKey)).length) await schedule('send', { kind: 'send', notificationKey: job.notificationKey, check: job.check + 1 }, { ...options, delay: 2 ** job.check * 1_000, jobId: `send-${job.notificationKey}-${job.check + 1}` });
    if (pending.length) await schedule('receipts', { kind: 'receipts', notificationKey: job.notificationKey, check: 1 }, { ...options, delay: 15 * 60_000, jobId: `receipts-${job.notificationKey}-1` });
    return { processed: pending.length, suppressed: suppressed.length };
  }
  const pending = await repository.pendingReceipts(job.notificationKey);
  for (let index = 0; index < pending.length; index += 300) {
    const group = pending.slice(index, index + 300);
    const receipts = await (dependencies.getReceipts ?? getExpoPushReceipts)(group.map(({ receiptId }) => receiptId));
    await repository.recordReceipts(group.flatMap((item) => {
      const receipt = receipts[item.receiptId];
      if (!receipt) return [];
      const error = receipt.details?.error ?? receipt.message;
      return [{ key: item.key, status: receipt.status === 'ok' ? 'accepted' as const : 'failed' as const, ...(error ? { error } : {}), deviceNotRegistered: error === 'DeviceNotRegistered' }];
    }));
  }
  const unresolved = await repository.pendingReceipts(job.notificationKey);
  if (unresolved.length && job.check < 3) await schedule('receipts', { kind: 'receipts', notificationKey: job.notificationKey, check: job.check + 1 }, { ...options, delay: 15 * 60_000, jobId: `receipts-${job.notificationKey}-${job.check + 1}` });
  return { processed: pending.length };
}

export function startAppNotificationWorker() {
  const worker = new Worker<Job>(QUEUE_NAME, (job) => processAppNotificationJob(job.data), { connection: connection(), concurrency: 6, limiter: { max: 600, duration: 1_000 } });
  worker.on('error', (error) => console.error('app notification worker error', { error }));
  return { close: () => worker.close() };
}

export async function recoverAppNotificationQueue() {
  const keys = await appNotificationRepository.recoverableNotificationKeys();
  await Promise.all(keys.map((key) => enqueueAppNotification(key)));
  return { recovered: keys.length };
}

export async function closeAppNotificationQueue() { await queue?.close(); queue = undefined; }
