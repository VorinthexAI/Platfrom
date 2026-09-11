import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { createImageGenerationService, managedImageGenerateInputSchema, type ImageGenerationService, type ResolvedImageGenerationReference } from '@/lib/image-generation/service';
import { getDefaultConversationRepository, type ConversationRepository } from './repository';
import { publishUserEvent } from '@/api/events';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { artifactSha256, getDefaultConversationAttachmentArtifactRepository, type ConversationAttachmentArtifact, type ConversationAttachmentArtifactRepository } from './attachment-artifacts';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { imageDataUrl } from '@/lib/gallery/image-reference';

const QUEUE_NAME = 'conversation-image-turns';
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 },
};
export const conversationImageTurnJobSchema = z.object({
  schemaVersion: z.literal(1), assistantMessageKey: z.string().cuid(), conversationKey: z.string().cuid(),
  teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(), actorKey: z.string().cuid(),
  requestKey: z.string().trim().min(1).max(180), input: managedImageGenerateInputSchema,
  stagedImageArtifactKeys: z.array(z.string().cuid()).max(8).refine((keys) => new Set(keys).size === keys.length, 'Staged image artifact keys must be unique.').default([]),
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

function assertOwnedImageArtifact(artifact: ConversationAttachmentArtifact | null, job: ConversationImageTurnJob, now: string) {
  if (!artifact || artifact.teamKey !== job.teamKey || artifact.scopeKey !== job.scopeKey || artifact.userKey !== job.userKey || artifact.ownerKey !== job.actorKey || artifact.conversationKey !== job.conversationKey) throw new Error('A staged image reference does not belong to this conversation execution.');
  if (artifact.kind !== 'image') throw new Error('Document artifacts cannot be used as image generation references.');
  if (Date.parse(artifact.expiresAt) <= Date.parse(now)) throw new Error('A staged image reference has expired.');
  if (artifact.status === 'FAILED' || artifact.status === 'PREPARED') throw new Error('A staged image reference is unavailable.');
  return artifact;
}

async function resolveStagedImageReferences(job: ConversationImageTurnJob, artifacts: Pick<ConversationAttachmentArtifactRepository, 'read'>, storage: Pick<DocumentObjectStorage, 'download'>, now: string) {
  const finalReferenceImageKeys: string[] = [];
  const resolvedReferences: ResolvedImageGenerationReference[] = [];
  for (const key of job.stagedImageArtifactKeys) {
    let artifact = assertOwnedImageArtifact(await artifacts.read(key), job, now);
    if (artifact.status === 'COMPLETED') {
      if (artifact.finalReference?.kind !== 'image') throw new Error('A completed staged image reference has no Gallery image.');
      finalReferenceImageKeys.push(artifact.finalReference.key);
      continue;
    }
    try {
      const object = await storage.download(artifact.stagedStorageKey);
      if (object.mimeType !== undefined && object.mimeType.toLowerCase() !== 'image/png') throw new Error('A staged image reference MIME type changed.');
      if (object.sizeBytes !== undefined && object.sizeBytes !== artifact.sizeBytes) throw new Error('A staged image reference size changed.');
      if (object.bytes.byteLength !== artifact.sizeBytes || artifactSha256(object.bytes) !== artifact.stagedSha256) throw new Error('A staged image reference content changed.');
      resolvedReferences.push({ identity: `artifact:${artifact.key}:${artifact.stagedSha256}`, inputReference: imageDataUrl(object.bytes, 'image/png') });
    } catch (error) {
      artifact = assertOwnedImageArtifact(await artifacts.read(key), job, now);
      if (artifact.status === 'COMPLETED' && artifact.finalReference?.kind === 'image') {
        finalReferenceImageKeys.push(artifact.finalReference.key);
        continue;
      }
      throw error;
    }
  }
  return { finalReferenceImageKeys, resolvedReferences };
}

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
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  artifacts?: Pick<ConversationAttachmentArtifactRepository, 'read'>;
  storage?: Pick<DocumentObjectStorage, 'download'>;
  terminalFailure?: boolean;
  now?: () => string;
} = {}) {
  const job = conversationImageTurnJobSchema.parse(raw);
  const repository = dependencies.repository ?? getDefaultConversationRepository();
  const context = { teamKey: job.teamKey, runtimeScopeKey: job.scopeKey, principal: { kind: 'member' as const, user: { key: job.userKey }, userTeam: { key: job.actorKey, teamKey: job.teamKey, userId: job.userKey, status: 'active' as const }, scopeMember: null } };
  try {
    const resolved = await resolveStagedImageReferences(job, dependencies.artifacts ?? getDefaultConversationAttachmentArtifactRepository(), dependencies.storage ?? documentStorage, (dependencies.now ?? (() => new Date().toISOString()))());
    const input = { ...job.input, referenceImageKeys: [...job.input.referenceImageKeys, ...resolved.finalReferenceImageKeys] };
    const output = await observeToolExecution(
      'app.generate-image',
      context as never,
      () => (dependencies.images ?? createImageGenerationService()).generateManaged(input, context as never, job.requestKey, resolved.resolvedReferences),
      { recorder: dependencies.recordEvent ?? (dependencies.images ? undefined : toolEventService.record), appScopeKey: dependencies.appScopeKey, idempotencyKey: job.requestKey, input: job.input, ...dependencies.billing },
    );
    if (output.images.length !== 1) throw new Error('Conversation image generation must produce exactly one image.');
    const completed = await repository.completeImageTurn({ teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey }, job.conversationKey, job.assistantMessageKey, output.images[0]!.key, output.images[0]!.caption, (dependencies.now ?? (() => new Date().toISOString()))());
    if (!completed) throw new Error('Conversation image response changed before completion.');
    await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'conversation.changed').catch(() => undefined);
    return { imageKey: output.images[0]!.key };
  } catch (error) {
    if (dependencies.terminalFailure ?? true) {
      const fundingRequiredCode = error instanceof SparkRepositoryError && (error.code === 'INSUFFICIENT_BALANCE' || error.code === 'OUTSTANDING_DEBT') ? error.code : undefined;
      const failed = await repository.failTurn({ teamKey: job.teamKey, scopeKey: job.scopeKey, userKey: job.userKey }, job.conversationKey, job.assistantMessageKey, (dependencies.now ?? (() => new Date().toISOString()))(), fundingRequiredCode);
      if (failed && fundingRequiredCode) await (dependencies.publishChanged ?? publishUserEvent)(job.userKey, 'spark.balance.required', fundingRequiredCode, job.assistantMessageKey).catch(() => undefined);
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
    await enqueueConversationImageTurn({ schemaVersion: 1, assistantMessageKey: message.key, conversationKey: message.conversationKey, teamKey: message.teamKey, scopeKey: message.scopeKey, userKey: message.userKey, actorKey, requestKey: message.key, input: JSON.parse(message.content), stagedImageArtifactKeys: message.imageReferenceArtifactKeys ?? [] }, targetQueue);
    enqueued += 1;
  }
  return { enqueued };
}

export async function closeConversationImageTurnQueue() {
  await queue?.close();
  queue = undefined;
}
