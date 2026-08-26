import { createHash } from 'node:crypto';
import { z } from 'zod';
import { strictObject } from '@/api/validation';
import { newId } from '@/lib/ids';
import { bookProgressSchema } from '@/lib/db/book-progress.node';
import { bookGenerationInputSchema } from '@/lib/db/books.node';
import { BookRepositoryError, createBookRepository, type BookAccessContext, type BookDetailRow, type BookRepository } from './repository';
import { BOOK_GENERATION_LEASE_MS, BOOK_GENERATION_RENEW_MS } from './generation-config';

const contextShape = { organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() };
export const bookChapterCountSchema = z.union([z.literal(10), z.literal(25), z.literal(50)]);
export const bookOverviewInputSchema = strictObject(contextShape);
export const bookCreateInputSchema = strictObject({ ...contextShape, generationRequestKey: z.string().trim().min(1).max(200), ...bookGenerationInputSchema.shape });
export const bookDetailInputSchema = strictObject(contextShape);
export const bookMutationInputSchema = strictObject({ ...contextShape, requestKey: z.string().trim().min(1).max(200).optional() });
export const bookProgressInputSchema = strictObject({ ...contextShape, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() });
export type BookCreateInput = z.output<typeof bookCreateInputSchema>;
export type BookGenerationInput = Omit<BookCreateInput, 'generationRequestKey'> & { generationRequestKey?: string; generationBriefFingerprint?: string };
export interface BookGenerator { create(input: BookGenerationInput, context: BookAccessContext): Promise<string>; write(bookKey: string, input: Omit<BookCreateInput, 'generationRequestKey'>, context: BookAccessContext & { generationLeaseToken: string; persistFailure?: boolean }): Promise<void> }
export interface BookGenerationJob { schemaVersion: 1; bookKey: string; organizationKey: string; scopeKey: string; userKey: string }
type UrlSigner = (storageKey: string) => Promise<string>;
type LeaseRenewalScheduler = (renew: () => Promise<void>, milliseconds: number) => () => void;

async function bookDto(row: BookDetailRow, sign: UrlSigner) {
  const completed = row.chapters.filter(({ progress }) => progress?.isCompleted).length;
  const totalAudioSeconds = row.chapters.reduce((sum, { chapter }) => sum + (chapter.audioDurationSeconds ?? 0), 0);
  const listenedSeconds = row.chapters.reduce((sum, { chapter, progress }) => sum + (progress?.isCompleted ? chapter.audioDurationSeconds ?? progress.progressSeconds : Math.min(progress?.progressSeconds ?? 0, chapter.audioDurationSeconds ?? Number.POSITIVE_INFINITY)), 0);
  const active = row.chapters.find(({ progress }) => progress && !progress.isCompleted && progress.progressSeconds > 0)?.chapter.key ?? row.chapters.find(({ progress }) => !progress?.isCompleted)?.chapter.key ?? null;
  const voice = row.book.narratorVoiceKey ? { key: row.book.narratorVoiceKey, name: row.book.narratorVoiceKey[0]!.toUpperCase() + row.book.narratorVoiceKey.slice(1) } : undefined;
  const generationProgressPercent = row.book.generationTotalUnits ? Math.min(100, Math.round(row.book.generationCompletedUnits / row.book.generationTotalUnits * 100)) : 0;
  const book = { key: row.book.key, title: row.book.title, subtitle: row.book.subtitle ?? row.book.title, description: row.book.description, status: row.book.status, ...(voice ? { narrator: voice } : {}), ...(row.book.coverStorageKey ? { coverUrl: await sign(row.book.coverStorageKey) } : {}), estimatedMinutes: row.book.estimatedMinutes, chapterCount: row.book.chapterCount, progressPercent: totalAudioSeconds > 0 ? Math.min(100, Math.round(listenedSeconds / totalAudioSeconds * 100)) : row.chapters.length ? Math.round(completed / row.chapters.length * 100) : 0, ...(row.book.status !== 'ready' ? { generationProgressPercent } : {}), ...(row.book.generationError ? { failureMessage: row.book.generationError } : {}), ...(active ? { currentChapterKey: active } : {}) };
  return book;
}

async function detailDto(row: BookDetailRow, sign: UrlSigner) {
  const book = await bookDto(row, sign);
  const chapters = await Promise.all(row.chapters.map(async ({ chapter, progress }) => ({ key: chapter.key, title: chapter.title, description: chapter.description, ...(chapter.content ? { content: chapter.content } : {}), position: chapter.position, estimatedMinutes: chapter.estimatedMinutes, ...(chapter.audioStorageKey ? { audioUrl: await sign(chapter.audioStorageKey) } : {}), ...(chapter.imageStorageKey ? { imageUrl: await sign(chapter.imageStorageKey) } : {}), ...(chapter.audioDurationSeconds ? { audioDurationSeconds: chapter.audioDurationSeconds } : {}), progressSeconds: progress?.progressSeconds ?? 0, isCompleted: progress?.isCompleted ?? false })));
  return { book, chapters };
}

export function createBookService(options: { repository?: BookRepository; generator?: BookGenerator; enqueue?: (job: BookGenerationJob) => Promise<{ jobId: string }>; removeJob?: (bookKey: string) => Promise<void>; signUrl?: UrlSigner; publishChanged?: (scopeKey: string) => Promise<unknown>; id?: () => string; now?: () => string; leaseToken?: () => string; generationLeaseMs?: number; generationRenewMs?: number; scheduleLeaseRenewal?: LeaseRenewalScheduler } = {}) {
  const repository = options.repository ?? createBookRepository(); const id = options.id ?? newId; const now = options.now ?? (() => new Date().toISOString()); const leaseToken = options.leaseToken ?? newId; const leaseMs = options.generationLeaseMs ?? BOOK_GENERATION_LEASE_MS; const renewMs = options.generationRenewMs ?? BOOK_GENERATION_RENEW_MS; const scheduleRenewal = options.scheduleLeaseRenewal ?? ((renew, milliseconds) => { const timer = setInterval(() => void renew(), milliseconds); timer.unref(); return () => clearInterval(timer); }); const sign = options.signUrl ?? (async () => { throw new Error('Book URL signer is not configured'); }); const changed = options.publishChanged ?? (async (scopeKey) => (await import('@/api/events')).publishScopeEvent(scopeKey, 'book.changed'));
  if (renewMs <= 0 || renewMs >= leaseMs) throw new Error('Book generation renewal must be positive and shorter than the lease.');
  const access = (input: { organizationKey: string; scopeKey: string }, userKey: string): BookAccessContext => ({ ...input, userKey });
  const publish = (scopeKey: string) => changed(scopeKey).catch(() => undefined);
  const isRecoverable = (row: BookDetailRow) => row.book.generationInput !== undefined && row.book.generationOwnerKey !== undefined && !['ready', 'failed', 'cancelled'].includes(row.book.status);
  const isQueuedWithoutActiveLease = (row: BookDetailRow) => row.book.status === 'queued' && (!row.book.generationLeaseToken || !row.book.generationLeaseExpiresAt || Date.parse(row.book.generationLeaseExpiresAt) <= Date.parse(now()));
  const enqueueRow = async (row: BookDetailRow, organizationKey: string) => {
    if (!options.enqueue || !isRecoverable(row)) return false;
    await options.enqueue({ schemaVersion: 1, bookKey: row.book.key, organizationKey, scopeKey: row.book.scopeKey, userKey: row.book.generationOwnerKey! });
    return true;
  };
  return {
    async overview(raw: unknown, userKey: string) { const input = bookOverviewInputSchema.parse(raw); return { books: await Promise.all((await repository.list(access(input, userKey))).map((row) => bookDto(row, sign))) }; },
    async detail(bookKey: string, raw: unknown, userKey: string) { const input = bookDetailInputSchema.parse(raw); return detailDto(await repository.detail(access(input, userKey), bookKey), sign); },
    async create(raw: unknown, userKey: string) {
      const input = bookCreateInputSchema.parse(raw); const context = access(input, userKey); await repository.authorize(context, true);
      const { generationRequestKey, ...brief } = input; const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...fingerprintInput } = brief;
      const fingerprint = createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
      const existing = await repository.findByGenerationRequest(context, generationRequestKey);
      if (existing) {
        if (existing.book.generationBriefFingerprint !== fingerprint) throw new BookRepositoryError('conflict', 'Generation request key was reused with a different brief.');
        await enqueueRow(existing, input.organizationKey);
        return bookDto(existing, sign);
      }
      if (!options.generator || !options.enqueue) throw new Error('Book generation is not configured');
      let bookKey: string;
      try { bookKey = await options.generator.create({ ...input, generationBriefFingerprint: fingerprint }, context); }
      catch (error) { if (!(error instanceof BookRepositoryError) || error.reason !== 'conflict') throw error; const winner = await repository.findByGenerationRequest(context, generationRequestKey); if (!winner || winner.book.generationBriefFingerprint !== fingerprint) throw error; await enqueueRow(winner, input.organizationKey); return bookDto(winner, sign); }
      try { await options.enqueue({ schemaVersion: 1, bookKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey, userKey }); }
      catch (error) { await repository.updateBook(context, bookKey, { status: 'failed', generationError: 'Generation could not be queued. Retry the book when the queue is available.', updatedAt: now() }).catch(() => undefined); await publish(input.scopeKey); throw error; }
      await publish(input.scopeKey);
      return bookDto(await repository.detail(context, bookKey), sign);
    },
    async process(job: BookGenerationJob, execution: { persistFailure?: boolean } = {}) {
      const context = access(job, job.userKey); const row = await repository.detail(context, job.bookKey);
      if (row.book.status === 'ready' || row.book.status === 'cancelled') return { status: row.book.status };
      if (!row.book.generationInput || row.book.generationOwnerKey !== job.userKey || !options.generator) throw new Error('Book generation input is unavailable.');
      const token = leaseToken(); const claimedAt = now();
      if (!await repository.claimGeneration(context, job.bookKey, token, claimedAt, new Date(Date.parse(claimedAt) + leaseMs).toISOString())) throw new BookRepositoryError('conflict', 'Book generation is already active.');
      let renewal = Promise.resolve(); let renewalError: unknown; const controller = new AbortController();
      const renew = () => renewal = renewal.then(async () => { if (!await repository.renewGeneration(context, job.bookKey, token, new Date(Date.parse(now()) + leaseMs).toISOString())) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); }).catch((error) => { renewalError = error; controller.abort(); });
      const stop = scheduleRenewal(renew, renewMs);
      const cancellationTimer = setInterval(() => { void repository.isCancellationRequested(context, job.bookKey).then((cancelled) => { if (cancelled) controller.abort(); }).catch(() => undefined); }, 1_000); cancellationTimer.unref();
      try { await options.generator.write(job.bookKey, { ...job, ...row.book.generationInput }, { ...context, generationLeaseToken: token, signal: controller.signal, persistFailure: execution.persistFailure }); await renewal; if (renewalError) throw renewalError; }
      finally { clearInterval(cancellationTimer); stop(); await renewal; await repository.releaseGeneration(context, job.bookKey, token).catch(() => false); await publish(job.scopeKey); }
      return { status: (await repository.detail(context, job.bookKey)).book.status };
    },
    async recoverableJobs() { return (await repository.listRecoverableGenerations(now())).map((job) => ({ schemaVersion: 1 as const, ...job })); },
    async terminalFailure(job: BookGenerationJob) { return repository.failTerminalGeneration(job, 'Book generation failed after all retry attempts. Retry the book to continue.', now()); },
    async retry(bookKey: string, raw: unknown, userKey: string) {
      const input = bookMutationInputSchema.parse(raw); const context = access(input, userKey); let book;
      try { book = await repository.retryGeneration(context, bookKey, now()); }
      catch (error) {
        if (!(error instanceof BookRepositoryError) || error.reason !== 'conflict') throw error;
        const current = await repository.detail(context, bookKey);
        if (!isRecoverable(current) || !isQueuedWithoutActiveLease(current)) throw error;
        await enqueueRow(current, input.organizationKey); await publish(input.scopeKey); return bookDto(current, sign);
      }
      if (!options.enqueue || !book.generationOwnerKey) throw new Error('Book generation queue is not configured');
      try { await options.enqueue({ schemaVersion: 1, bookKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey, userKey: book.generationOwnerKey }); }
      catch (error) { await repository.updateBook(context, bookKey, { status: 'failed', generationError: 'Generation could not be queued. Retry the book when the queue is available.', updatedAt: now() }).catch(() => undefined); await publish(input.scopeKey); throw error; }
      await publish(input.scopeKey); return bookDto(await repository.detail(context, book.key), sign);
    },
    async cancel(bookKey: string, raw: unknown, userKey: string) { const input = bookMutationInputSchema.parse(raw); const context = access(input, userKey); await repository.cancelGeneration(context, bookKey, now()); await options.removeJob?.(bookKey).catch(() => undefined); await publish(input.scopeKey); return bookDto(await repository.detail(context, bookKey), sign); },
    async delete(bookKey: string, raw: unknown, userKey: string) { const input = bookMutationInputSchema.parse(raw); await repository.deleteBook(access(input, userKey), bookKey, now()); await options.removeJob?.(bookKey).catch(() => undefined); await publish(input.scopeKey); return { key: bookKey }; },
    async progress(bookKey: string, chapterKey: string, raw: unknown, userKey: string) { const input = bookProgressInputSchema.parse(raw); const context = access(input, userKey); const timestamp = now(); await repository.upsertProgress(context, bookKey, chapterKey, bookProgressSchema.parse({ key: id(), scopeKey: input.scopeKey, userKey, bookKey, chapterKey, progressSeconds: input.progressSeconds, isCompleted: input.isCompleted, completedAt: input.isCompleted ? timestamp : null, createdAt: timestamp, updatedAt: timestamp })); const detail = await detailDto(await repository.detail(context, bookKey), sign); return { book: detail.book, chapter: detail.chapters.find((chapter) => chapter.key === chapterKey)! }; },
  };
}
export type BookService = ReturnType<typeof createBookService>;
