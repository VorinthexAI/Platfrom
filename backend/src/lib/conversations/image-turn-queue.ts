import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { createImageGenerationService, managedImageGenerateInputSchema, type ImageGenerationService } from '@/lib/image-generation/service';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { publishUserEvent } from '@/api/events';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';

const QUEUE_NAME = 'conversation-image-turns';
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 },
};
export const conversationImageTurnJobSchema = z.object({
  schemaVersion: z.literal(1), assistantMessageKey: z.string().cuid(), conversationKey: z.string().cuid(),
  organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), actorKey: z.string().cuid(),
  requestKey: z.string().trim().min(1).max(180), input: managedImageGenerateInputSchema,
}).strict();
export type ConversationImageTurnJob = z.infer<typeof conversationImageTurnJobSchema>;
type QueueAccess = Pick<Queue<ConversationImageTurnJob, { imageKey: string }>, 'add' | 'getJob' | 'getJobs'>;
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<ConversationImageTurnJob, { imageKey: string }> | undefined;

function getQueue() {
  if (queue) return queue;
  queue = new Queue(QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('conversation image queue error', { error }));
  return queue;
}

export const conversationImageTurnJobId = (assistantMessageKey: string) => z.string().cuid().parse(assistantMessageKey);

export async function enqueueConversationImageTurn(raw: unknown, targetQueue: Pick<QueueAccess, 'add' | 'getJob'> = getQueue()) {
  const job = conversationImageTurnJobSchema.parse(raw);
  const id = conversationImageTurnJobId(job.assistantMessageKey);
  const existing = await targetQueue.getJob(id);
  if (existing && await existing.getState() === 'failed') await existing.remove();
  const queued = await targetQueue.add('generate-image', job, { ...jobOptions, jobId: id });
  return { jobId: queued.id! };
}

export async function processConversationImageTurn(raw: unknown, dependencies: {
  repository?: ConversationRepository;
  images?: Pick<ImageGenerationService, 'generateManaged'>;
  publishChanged?: typeof publishUserEvent;
  recordEvent?: ToolEventRecorder;
  billing?: ToolBillingDependencies;
  terminalFailure?: boolean;
  now?: () => string;
} = {}) {
  const job = conversationImageTurnJobSchema.parse(raw);
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const context = { organizationKey: job.organizationKey, runtimeScopeKey: job.scopeKey, principal: { kind: 'member' as const, user: { key: job.userKey }, userOrganization: { key: job.actorKey, organizationId: job.organizationKey, userId: job.userKey, status: 'active' as const }, scopeMember: null } };
  try {
    const output = await observeToolExecution(
      'conversation.image.enqueue',
      context as never,
      () => (dependencies.images ?? createImageGenerationService()).generateManaged(job.input, context as never, job.requestKey),
      { recorder: dependencies.recordEvent ?? (dependencies.images ? undefined : toolEventService.record), idempotencyKey: job.requestKey, input: job.input, ...dependencies.billing },
    );
    if (output.images.length !== 1) throw new Error('Conversation image generation must produce exactly one image.');
    const completed = await repository.completeImageTurn({ organizationKey: job.organizationKey, scopeKey: job.scopeKey, userKey: job.userKey }, job.conversationKey, job.assistantMessageKey, output.images[0]!.key, (dependencies.now ?? (() => new Date().toISOString()))());
    if (!completed) throw new Error('Conversation image response changed before completion.');
    await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'conversation.changed').catch(() => undefined);
    return { imageKey: output.images[0]!.key };
  } catch (error) {
    if (dependencies.terminalFailure ?? true) {
      await repository.failTurn({ organizationKey: job.organizationKey, scopeKey: job.scopeKey, userKey: job.userKey }, job.conversationKey, job.assistantMessageKey, (dependencies.now ?? (() => new Date().toISOString()))());
      await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'conversation.changed').catch(() => undefined);
    }
    throw error;
  }
}

export function startConversationImageTurnWorker() {
  const worker = new Worker<ConversationImageTurnJob, { imageKey: string }>(QUEUE_NAME, (job) => processConversationImageTurn(job.data, { terminalFailure: job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1) }), { connection: connection(), concurrency: 2 });
  worker.on('error', (error) => console.error('conversation image worker error', { error }));
  return { close: () => worker.close() };
}

export async function recoverConversationImageTurnQueue(dependencies: { repository?: ConversationRepository; queue?: QueueAccess } = {}) {
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const targetQueue = dependencies.queue ?? getQueue();
  const active = await targetQueue.getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'], 0, -1, true);
  const queued = new Set(active.map((job) => conversationImageTurnJobSchema.safeParse(job.data)).filter((result) => result.success).map((result) => result.data.assistantMessageKey));
  const pending = await repository.listPendingImageTurns();
  let enqueued = 0;
  for (const { message, actorKey } of pending) {
    if (queued.has(message.key)) continue;
    await enqueueConversationImageTurn({ schemaVersion: 1, assistantMessageKey: message.key, conversationKey: message.conversationKey, organizationKey: message.organizationKey, scopeKey: message.scopeKey, userKey: message.userKey, actorKey, requestKey: message.key, input: JSON.parse(message.content) }, targetQueue);
    enqueued += 1;
  }
  return { enqueued };
}

export async function closeConversationImageTurnQueue() {
  await queue?.close();
  queue = undefined;
}
