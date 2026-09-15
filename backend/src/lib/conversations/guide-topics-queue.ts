import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { publishUserEvent } from '@/api/events';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { runTool } from '@/lib/ai/tools';
import type { ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { createRedisConnection } from '@/lib/redis';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { agentGuideOutputSchema } from '@/lib/ai/tools/agent-guide';

const QUEUE_NAME = 'conversation-guide-topics';
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 },
};

export const conversationGuideTopicsJobSchema = z.object({
  schemaVersion: z.literal(1), assistantMessageKey: z.string().cuid(), conversationKey: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), actorKey: z.string().cuid(),
  generation: z.number().int().positive(),
}).strict();
export type ConversationGuideTopicsJob = z.infer<typeof conversationGuideTopicsJobSchema>;
type Result = { status: 'committed' | 'stale' | 'failed' };
type QueueAccess = Pick<Queue<ConversationGuideTopicsJob, Result>, 'add' | 'getJob' | 'getJobs'>;
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ConversationGuideTopicsJob, Result> | undefined;

function getQueue() {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('conversation guide topics queue error', { error }));
  return queue;
}

export function conversationGuideTopicsJobId(assistantMessageKey: string, generation: number) {
  return `t${createHash('sha256').update(`${z.string().cuid().parse(assistantMessageKey)}\0${z.number().int().positive().parse(generation)}`).digest('hex').slice(0, 24)}`;
}

export async function enqueueConversationGuideTopics(raw: unknown, targetQueue: Pick<QueueAccess, 'add' | 'getJob'> = getQueue()) {
  const job = conversationGuideTopicsJobSchema.parse(raw);
  const jobId = conversationGuideTopicsJobId(job.assistantMessageKey, job.generation);
  const existing = await targetQueue.getJob(jobId);
  if (existing && ['completed', 'failed'].includes(await existing.getState())) await existing.remove();
  const queued = await targetQueue.add('generate-guide-topics', job, { ...jobOptions, jobId });
  return { jobId: queued.id! };
}

export interface ConversationGuideTopicsWorkerDependencies {
  repository?: ConversationRepository;
  run?: typeof runTool;
  publishChanged?: typeof publishUserEvent;
  recordEvent?: ToolEventRecorder;
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  terminalFailure?: boolean;
}

export async function processConversationGuideTopics(raw: unknown, dependencies: ConversationGuideTopicsWorkerDependencies = {}): Promise<Result> {
  const job = conversationGuideTopicsJobSchema.parse(raw);
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const ownership = { teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey };
  const snapshot = await repository.readGuideTopicSnapshot(ownership, job.conversationKey, job.assistantMessageKey, job.generation);
  if (!snapshot) return { status: 'stale' };
  const context = { teamKey: job.teamKey, runtimeScopeKey: job.scopeKey, principal: { kind: 'member' as const, user: { key: job.userKey }, userTeam: { key: job.actorKey, teamKey: job.teamKey, userId: job.userKey, status: 'active' as const }, scopeMember: null } };
  try {
    const output = agentGuideOutputSchema.parse(await (dependencies.run ?? runTool)('agent.guide', '', {
      mode: 'topics', question: snapshot.question, answer: snapshot.message.content, guideContext: snapshot.message.guideContext,
      recentTopicLabels: snapshot.recentTopicLabels,
    }, { contentContext: context as never, requestKey: `guide-topics:${job.assistantMessageKey}:${job.generation}`, recordEvent: dependencies.recordEvent ?? toolEventService.record, appScopeKey: dependencies.appScopeKey, billing: dependencies.billing }));
    if (output.mode !== 'topics') throw new Error('agent.guide returned the wrong topic mode.');
    const committed = await repository.commitGuideTopics(ownership, job.conversationKey, job.assistantMessageKey, job.generation, output.guideMode, output.topics);
    if (!committed) return { status: 'stale' };
    await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'conversation.changed').catch(() => undefined);
    return { status: 'committed' };
  } catch (error) {
    if (!(dependencies.terminalFailure ?? true)) throw error;
    const fundingCode = error instanceof SparkRepositoryError && (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'OUTSTANDING_DEBT') ? error.code : undefined;
    const failed = await repository.failGuideTopics(ownership, job.conversationKey, job.assistantMessageKey, job.generation, fundingCode ? 'FUNDING_REQUIRED' : 'GENERATION_FAILED', fundingCode);
    if (failed && fundingCode) await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'spark.balance.required', fundingCode, job.assistantMessageKey).catch(() => undefined);
    if (failed) await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'conversation.changed').catch(() => undefined);
    if (!fundingCode) throw error;
    return { status: failed ? 'failed' : 'stale' };
  }
}

export function startConversationGuideTopicsWorker() {
  const worker = new Worker<ConversationGuideTopicsJob, Result>(QUEUE_NAME, (job) => processConversationGuideTopics(job.data, { terminalFailure: job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1) }), { connection: connection(), concurrency: 2 });
  worker.on('error', (error) => console.error('conversation guide topics worker error', { error }));
  worker.on('failed', (job, error) => console.error('conversation guide topics job failed', { jobId: job?.id, assistantMessageKey: job?.data.assistantMessageKey, generation: job?.data.generation, errorName: error.name, errorMessage: error.message }));
  return { close: () => worker.close() };
}

export async function recoverConversationGuideTopicsQueue(dependencies: { repository?: ConversationRepository; queue?: QueueAccess } = {}) {
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const active = await targetQueue.getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'], 0, -1, true);
  const queued = new Set(active.map((item) => conversationGuideTopicsJobSchema.safeParse(item.data)).filter((result) => result.success).map((result) => conversationGuideTopicsJobId(result.data.assistantMessageKey, result.data.generation)));
  let enqueued = 0;
  for (const { message, actorKey } of await repository.listPendingGuideTopics()) {
    if (!message.guideTopicGeneration) continue;
    const jobId = conversationGuideTopicsJobId(message.key, message.guideTopicGeneration);
    if (queued.has(jobId)) continue;
    await enqueueConversationGuideTopics({ schemaVersion: 1, assistantMessageKey: message.key, conversationKey: message.conversationKey, teamKey: message.teamKey, scopeKey: message.scopeKey, userKey: message.userKey, actorKey, generation: message.guideTopicGeneration }, targetQueue);
    enqueued += 1;
  }
  return { enqueued };
}

export async function closeConversationGuideTopicsQueue() {
  await queue?.close();
  queue = undefined;
}
