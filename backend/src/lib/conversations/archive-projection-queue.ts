import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { publishScopeEvent, publishUserEvent } from '@/api/events';
import { executeAsk } from '@/lib/ai/router';
import { embedTexts } from '@/lib/embeddings';
import { initialWorkspaceContentService } from '@/lib/initial-workspace-content';
import { createRedisConnection } from '@/lib/redis';
import {
  conversationArchiveKey,
  conversationArchiveStateSchema,
  createConversationArchiveProjectionRepository,
  prepareConversationArchiveProjection,
  summarizeConversationArchive,
  type ConversationArchiveAsk,
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
  schemaVersion: z.literal(1), conversationKey: z.string().cuid(), teamKey: z.string().trim().min(1).max(160),
  scopeKey: z.string().cuid(), userKey: z.string().cuid(), actorKey: z.string().cuid(), desiredRevision: z.number().int().positive(),
}).strict();
export type ConversationArchiveProjectionJob = z.infer<typeof conversationArchiveProjectionJobSchema>;
type ProjectionResult = { status: 'committed' | 'stale' | 'deleted'; projectedRevision?: number };
type QueueAccess = Pick<Queue<ConversationArchiveProjectionJob, ProjectionResult>, 'add' | 'getJob' | 'getJobs'>;

const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ConversationArchiveProjectionJob, ProjectionResult> | undefined;
function getQueue() {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('conversation archive projection queue error', { error }));
  return queue;
}

export function conversationArchiveProjectionJobId(conversationKey: string, desiredRevision: number): string {
  return conversationArchiveKey('job', z.string().cuid().parse(conversationKey), z.number().int().positive().parse(desiredRevision));
}

export async function enqueueConversationArchiveProjection(raw: unknown, targetQueue: Pick<QueueAccess, 'add' | 'getJob'> = getQueue()) {
  const job = conversationArchiveProjectionJobSchema.parse(raw);
  const jobId = conversationArchiveProjectionJobId(job.conversationKey, job.desiredRevision);
  const existing = await targetQueue.getJob(jobId);
  if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  const queued = await targetQueue.add('project-conversation', job, { ...jobOptions, jobId });
  return { jobId: queued.id! };
}

const defaultAsk: ConversationArchiveAsk = async (request, context) => {
  const response = await executeAsk<{ text: string }>(context.teamKey, {
    mode: 'default',
    systemPrompt: request.instruction,
    messages: [{ role: 'user', content: [{ type: 'text', text: request.source }] }],
    options: { temperature: 0.1, maxTokens: 900 },
  }, { signal: context.signal });
  return z.object({ text: z.string().trim().min(1) }).parse(response.output).text;
};

export interface ConversationArchiveProjectionWorkerDependencies {
  repository?: ConversationArchiveProjectionRepository;
  ask?: ConversationArchiveAsk;
  embedTexts?: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  publishConversationChanged?: typeof publishUserEvent;
  publishContentChanged?: typeof publishScopeEvent;
  now?: () => string;
  signal?: AbortSignal;
}

export async function processConversationArchiveProjection(raw: unknown, dependencies: ConversationArchiveProjectionWorkerDependencies = {}): Promise<ProjectionResult> {
  const job = conversationArchiveProjectionJobSchema.parse(raw);
  const repository = dependencies.repository ?? createConversationArchiveProjectionRepository();
  const owner = { conversationKey: job.conversationKey, teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey, actorKey: job.actorKey };
  const result = await repository.readSnapshot(owner, job.desiredRevision);
  if (result.status === 'stale') return { status: 'stale' };
  if (result.status === 'missing-source') {
    const deleted = await repository.deleteMissingSource(owner, job.desiredRevision);
    if (deleted === 'stale') return { status: 'stale' };
    await Promise.allSettled([
      (dependencies.publishConversationChanged ?? publishUserEvent)(job.userKey, 'conversation.changed'),
      (dependencies.publishContentChanged ?? publishScopeEvent)(job.scopeKey, 'content.changed'),
    ]);
    return { status: 'deleted' };
  }
  const completed = result.snapshot.messages.filter((message) => message.status === 'COMPLETED');
  const summary = completed.some((message) => message.role === 'USER')
    ? await summarizeConversationArchive(completed, job.teamKey, dependencies.ask ?? defaultAsk, dependencies.signal)
    : null;
  await initialWorkspaceContentService.ensure(job.scopeKey).catch(() => undefined);
  const projection = await prepareConversationArchiveProjection(result.snapshot, summary, {
    embedTexts: dependencies.embedTexts ?? ((texts, signal) => embedTexts({ texts, signal })),
    now: dependencies.now,
    signal: dependencies.signal,
  });
  const committed = await repository.commit(result.snapshot, projection, (dependencies.now ?? (() => new Date().toISOString()))());
  if (committed.status === 'stale') return { status: 'stale' };
  await Promise.allSettled([
    (dependencies.publishConversationChanged ?? publishUserEvent)(job.userKey, 'conversation.changed'),
    (dependencies.publishContentChanged ?? publishScopeEvent)(job.scopeKey, 'content.changed'),
  ]);
  return { status: 'committed', projectedRevision: committed.projectedRevision };
}

export function startConversationArchiveProjectionWorker(dependencies: ConversationArchiveProjectionWorkerDependencies = {}) {
  const worker = new Worker<ConversationArchiveProjectionJob, ProjectionResult>(QUEUE_NAME, (job) => processConversationArchiveProjection(job.data, dependencies), { connection: connection(), concurrency: 2 });
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
    const parsed = conversationArchiveStateSchema.parse(state);
    const id = conversationArchiveProjectionJobId(parsed.conversationKey, parsed.desiredRevision);
    if (queued.has(id)) continue;
    await enqueueConversationArchiveProjection({ schemaVersion: 1, conversationKey: parsed.conversationKey, teamKey: parsed.teamKey, scopeKey: parsed.scopeKey, userKey: parsed.userKey, actorKey: parsed.actorKey, desiredRevision: parsed.desiredRevision }, targetQueue);
    enqueued += 1;
  }
  return { enqueued };
}

export async function closeConversationArchiveProjectionQueue() {
  await queue?.close();
  queue = undefined;
}
