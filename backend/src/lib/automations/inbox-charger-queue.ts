import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { APP_KEYS } from '@/lib/apps/registry';
import { sha256 } from '@/lib/crypto';
import { newId } from '@/lib/ids';
import { sparkService } from '@/lib/sparks/service';
import { getDefaultInboxChargingRepository } from './inbox-charger-repository';
import { inboxHourWindowSchema, processInboxChargingHour, type InboxChargeService, type InboxChargingRepository, type InboxHourWindow } from './inbox-charger';

export const INBOX_CHARGER_QUEUE_NAME = 'hourly-connected-inbox-charging';
export const INBOX_CHARGER_SCHEDULER_ID = 'hourly-connected-inbox-charging-wakeup-v1';
export const INBOX_CHARGER_REPEAT = { pattern: '0 * * * *', tz: 'UTC' } as const;
export const inboxChargerJobOptions: JobsOptions = { attempts: 8, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 30 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 } };
const wakeJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('wake') }).strict();
const hourJobSchema = z.object({ schemaVersion: z.literal(1), kind: z.literal('charge-hour'), window: inboxHourWindowSchema }).strict();
export const inboxChargerJobSchema = z.discriminatedUnion('kind', [wakeJobSchema, hourJobSchema]);
type Job = z.infer<typeof inboxChargerJobSchema>;
type Result = { enqueued: number } | { connectors: number; chargedConnectors: number; recoveryStarted: number; chargedMicroSparks: string };
export interface InboxHourRecoverySource { listMissedClosedHours(now: Date): Promise<InboxHourWindow[]> }
type QueueAccess = Pick<Queue<Job, Result>, 'add' | 'getJob' | 'upsertJobScheduler'>;
type WorkerHandle = { on(event: 'error', listener: (error: Error) => void): unknown; close(): Promise<void> };
export interface InboxChargerDependencies { repository?: InboxChargingRepository & InboxHourRecoverySource; chargeService?: InboxChargeService; now?: () => Date; queue?: QueueAccess; workerFactory?: (processor: (data: unknown) => Promise<Result>) => WorkerHandle }
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<Job, Result> | undefined;
const getQueue = () => { if (queue) return queue; queue = new Queue<Job, Result>(INBOX_CHARGER_QUEUE_NAME, { connection: connection() }); queue.on('error', (error) => console.error('inbox charger queue error', { error })); return queue; };
export const inboxChargerHourJobId = (window: InboxHourWindow) => createHash('sha256').update(`inbox-charge-hour\0${inboxHourWindowSchema.parse(window).start}`).digest('hex');

export function createInboxChargeService(dependencies: { charge?: typeof sparkService.charge; record?: ToolEventRecorder; hash?: typeof sha256; id?: () => string } = {}): InboxChargeService {
  return {
    async charge(input) {
      const microSparks = Number(input.amountMicroSparks);
      if (!Number.isSafeInteger(microSparks) || microSparks <= 0) throw new RangeError('Inbox charge exceeds the supported microSpark range.');
      const charged = await (dependencies.charge ?? sparkService.charge)(input.userKey, { kind: 'recurring-service', microSparks, idempotencyKey: input.idempotencyKey, requestHash: await (dependencies.hash ?? sha256)(JSON.stringify({ connectorKey: input.connectorKey, userKey: input.userKey, scopeKey: input.scopeKey, hourStart: input.hourStart, hourEnd: input.hourEnd, microSparks })), eventKey: (dependencies.id ?? newId)(), metadata: { category: 'connected-inbox', connectorKey: input.connectorKey, scopeKey: input.scopeKey, hourStart: input.hourStart, hourEnd: input.hourEnd } });
      if (charged.status === 'conflict') throw new Error(`Inbox charge conflicted for ${input.connectorKey} at ${input.hourStart}.`);
      const eventKey = charged.transaction.eventKey;
      if (!eventKey) throw new Error('Inbox charge did not retain its analytics event key.');
      await (dependencies.record ?? toolEventService.record)({ userId: input.userKey, scopeKey: input.scopeKey, slug: 'email-inbox.hourly', appKey: APP_KEYS.SIGNAL, status: 'completed', microSparks, sparkTransactionKey: charged.transaction.key }, { key: eventKey });
    },
  };
}

export async function enqueueInboxChargingHour(rawWindow: unknown, targetQueue: QueueAccess = getQueue()) {
  const window = inboxHourWindowSchema.parse(rawWindow), data = hourJobSchema.parse({ schemaVersion: 1, kind: 'charge-hour', window }), jobId = inboxChargerHourJobId(window);
  const existing = await targetQueue.getJob(jobId); if (existing && await existing.getState() === 'failed') await existing.remove();
  const job = await targetQueue.add('charge-hour', data, { ...inboxChargerJobOptions, jobId }); return { jobId: job.id! };
}
export async function recoverInboxChargingHours(dependencies: InboxChargerDependencies = {}) {
  const repository = dependencies.repository ?? getDefaultInboxChargingRepository(), targetQueue = dependencies.queue ?? getQueue();
  const windows = [...new Map((await repository.listMissedClosedHours((dependencies.now ?? (() => new Date()))())).map((value) => inboxHourWindowSchema.parse(value)).map((value) => [value.start, value])).values()].sort((a, b) => a.start.localeCompare(b.start));
  let failure: unknown; for (const window of windows) { try { await enqueueInboxChargingHour(window, targetQueue); } catch (error) { failure ??= error; } } if (failure) throw failure; return { enqueued: windows.length };
}
export async function processInboxChargerJob(raw: unknown, dependencies: InboxChargerDependencies = {}): Promise<Result> { const job = inboxChargerJobSchema.parse(raw); if (job.kind === 'wake') return recoverInboxChargingHours(dependencies); const repository = dependencies.repository ?? getDefaultInboxChargingRepository(); return processInboxChargingHour(job.window, { repository, chargeService: dependencies.chargeService ?? createInboxChargeService(), now: dependencies.now }); }
export async function startInboxCharger(dependencies: InboxChargerDependencies = {}) { const targetQueue = dependencies.queue ?? getQueue(); await targetQueue.upsertJobScheduler(INBOX_CHARGER_SCHEDULER_ID, INBOX_CHARGER_REPEAT, { name: 'wake', data: wakeJobSchema.parse({ schemaVersion: 1, kind: 'wake' }), opts: inboxChargerJobOptions }); await recoverInboxChargingHours({ ...dependencies, queue: targetQueue }); const worker = dependencies.workerFactory ? dependencies.workerFactory((data) => processInboxChargerJob(data, dependencies)) : new Worker<Job, Result>(INBOX_CHARGER_QUEUE_NAME, (job) => processInboxChargerJob(job.data, dependencies), { connection: connection(), concurrency: 1 }); worker.on('error', (error: Error) => console.error('inbox charger worker error', { error })); return { close: () => worker.close() }; }
export async function closeInboxChargerQueue() { await queue?.close(); queue = undefined; }
