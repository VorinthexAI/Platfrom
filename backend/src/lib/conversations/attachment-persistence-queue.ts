import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { publishUserEvent } from '@/api/events';
import { createRedisConnection } from '@/lib/redis';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { persistConversationAttachment, type ConversationAttachmentPersistenceDependencies } from './attachment-persistence';
import { cleanupExpiredConversationAttachmentArtifacts, CONVERSATION_ATTACHMENT_LEASE_MS, CONVERSATION_ATTACHMENT_MAX_ATTEMPTS, getDefaultConversationAttachmentArtifactRepository, newAttachmentLeaseToken, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';

const QUEUE_NAME = 'conversation-attachment-persistence';
const options: JobsOptions = { attempts: 5, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 }, removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 } };
export const conversationAttachmentPersistenceJobSchema = z.object({ schemaVersion: z.literal(1), artifactKey: z.string().cuid(), userMessageKey: z.string().cuid() }).strict();
export type ConversationAttachmentPersistenceJob = z.infer<typeof conversationAttachmentPersistenceJobSchema>;
type Result = { references: number };
type QueueAccess = Pick<Queue<ConversationAttachmentPersistenceJob, Result>, 'add' | 'getJob' | 'getJobs'>;
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ConversationAttachmentPersistenceJob, Result> | undefined;
function getQueue() { if (queue) return queue; queue = new Queue(QUEUE_NAME, { connection: connection() }); queue.on('error', (error) => console.error('conversation attachment persistence queue error', { error })); return queue; }

export async function enqueueConversationAttachmentPersistence(raw: unknown, targetQueue: Pick<QueueAccess, 'add' | 'getJob'> = getQueue()) {
  const job = conversationAttachmentPersistenceJobSchema.parse(raw); const existing = await targetQueue.getJob(job.artifactKey); if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  const queued = await targetQueue.add('persist-attachment', job, { ...options, jobId: job.artifactKey }); return { jobId: queued.id! };
}

export async function processConversationAttachmentPersistence(raw: unknown, dependencies: {
  artifacts?: ConversationAttachmentArtifactRepository; persist?: typeof persistConversationAttachment; persistence?: ConversationAttachmentPersistenceDependencies;
  storage?: Pick<DocumentObjectStorage, 'delete'>; publishChanged?: typeof publishUserEvent; now?: () => Date; token?: () => string;
  leaseRenewalMs?: number; scheduleLeaseRenewal?: (renew: () => void, milliseconds: number) => () => void;
} = {}) {
  const job = conversationAttachmentPersistenceJobSchema.parse(raw); const artifacts = dependencies.artifacts ?? getDefaultConversationAttachmentArtifactRepository(); const now = dependencies.now?.() ?? new Date(); const token = (dependencies.token ?? newAttachmentLeaseToken)();
  const leased = await artifacts.lease(job.artifactKey, token, now.toISOString(), new Date(now.getTime() + CONVERSATION_ATTACHMENT_LEASE_MS).toISOString());
  if (!leased) return { references: 0 };
  if (leased.userMessageKey !== job.userMessageKey) throw new Error('Attachment job does not match its durable message binding.');
  const context = { teamKey: leased.teamKey, runtimeScopeKey: leased.scopeKey, principal: { kind: 'member' as const, user: { key: leased.userKey }, userTeam: { key: leased.ownerKey, teamKey: leased.teamKey, userId: leased.userKey, status: 'active' as const }, scopeMember: null }, ...(leased.teamAssurance ? { teamAssurance: leased.teamAssurance } : {}) };
  const controller = new AbortController();
  let renewal = Promise.resolve(); let leaseError: Error | undefined;
  const renew = () => { renewal = renewal.then(async () => {
    const renewedAt = dependencies.now?.() ?? new Date();
    if (!await artifacts.renew(leased.key, token, new Date(renewedAt.getTime() + CONVERSATION_ATTACHMENT_LEASE_MS).toISOString())) throw new Error('Conversation attachment persistence lease fence was lost.');
  }).catch((error) => { leaseError = error instanceof Error ? error : new Error(String(error)); controller.abort(leaseError); }); };
  const schedule = dependencies.scheduleLeaseRenewal ?? ((callback: () => void, milliseconds: number) => { const timer = setInterval(callback, milliseconds); timer.unref?.(); return () => clearInterval(timer); });
  const stopRenewal = schedule(renew, dependencies.leaseRenewalMs ?? Math.floor(CONVERSATION_ATTACHMENT_LEASE_MS / 3));
  try {
    const reference = await (dependencies.persist ?? persistConversationAttachment)(leased, context as never, { ...dependencies.persistence, signal: controller.signal });
    renew(); await renewal;
    if (leaseError) throw leaseError;
    if (!await artifacts.complete(leased.key, token, reference)) throw new Error('Conversation attachment lease fence was lost before completion.');
    await (dependencies.storage ?? documentStorage).delete(leased.stagedStorageKey).catch(() => undefined);
    const settled = await artifacts.settleMessage(job.userMessageKey);
    if (settled) await (dependencies.publishChanged ?? publishUserEvent)(settled.userKey, 'conversation.changed').catch(() => undefined);
    return { references: 1 };
  } catch (error) {
    const terminal = leased.attempts >= CONVERSATION_ATTACHMENT_MAX_ATTEMPTS;
    const availableAt = new Date(now.getTime() + Math.min(60_000, 2_000 * 2 ** Math.max(0, leased.attempts - 1))).toISOString();
    if (!await artifacts.retry(leased.key, token, error instanceof Error ? error.message : 'Attachment persistence failed.', availableAt, terminal)) throw error;
    const settled = await artifacts.settleMessage(job.userMessageKey);
    if (settled) await (dependencies.publishChanged ?? publishUserEvent)(settled.userKey, 'conversation.changed').catch(() => undefined);
    if (!terminal) throw error;
    return { references: 0 };
  } finally {
    stopRenewal();
    await renewal;
  }
}

export function startConversationAttachmentPersistenceWorker() { const worker = new Worker<ConversationAttachmentPersistenceJob, Result>(QUEUE_NAME, (job) => processConversationAttachmentPersistence(job.data), { connection: connection(), concurrency: 2 }); worker.on('error', (error) => console.error('conversation attachment persistence worker error', { error })); return { close: () => worker.close() }; }

export async function recoverConversationAttachmentPersistenceQueue(dependencies: { artifacts?: ConversationAttachmentArtifactRepository; queue?: QueueAccess; storage?: Pick<DocumentObjectStorage, 'delete'>; now?: () => Date } = {}) {
  const artifacts = dependencies.artifacts ?? getDefaultConversationAttachmentArtifactRepository(); const targetQueue = dependencies.queue ?? getQueue(); const now = dependencies.now?.() ?? new Date();
  const active = await targetQueue.getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'], 0, -1, true); const queued = new Set(active.map((item) => conversationAttachmentPersistenceJobSchema.safeParse(item.data)).filter((result) => result.success).map((result) => result.data.artifactKey)); let enqueued = 0;
  for (const artifact of await artifacts.listRecoverable(now.toISOString())) { if (queued.has(artifact.key) || !artifact.userMessageKey) continue; await enqueueConversationAttachmentPersistence({ schemaVersion: 1, artifactKey: artifact.key, userMessageKey: artifact.userMessageKey }, targetQueue); enqueued += 1; }
  const cleanup = await cleanupExpiredConversationAttachmentArtifacts({ repository: artifacts, storage: dependencies.storage, now: () => now.toISOString() });
  return { enqueued, expired: cleanup.removed };
}

export async function closeConversationAttachmentPersistenceQueue() { await queue?.close(); queue = undefined; }
