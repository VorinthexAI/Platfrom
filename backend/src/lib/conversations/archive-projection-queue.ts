import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { publishScopeEvent } from '@/api/events';
import { executeAsk } from '@/lib/ai/router';
import { chatOutputSchema, type ChatOutput } from '@/lib/ai/providers';
import { embedTexts } from '@/lib/embeddings';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { createRedisConnection } from '@/lib/redis';
import {
  createConversationArchiveProjectionRepository,
  prepareConversationArchiveProjection,
  summarizeConversationArchive,
  type ConversationArchiveAsk,
  type ConversationArchiveOwner,
  type ConversationArchiveProjectionRepository,
} from './archive-projection';

const QUEUE_NAME = 'conversation-archive-projection';
const jobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 },
};

export const conversationArchiveProjectionJobSchema = z.object({
  schemaVersion: z.literal(1),
  conversationKey: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  actorKey: z.string().cuid(),
  desiredRevision: z.number().int().positive(),
}).strict();
export type ConversationArchiveProjectionJob = z.infer<typeof conversationArchiveProjectionJobSchema>;
type Result = { status: 'committed' | 'deleted' | 'stale' };
type QueueAccess = Pick<Queue<ConversationArchiveProjectionJob, Result>, 'add' | 'getJob' | 'getJobs'>;
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ConversationArchiveProjectionJob, Result> | undefined;

function getQueue() {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('conversation archive projection queue error', { error }));
  return queue;
}

export function conversationArchiveProjectionJobId(conversationKey: string, desiredRevision: number) {
  return `a${createHash('sha256').update(`${z.string().cuid().parse(conversationKey)}\0${z.number().int().positive().parse(desiredRevision)}`).digest('hex').slice(0, 24)}`;
}

export async function enqueueConversationArchiveProjection(raw: unknown, targetQueue: Pick<QueueAccess, 'add' | 'getJob'> = getQueue()) {
  const job = conversationArchiveProjectionJobSchema.parse(raw);
  const jobId = conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision);
  const existing = await targetQueue.getJob(jobId);
  if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  const queued = await targetQueue.add('project-conversation-files', job, { ...jobOptions, jobId });
  return { jobId: queued.id! };
}

const ask: ConversationArchiveAsk = async (request, { teamKey, signal }) => {
  const response = await executeAsk<ChatOutput>(teamKey, {
    systemPrompt: request.instruction,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.source }] }],
    options: { temperature: 0, maxTokens: 1_200 },
  }, { providers: ['text.primary'], signal, timeoutMs: 45_000 });
  return chatOutputSchema.parse(response.output).text;
};

export interface ConversationArchiveProjectionWorkerDependencies {
  repository?: ConversationArchiveProjectionRepository;
  ask?: ConversationArchiveAsk;
  embedTexts?: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  upload?: typeof documentStorage.upload;
  publishChanged?: typeof publishScopeEvent;
}

export async function processConversationArchiveProjection(raw: unknown, dependencies: ConversationArchiveProjectionWorkerDependencies = {}): Promise<Result> {
  const job = conversationArchiveProjectionJobSchema.parse(raw);
  const repository = dependencies.repository ?? createConversationArchiveProjectionRepository();
  const owner: ConversationArchiveOwner = { conversationKey: job.conversationKey, teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey, actorKey: job.actorKey };
  const snapshot = await repository.readSnapshot(owner, job.desiredRevision);
  if (snapshot.status === 'stale') return { status: 'stale' };
  if (snapshot.status === 'missing-source') {
    const deleted = await repository.deleteMissingSource(owner, job.desiredRevision);
    if (deleted === 'deleted') await (dependencies.publishChanged ?? publishScopeEvent)(job.scopeKey, 'content.changed').catch(() => undefined);
    return { status: deleted === 'deleted' ? 'deleted' : 'stale' };
  }
  const completed = snapshot.snapshot.messages.filter((message) => message.status === 'COMPLETED');
  const summary = completed.some((message) => message.role === 'USER')
    ? await summarizeConversationArchive(completed, job.teamKey, dependencies.ask ?? ask)
    : null;
  const projection = await prepareConversationArchiveProjection(snapshot.snapshot, summary, {
    embedTexts: dependencies.embedTexts ?? ((texts, signal) => embedTexts({ texts, purpose: 'document', signal })),
  });
  const upload = dependencies.upload ?? documentStorage.upload.bind(documentStorage);
  const existingByKey = new Map(snapshot.snapshot.existing.files.map((file) => [file.key, file]));
  for (const file of projection.files) {
    const previous = existingByKey.get(file.key);
    if (previous && previous.extractedText === file.extractedText && previous.storageKey === file.storageKey) continue;
    await upload({ key: file.storageKey, bytes: Buffer.from(file.extractedText, 'utf8'), mimeType: file.mimeType, billingUserKey: job.userKey });
  }
  const committed = await repository.commit(snapshot.snapshot, projection, new Date().toISOString());
  if (committed.status === 'committed') await (dependencies.publishChanged ?? publishScopeEvent)(job.scopeKey, 'content.changed').catch(() => undefined);
  return committed.status === 'committed' ? { status: 'committed' } : { status: 'stale' };
}

export function startConversationArchiveProjectionWorker() {
  const worker = new Worker<ConversationArchiveProjectionJob, Result>(QUEUE_NAME, (job) => processConversationArchiveProjection(job.data), { connection: connection(), concurrency: 2 });
  worker.on('error', (error) => console.error('conversation archive projection worker error', { error }));
  worker.on('failed', (job, error) => console.error('conversation archive projection job failed', { jobId: job?.id, conversationKey: job?.data.conversationKey, desiredRevision: job?.data.desiredRevision, errorName: error.name, errorMessage: error.message }));
  return { close: () => worker.close() };
}

export async function recoverConversationArchiveProjectionQueue(dependencies: { repository?: ConversationArchiveProjectionRepository; queue?: QueueAccess } = {}) {
  const repository = dependencies.repository ?? createConversationArchiveProjectionRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const active = await targetQueue.getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'], 0, -1, true);
  const queued = new Set(active.map((item) => conversationArchiveProjectionJobSchema.safeParse(item.data)).filter((result) => result.success).map((result) => conversationArchiveProjectionJobId(result.data.conversationKey, result.data.desiredRevision)));
  let enqueued = 0;
  for (const state of await repository.listPending()) {
    const jobId = conversationArchiveProjectionJobId(state.conversationKey, state.desiredRevision);
    if (queued.has(jobId)) continue;
    await enqueueConversationArchiveProjection({ schemaVersion: 1, conversationKey: state.conversationKey, teamKey: state.teamKey, scopeKey: state.scopeKey, userKey: state.userKey, actorKey: state.actorKey, desiredRevision: state.desiredRevision }, targetQueue);
    enqueued += 1;
  }
  return { enqueued };
}

export async function closeConversationArchiveProjectionQueue() {
  await queue?.close();
  queue = undefined;
}
