import { createHash, randomUUID } from 'node:crypto';
import { Job, Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { ContentError, contentErrorSchema, type ContentErrorShape } from '@/lib/ai/tools/content-errors';
import { AgentExecutionAccessError } from '@/lib/ai/agents/access';
import { AgentRuntimeNotFoundError } from '@/lib/ai/agents/runtime';
import { documentStorage } from './storage';
import { documentParseInputSchema } from './schemas';
import { documentValidate } from './actions';
import { documentScanInputSchema } from '@/lib/ai/document-scanning';

const QUEUE_NAME = 'document-processing';
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

const parseDocumentJobSchema = z.object({
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

const scanDocumentJobSchema = z.object({
  schemaVersion: z.literal(2),
  tool: z.literal('document.scan'),
  organizationKey: z.string().min(1),
  agentKey: z.string().min(1),
  authenticatedUserKey: z.string().min(1),
  input: z.object({
    scopeKey: z.string().min(1),
    folderKey: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1),
    pages: z.array(stagedFileSchema).min(1).max(12),
  }).strict(),
}).strict();

const documentJobSchema = z.union([parseDocumentJobSchema, scanDocumentJobSchema]);

export type DocumentProcessingJob = z.infer<typeof documentJobSchema>;
type DocumentProcessingResult = { success: true; data: unknown } | { success: false; error: ContentErrorShape };
export type DocumentProcessingStatus = {
  key: string;
  state: 'waiting' | 'active' | 'delayed';
} | DocumentProcessingResult;

function queueConnection() {
  const redisUrl = process.env.JOB_REDIS_URL?.trim();
  if (!redisUrl) throw new Error('JOB_REDIS_URL is required for document processing.');
  return createRedisConnection(redisUrl);
}

let queue: Queue<DocumentProcessingJob, DocumentProcessingResult> | undefined;
let jobRedis: ReturnType<typeof createRedisConnection> | undefined;

function jobRedisConnection() {
  return jobRedis ??= queueConnection();
}

function processingQueue() {
  return queue ??= new Queue<DocumentProcessingJob, DocumentProcessingResult>(QUEUE_NAME, { connection: queueConnection() });
}

export function documentWorkerConfigured(): boolean {
  return process.env.DOCUMENT_WORKER_ENABLED === 'true' && Boolean(process.env.JOB_REDIS_URL?.trim());
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
  if (state === 'completed') return job.returnvalue;
  return { key: jobId, state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
}

export async function enqueueDocumentScan(input: {
  organizationKey: string;
  agentKey: string;
  authenticatedUserKey: string;
  document: unknown;
}): Promise<DocumentProcessingStatus> {
  const parsed = documentScanInputSchema.parse(input.document);
  const idempotencyKey = parsed.idempotencyKey ?? randomUUID();
  const requestHash = createHash('sha256')
    .update(parsed.scopeKey).update('\0').update(parsed.folderKey ?? '').update('\0').update(parsed.name ?? '').update('\0');
  for (const page of parsed.pages) requestHash.update(page.mimeType).update('\0').update(page.bytes);
  const jobId = stableJobId(input.organizationKey, input.agentKey, input.authenticatedUserKey, idempotencyKey, requestHash.digest('hex'));
  const identity = createHash('sha256').update(input.organizationKey).update('\0').update(input.agentKey).update('\0').update(input.authenticatedUserKey).update('\0').update(idempotencyKey).digest('hex');
  const mappingKey = `document-processing:idempotency:${identity}`;
  const claimed = await jobRedisConnection().set(mappingKey, jobId, 'EX', 24 * 60 * 60, 'NX');
  if (!claimed && await jobRedisConnection().get(mappingKey) !== jobId) return { success: false, error: new ContentError('CONTENT_CONFLICT', 'Idempotency key was already used with a different scan.', 'document.scan', { action: 'idempotency' }).toJSON() };
  const targetQueue = processingQueue();
  const existing = await Job.fromId<DocumentProcessingJob, DocumentProcessingResult>(targetQueue, jobId);
  if (existing && await existing.getState() === 'completed') return existing.returnvalue;
  const stagedPages: Array<{ filename: string; mimeType: string; sizeBytes: number; storageKey: string }> = [];
  try {
    for (const [index, page] of parsed.pages.entries()) {
      const extension = page.mimeType === 'image/png' ? 'png' : 'jpg';
      const storageKey = `pending/document-processing/${jobId}/page-${String(index + 1).padStart(2, '0')}.${extension}`;
      await documentStorage.upload({ key: storageKey, bytes: page.bytes, mimeType: page.mimeType });
      stagedPages.push({ filename: page.filename, mimeType: page.mimeType, sizeBytes: page.sizeBytes, storageKey });
    }
  } catch (error) {
    await Promise.allSettled(stagedPages.map((page) => documentStorage.delete(page.storageKey)));
    throw error;
  }
  const data = scanDocumentJobSchema.parse({ schemaVersion: 2, tool: 'document.scan', organizationKey: input.organizationKey, agentKey: input.agentKey, authenticatedUserKey: input.authenticatedUserKey, input: { scopeKey: parsed.scopeKey, ...(parsed.folderKey ? { folderKey: parsed.folderKey } : {}), ...(parsed.name ? { name: parsed.name } : {}), idempotencyKey, pages: stagedPages } });
  let job: Job<DocumentProcessingJob, DocumentProcessingResult>;
  try { job = existing ?? await targetQueue.add('scan-document', data, { ...jobOptions, jobId }); }
  catch (error) { await Promise.allSettled(stagedPages.map((page) => documentStorage.delete(page.storageKey))); throw error; }
  let state = await job.getState();
  if (state === 'failed') { await job.retry(); state = 'waiting'; }
  if (state === 'completed') return job.returnvalue;
  return { key: jobId, state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
}

export async function getDocumentProcessingStatus(jobId: string, identity: {
  organizationKey: string;
  agentKey: string;
  authenticatedUserKey: string;
  tool?: 'document.parse' | 'document.scan';
}): Promise<DocumentProcessingStatus | null> {
  const key = z.string().length(64).regex(/^[a-f0-9]+$/).parse(jobId);
  const job = await Job.fromId<DocumentProcessingJob, DocumentProcessingResult>(processingQueue(), key);
  if (!job) return null;
  const data = documentJobSchema.parse(job.data);
  if (data.organizationKey !== identity.organizationKey || data.agentKey !== identity.agentKey || data.authenticatedUserKey !== identity.authenticatedUserKey) return null;
  const tool = data.schemaVersion === 2 ? 'document.scan' : 'document.parse';
  if (identity.tool && identity.tool !== tool) return null;
  const state = await job.getState();
  if (state === 'completed') return job.returnvalue;
  if (state === 'failed') {
    return {
      success: false,
      error: contentErrorSchema.parse({ code: 'DOCUMENT_PROCESSING_FAILED', message: 'Document processing failed after retrying.', tool, action: 'worker', retryable: true }),
    };
  }
  return { key, state: state === 'active' ? 'active' : state === 'delayed' ? 'delayed' : 'waiting' };
}

async function cleanupStagedInput(data: DocumentProcessingJob) {
  const storageKeys = data.schemaVersion === 2 ? data.input.pages.map((page) => page.storageKey) : [data.input.file.storageKey];
  await Promise.allSettled(storageKeys.map((key) => documentStorage.delete(key)));
}

async function processJob(job: Job<DocumentProcessingJob>) {
  const data = documentJobSchema.parse(job.data);
  const { runContentAgentTool } = await import('@/lib/ai/tools');
  try {
    if (data.schemaVersion === 2) {
      const pages = await Promise.all(data.input.pages.map(async (page) => {
        const stored = await documentStorage.download(page.storageKey);
        if (stored.bytes.byteLength !== page.sizeBytes) throw new Error('Staged scan page size changed before processing.');
        return { filename: page.filename, mimeType: page.mimeType as 'image/jpeg' | 'image/png', sizeBytes: page.sizeBytes, bytes: stored.bytes };
      }));
      const output = await runContentAgentTool({ organizationKey: data.organizationKey, agentKey: data.agentKey, tool: 'document.scan', input: { scopeKey: data.input.scopeKey, ...(data.input.folderKey ? { folderKey: data.input.folderKey } : {}), ...(data.input.name ? { name: data.input.name } : {}), idempotencyKey: data.input.idempotencyKey, pages } }, { authenticatedUserKey: data.authenticatedUserKey });
      const result = { success: true as const, data: output };
      await cleanupStagedInput(data);
      return result;
    }
    const stored = await documentStorage.download(data.input.file.storageKey);
    if (stored.bytes.byteLength !== data.input.file.sizeBytes) throw new Error('Staged document size changed before processing.');
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
    const result = { success: true as const, data: output };
    await cleanupStagedInput(data);
    return result;
  } catch (error) {
    const tool = data.schemaVersion === 2 ? 'document.scan' : 'document.parse';
    const terminal = error instanceof ContentError && !error.retryable
      ? { success: false as const, error: error.toJSON() }
      : error instanceof AgentExecutionAccessError
        ? { success: false as const, error: new ContentError('CONTENT_FORBIDDEN', 'Agent execution access denied.', tool, { action: 'authorization' }).toJSON() }
        : error instanceof AgentRuntimeNotFoundError
          ? { success: false as const, error: new ContentError('CONTENT_NOT_FOUND', 'Agent runtime was not found.', tool, { action: 'authorization' }).toJSON() }
          : undefined;
    if (terminal) {
      await cleanupStagedInput(data);
      return terminal;
    }
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) await cleanupStagedInput(data);
    throw error;
  }
}

export async function runDocumentProcessingWorker(): Promise<void> {
  const concurrency = z.coerce.number().int().min(1).max(32).default(2).parse(process.env.DOCUMENT_WORKER_CONCURRENCY);
  const worker = new Worker<DocumentProcessingJob, DocumentProcessingResult>(QUEUE_NAME, processJob, {
    connection: queueConnection(),
    concurrency,
    lockDuration: 120_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
  worker.on('error', (error) => console.error(JSON.stringify({ action: 'document.queue.worker', status: 'error', error: error.message })));

  let resolveShutdown!: () => void;
  let rejectShutdown!: (error: unknown) => void;
  let stopping = false;
  const shutdown = new Promise<void>((resolve, reject) => { resolveShutdown = resolve; rejectShutdown = reject; });
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.info(JSON.stringify({ action: 'document.queue.worker', status: 'stopping', signal }));
    void worker.close().then(resolveShutdown, rejectShutdown);
  };
  const stopForSigterm = () => stop('SIGTERM');
  const stopForSigint = () => stop('SIGINT');
  process.once('SIGTERM', stopForSigterm);
  process.once('SIGINT', stopForSigint);
  try {
    await worker.waitUntilReady();
    console.info(JSON.stringify({ action: 'document.queue.worker', status: 'started', concurrency }));
    await shutdown;
  } finally {
    process.off('SIGTERM', stopForSigterm);
    process.off('SIGINT', stopForSigint);
    await worker.close();
    console.info(JSON.stringify({ action: 'document.queue.worker', status: 'stopped' }));
  }
}
