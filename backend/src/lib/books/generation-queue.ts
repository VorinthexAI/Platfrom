import { Queue, Worker, type JobsOptions } from 'bullmq';
import { z } from 'zod';
import { createRedisConnection } from '@/lib/redis';
import type { BookGenerationJob, BookService } from './service';
import { BOOK_GENERATION_RETRY_ATTEMPTS, BOOK_GENERATION_RETRY_DELAY_MS } from './generation-config';

const QUEUE_NAME = 'book-generation';
export const bookGenerationJobSchema = z.object({ schemaVersion: z.literal(1), bookKey: z.string().cuid(), organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid() }).strict();
export const bookGenerationJobOptions: JobsOptions = { attempts: BOOK_GENERATION_RETRY_ATTEMPTS, backoff: { type: 'fixed', delay: BOOK_GENERATION_RETRY_DELAY_MS }, removeOnComplete: { age: 7 * 24 * 60 * 60, count: 10_000 }, removeOnFail: { age: 30 * 24 * 60 * 60, count: 10_000 } };
const connection = () => createRedisConnection(process.env.JOB_REDIS_URL ?? process.env.REDIS_URL);
let queue: Queue<BookGenerationJob> | undefined;
function getQueue() { if (!queue) { queue = new Queue<BookGenerationJob>(QUEUE_NAME, { connection: connection() }); queue.on('error', (error) => console.error('book generation queue error', { error })); } return queue; }

type BookQueue = Pick<Queue<BookGenerationJob>, 'getJob' | 'add'>;
export async function enqueueBookGenerationIn(target: BookQueue, raw: BookGenerationJob) { const job = bookGenerationJobSchema.parse(raw); const existing = await target.getJob(job.bookKey); if (existing) { const state = await existing.getState(); if (['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'].includes(state)) return { jobId: existing.id! }; await existing.remove(); } const queued = await target.add('generate-book-v1', job, { ...bookGenerationJobOptions, jobId: job.bookKey }); return { jobId: queued.id! }; }
export async function enqueueBookGeneration(raw: BookGenerationJob) { return enqueueBookGenerationIn(getQueue(), raw); }
export async function removeBookGenerationJob(bookKey: string) { const job = await getQueue().getJob(z.string().cuid().parse(bookKey)); if (!job) return; const state = await job.getState(); if (state !== 'active') await job.remove(); }
export async function processBookGenerationJob(job: { data: BookGenerationJob; attemptsMade: number; opts: { attempts?: number } }, service: Pick<BookService, 'process' | 'terminalFailure'>) { const data = bookGenerationJobSchema.parse(job.data); try { return await service.process(data, { persistFailure: false }); } catch (error) { if (job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1)) await service.terminalFailure(data).catch((failureError) => console.error('audio book terminal failure persistence failed', { error: failureError, bookKey: data.bookKey })); throw error; } }
export function startBookGenerationWorker() { const worker = new Worker<BookGenerationJob>(QUEUE_NAME, async (job) => processBookGenerationJob(job, (await import('./default-service')).defaultBookService), { connection: connection(), concurrency: 2 }); worker.on('error', (error) => console.error('book generation worker error', { error })); return { close: () => worker.close() }; }
export async function recoverBookGenerationQueue() { const service = (await import('./default-service')).defaultBookService; const jobs = await service.recoverableJobs(); let enqueued = 0; for (const job of jobs) { await enqueueBookGeneration(job); enqueued += 1; } return { recovered: enqueued }; }
export function startBookGenerationRecoveryScheduler(options: { intervalMs?: number; recover?: typeof recoverBookGenerationQueue } = {}) {
  const recover = options.recover ?? recoverBookGenerationQueue;
  let running: Promise<void> | undefined;
  const run = () => {
    if (running) return running;
    running = recover()
      .then(() => undefined)
      .catch((error) => console.error('book generation queue recovery failed', { error }))
      .finally(() => { running = undefined; });
    return running;
  };
  void run();
  const timer = setInterval(() => void run(), options.intervalMs ?? 60_000);
  timer.unref();
  return { close: () => clearInterval(timer), run };
}
export async function closeBookGenerationQueue() { await queue?.close(); queue = undefined; }
