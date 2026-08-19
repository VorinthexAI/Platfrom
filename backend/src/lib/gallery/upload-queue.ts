import { createHash } from 'node:crypto';
import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { getDefaultGalleryRepository } from './repository';
import { processGalleryUploadBatch } from './upload-processing';

const QUEUE_NAME = 'gallery-upload-processing';
export const GALLERY_UPLOAD_PROCESSING_LEASE_MS = 30 * 60_000;
export const galleryUploadJobSchema = z.object({ schemaVersion: z.literal(1), uploadKeys: z.array(z.string().cuid()).min(1).max(20).refine((keys) => new Set(keys).size === keys.length, 'Upload keys must be unique.') }).strict();
type GalleryUploadJob = z.infer<typeof galleryUploadJobSchema>;
type GalleryUploadResult = { processed: number };
const options: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: { age: 7 * 24 * 60 * 60, count: 25_000 },
  removeOnFail: { age: 14 * 24 * 60 * 60, count: 25_000 },
};
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<GalleryUploadJob, GalleryUploadResult> | undefined;

function getQueue() {
  if (queue) return queue;
  queue = new Queue<GalleryUploadJob, GalleryUploadResult>(QUEUE_NAME, { connection: connection() });
  queue.on('error', (error) => console.error('gallery upload queue error', { error }));
  return queue;
}

function jobId(uploadKeys: readonly string[]) {
  return createHash('sha256').update([...uploadKeys].sort().join('\0')).digest('hex');
}

export function galleryUploadFailureStatus(attemptsMade: number, attempts: number | undefined) {
  return attemptsMade + 1 < Number(attempts ?? 1) ? 'queued' as const : 'failed' as const;
}

export function galleryUploadStaleBefore(now: Date) {
  return new Date(now.getTime() - GALLERY_UPLOAD_PROCESSING_LEASE_MS).toISOString();
}

export async function enqueueGalleryUploadBatch(uploadKeys: readonly string[]) {
  const job = galleryUploadJobSchema.parse({ schemaVersion: 1, uploadKeys: [...new Set(uploadKeys)] });
  const targetQueue = getQueue();
  const id = jobId(job.uploadKeys);
  const existing = await targetQueue.getJob(id);
  if (existing && await existing.getState() === 'failed') await existing.remove();
  const queued = await targetQueue.add('process-upload-batch', job, { ...options, jobId: id });
  return { jobId: queued.id! };
}

export function startGalleryUploadWorker() {
  const worker = new Worker<GalleryUploadJob, GalleryUploadResult>(QUEUE_NAME, (job) => processGalleryUploadBatch(galleryUploadJobSchema.parse(job.data).uploadKeys, {
    failureStatus: galleryUploadFailureStatus(job.attemptsMade, job.opts.attempts),
  }), { connection: connection(), concurrency: 2 });
  worker.on('error', (error) => console.error('gallery upload worker error', { error }));
  return { close: () => worker.close() };
}

export async function recoverGalleryUploadQueue() {
  const targetQueue = getQueue();
  const existingJobs = await targetQueue.getJobs(['active', 'delayed', 'prioritized', 'waiting', 'waiting-children'], 0, -1, true);
  const alreadyQueued = new Set(existingJobs.flatMap((job) => {
    const parsed = galleryUploadJobSchema.safeParse(job.data);
    return parsed.success ? parsed.data.uploadKeys : [];
  }));
  const now = new Date();
  const recovered = await getDefaultGalleryRepository().recoverUploadQueue(galleryUploadStaleBefore(now), now.toISOString());
  await Promise.all(recovered.storageKeys.map((key) => documentStorage.delete(key).catch(() => undefined)));
  const uploads = recovered.uploads.filter(({ key }) => !alreadyQueued.has(key));
  const groups = new Map<string, string[]>();
  for (const upload of uploads) {
    const key = `${upload.organizationKey}:${upload.scopeKey}:${upload.actorKey}`;
    const keys = groups.get(key) ?? [];
    keys.push(upload.key);
    groups.set(key, keys);
  }
  let enqueued = 0;
  for (const keys of groups.values()) {
    for (let index = 0; index < keys.length; index += 20) {
      await enqueueGalleryUploadBatch(keys.slice(index, index + 20));
      enqueued += 1;
    }
  }
  return { uploads: uploads.length, batches: enqueued };
}

export async function closeGalleryUploadQueue() {
  await queue?.close();
  queue = undefined;
}
