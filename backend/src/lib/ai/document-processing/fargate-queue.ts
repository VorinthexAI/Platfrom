import { createHash, randomUUID } from 'node:crypto';
import { Job, Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { computeDispatch, computeDispatchConfigured } from '@/lib/compute-jobs';
import { createRedisConnection } from '@/lib/redis';
import { ContentError, contentErrorSchema, type ContentErrorShape } from '@/lib/ai/tools/content-errors';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { AgentRuntimeNotFoundError } from '@/lib/ai/agents/runtime';
import { documentStorage } from './storage';
import { documentParseInputSchema } from './schemas';
import { documentValidate } from './actions';

const QUEUE_NAME = 'document-processing';
const LAUNCH_LOCK_SECONDS = 15 * 60;
const WAITING_RELAUNCH_SECONDS = 2 * 60;
const ACTIVE_STALE_MS = 12 * 60_000;
const jobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 10_000 },
};

const stagedFileSchema = z.object({
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
  storageKey: z.string().min(1),
}).strict();

const documentJobSchema = z.object({
  schemaVersion: z.literal(1),
  organizationKey: z.string().min(1),
  agentKey: z.string().min(1),
  authenticatedUserKey: z.string().min(1),
  input: z.object({
    scopeKey: z.string().min(1),
    folderKey: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    file: stagedFileSchema,
  }).strict(),
}).strict();

export type DocumentProcessingJob = z.infer<typeof documentJobSchema>;
type DocumentProcessingResult = { success: true; data: unknown } | { success: false; error: ContentErrorShape };
export type DocumentProcessingStatus = {
  key: string;
  state: 'waiting' | 'active' | 'delayed';
} | DocumentProcessingResult;

function queueConnection() {
  return createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
}

let queue: Queue<DocumentProcessingJob, DocumentProcessingResult> | undefined;
let jobRedis: ReturnType<typeof createRedisConnection> | undefined;

function jobRedisConnection() {
  return jobRedis ??= queueConnection();
}

function processingQueue() {
  return queue ??= new Queue<DocumentProcessingJob, DocumentProcessingResult>(QUEUE_NAME, { connection: queueConnection() });
}

export function documentFargateConfigured(): boolean {
  return computeDispatchConfigured() && Boolean(process.env.JOB_REDIS_URL?.trim());
}

function stableJobId(organizationKey: string, agentKey: string, authenticatedUserKey: string, idempotencyKey: string, requestHash: string) {
  return createHash('sha256')
    .update(organizationKey).update('\0')
    .update(agentKey).update('\0')
    .update(authenticatedUserKey).update('\0')
    .update(idempotencyKey).update('\0')
    .update(requestHash)
    .digest('hex');
}

export function documentProcessingJobId(input: {
  organizationKey: string;
  agentKey: string;
  authenticatedUserKey: string;
  idempotencyKey: string;
  scopeKey: string;
  folderKey?: string;
  name?: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const requestHash = createHash('sha256')
    .update(input.scopeKey).update('\0')
    .update(input.folderKey ?? '').update('\0')
    .update(input.name ?? '').update('\0')
    .update(input.mimeType).update('\0')
    .update(input.bytes)
    .digest('hex');
  return stableJobId(input.organizationKey, input.agentKey, input.authenticatedUserKey, input.idempotencyKey, requestHash);
}

async function launchWorker(jobId: string): Promise<void> {
  const launchLock = `document-processing:launch:${jobId}`;
  const acquired = await jobRedisConnection().set(launchLock, randomUUID(), 'EX', LAUNCH_LOCK_SECONDS, 'NX');
  if (!acquired) return;
  try {
    await computeDispatch({ jobType: 'document-processing', jobKey: jobId });
  } catch (error) {
    await jobRedisConnection().del(launchLock).catch(() => undefined);
    throw error;
  }
}

async function recoverWorker(job: Job<DocumentProcessingJob, DocumentProcessingResult>, state: string): Promise<void> {
  const jobId = z.string().parse(job.id);
  const launchLock = `document-processing:launch:${jobId}`;
  if (state === 'active') {
    if (job.processedOn && Date.now() - job.processedOn >= ACTIVE_STALE_MS) {
      await jobRedisConnection().del(launchLock);
      await launchWorker(jobId);
    }
    return;
  }
  const ttl = await jobRedisConnection().ttl(launchLock);
  if (ttl >= 0 && ttl <= LAUNCH_LOCK_SECONDS - WAITING_RELAUNCH_SECONDS) await jobRedisConnection().del(launchLock);
  await launchWorker(jobId);
}

export async function enqueueDocumentProcessing(input: {
  organizationKey: string;
  agentKey: string;
  authenticatedUserKey: string;
  document: unknown;
  maxBytes: number;
}): Promise<DocumentProcessingStatus> {
  const parsed = documentParseInputSchema.parse(input.document);
  const idempotencyKey = parsed.idempotencyKey ?? randomUUID();
  const normalized = await documentValidate(parsed, { maxBytes: input.maxBytes });
  const jobId = documentProcessingJobId({
    organizationKey: input.organizationKey,
    agentKey: input.agentKey,
    authenticatedUserKey: input.authenticatedUserKey,
    idempotencyKey,
    scopeKey: normalized.scopeKey,
    folderKey: normalized.folderKey,
    name: parsed.name,
    mimeType: normalized.mimeType,
    bytes: normalized.fileInput,
  });
  const idempotencyIdentity = createHash('sha256')
    .update(input.organizationKey).update('\0')
    .update(input.agentKey).update('\0')
    .update(input.authenticatedUserKey).update('\0')
    .update(idempotencyKey)
    .digest('hex');
  const idempotencyMappingKey = `document-processing:idempotency:${idempotencyIdentity}`;
  const claimed = await jobRedisConnection().set(idempotencyMappingKey, jobId, 'EX', 24 * 60 * 60, 'NX');
  if (!claimed && await jobRedisConnection().get(idempotencyMappingKey) !== jobId) {
    return { success: false, error: new ContentError('CONTENT_CONFLICT', 'Idempotency key was already used with a different upload.', 'document.parse', { action: 'idempotency' }).toJSON() };
  }
  const targetQueue = processingQueue();
  const existing = await Job.fromId<DocumentProcessingJob, DocumentProcessingResult>(targetQueue, jobId);
  if (existing && await existing.getState() === 'completed') return existing.returnvalue;
  const storageKey = `pending/document-processing/${jobId}/original.${normalized.extension}`;
  await documentStorage.upload({ key: storageKey, bytes: normalized.fileInput, mimeType: normalized.mimeType });

  const data = documentJobSchema.parse({
    schemaVersion: 1,
    organizationKey: input.organizationKey,
    agentKey: input.agentKey,
    authenticatedUserKey: input.authenticatedUserKey,
    input: {
      scopeKey: normalized.scopeKey,
      ...(normalized.folderKey ? { folderKey: normalized.folderKey } : {}),
      ...(parsed.name ? { name: parsed.name } : {}),
      idempotencyKey,
      file: { filename: 'filename' in parsed.file ? parsed.file.filename : parsed.file.name, mimeType: normalized.mimeType, sizeBytes: normalized.sizeBytes, storageKey },
    },
  });
  let job: Job<DocumentProcessingJob, DocumentProcessingResult>;
  try {
    job = existing ?? await targetQueue.add('process-document', data, { ...jobOptions, jobId });
  } catch (error) {
    await documentStorage.delete(storageKey).catch(() => undefined);
    throw error;
  }
  let state = await job.getState();
  if (state === 'failed') {
    await job.retry();
    state = 'waiting';
  }
  if (!['active', 'completed'].includes(state)) await launchWorker(jobId);
  if (state === 'completed') return job.returnvalue;
  return { key: jobId, state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
}

export async function getDocumentProcessingStatus(jobId: string, identity: {
  organizationKey: string;
  agentKey: string;
  authenticatedUserKey: string;
}): Promise<DocumentProcessingStatus | null> {
  const key = z.string().length(64).regex(/^[a-f0-9]+$/).parse(jobId);
  const job = await Job.fromId<DocumentProcessingJob, DocumentProcessingResult>(processingQueue(), key);
  if (!job) return null;
  const data = documentJobSchema.parse(job.data);
  if (data.organizationKey !== identity.organizationKey || data.agentKey !== identity.agentKey || data.authenticatedUserKey !== identity.authenticatedUserKey) return null;
  const state = await job.getState();
  if (state === 'completed') return job.returnvalue;
  if (state === 'failed') {
    return {
      success: false,
      error: contentErrorSchema.parse({ code: 'DOCUMENT_PROCESSING_FAILED', message: 'Document processing failed after retrying.', tool: 'document.parse', action: 'worker', retryable: true }),
    };
  }
  await recoverWorker(job, state);
  return { key, state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
}

async function processJob(job: Job<DocumentProcessingJob>) {
  const data = documentJobSchema.parse(job.data);
  const stored = await documentStorage.download(data.input.file.storageKey);
  if (stored.bytes.byteLength !== data.input.file.sizeBytes) throw new Error('Staged document size changed before processing.');
  const { runContentAgentTool } = await import('@/lib/ai/tools');
  try {
    const output = await runContentAgentTool({
      organizationKey: data.organizationKey,
      agentKey: data.agentKey,
      tool: 'document.parse',
      input: {
        scopeKey: data.input.scopeKey,
        ...(data.input.folderKey ? { folderKey: data.input.folderKey } : {}),
        ...(data.input.name ? { name: data.input.name } : {}),
        idempotencyKey: data.input.idempotencyKey,
        file: {
          filename: data.input.file.filename,
          mimeType: data.input.file.mimeType,
          sizeBytes: data.input.file.sizeBytes,
          bytes: stored.bytes,
        },
      },
    }, { authenticatedUserKey: data.authenticatedUserKey });
    return { success: true as const, data: output };
  } catch (error) {
    if (error instanceof ContentError && !error.retryable) return { success: false as const, error: error.toJSON() };
    if (error instanceof AgentExecutionAccessError) return { success: false as const, error: new ContentError('CONTENT_FORBIDDEN', 'Agent execution access denied.', 'document.parse', { action: 'authorization' }).toJSON() };
    if (error instanceof AgentRuntimeNotFoundError) return { success: false as const, error: new ContentError('CONTENT_NOT_FOUND', 'Agent runtime was not found.', 'document.parse', { action: 'authorization' }).toJSON() };
    throw error;
  }
}

export async function runDocumentProcessingWorker(): Promise<void> {
  const targetJobId = z.string().length(64).regex(/^[a-f0-9]+$/).parse(process.env.DOCUMENT_PROCESSING_JOB_ID);
  let worker!: Worker<DocumentProcessingJob, DocumentProcessingResult>;
  let settled = false;
  const finish = async (job: Job<DocumentProcessingJob> | undefined, failed: boolean) => {
    if (settled || !job || (failed && job.attemptsMade < (job.opts.attempts ?? 1))) return;
    settled = true;
    await documentStorage.delete(job.data.input.file.storageKey).catch(() => undefined);
    if (job.id) await jobRedisConnection().del(`document-processing:launch:${job.id}`).catch(() => undefined);
    await worker.close();
  };
  worker = new Worker<DocumentProcessingJob, DocumentProcessingResult>(QUEUE_NAME, async (job) => {
    const result = await processJob(job);
    await worker.pause(true);
    return result;
  }, {
    connection: queueConnection(),
    concurrency: 1,
    autorun: false,
    lockDuration: 10 * 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
  worker.on('completed', (job) => { void finish(job, false); });
  worker.on('failed', (job) => { void finish(job, true); });
  const idleTimeout = setTimeout(() => { if (!settled) void worker.close(); }, 5 * 60_000);
  try {
    await worker.run();
  } finally {
    clearTimeout(idleTimeout);
    if (!settled) await worker.close();
    console.info(JSON.stringify({ action: 'document.worker', status: 'stopped', targetJobId }));
  }
}
