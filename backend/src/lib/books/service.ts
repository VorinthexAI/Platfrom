import { createHash } from 'node:crypto';
import { z } from 'zod';
import { strictObject } from '@/api/validation';
import { newId } from '@/lib/ids';
import { bookProgressSchema } from '@/lib/db/book-progress.node';
import { BookRepositoryError, createBookRepository, type BookAccessContext, type BookDetailRow, type BookRepository } from './repository';

const contextShape = { organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() };
export const bookLengthSchema = z.enum(['short', 'standard', 'deep']);
export const bookOverviewInputSchema = strictObject(contextShape);
export const bookCreateInputSchema = strictObject({ ...contextShape, generationRequestKey: z.string().trim().min(1).max(200), topic: z.string().trim().min(3).max(2_000), goal: z.string().trim().min(3).max(2_000), audience: z.string().trim().min(2).max(1_000), tone: z.string().trim().min(2).max(200), length: bookLengthSchema, language: z.string().trim().min(2).max(100), sourceNotes: z.string().trim().max(12_000).optional() });
export const bookDetailInputSchema = strictObject(contextShape);
export const bookProgressInputSchema = strictObject({ ...contextShape, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() });
export type BookCreateInput = z.output<typeof bookCreateInputSchema>;

type BookGenerationInput = Omit<BookCreateInput, 'generationRequestKey'> & { generationRequestKey?: string; generationBriefFingerprint?: string };
export interface BookGenerator { create(input: BookGenerationInput, context: BookAccessContext): Promise<string>; write(bookKey: string, input: Omit<BookCreateInput, 'generationRequestKey'>, context: BookAccessContext & { generationLeaseToken: string }): Promise<void> }
type UrlSigner = (storageKey: string) => Promise<string>;
type LeaseRenewalScheduler = (renew: () => Promise<void>, milliseconds: number) => () => void;

async function dto(row: BookDetailRow, sign: UrlSigner) {
  const completed = row.chapters.filter(({ progress }) => progress?.isCompleted).length;
  const active = row.chapters.find(({ progress }) => progress && !progress.isCompleted && progress.progressSeconds > 0)?.chapter.key ?? row.chapters.find(({ progress }) => !progress?.isCompleted)?.chapter.key ?? null;
  const book = { key: row.book.key, title: row.book.title, subtitle: row.book.subtitle ?? row.book.title, description: row.book.description, status: row.book.status, ...(row.book.coverStorageKey ? { coverUrl: await sign(row.book.coverStorageKey) } : {}), estimatedMinutes: row.book.estimatedMinutes, chapterCount: row.chapters.length, progressPercent: row.chapters.length ? Math.round(completed / row.chapters.length * 100) : 0, ...(active ? { currentChapterKey: active } : {}) };
  const chapters = await Promise.all(row.chapters.map(async ({ chapter, progress }) => ({ key: chapter.key, title: chapter.title, description: chapter.description, ...(chapter.content ? { content: chapter.content } : {}), position: chapter.position, estimatedMinutes: chapter.estimatedMinutes, ...(chapter.audioStorageKey ? { audioUrl: await sign(chapter.audioStorageKey) } : {}), ...(chapter.audioDurationSeconds ? { audioDurationSeconds: chapter.audioDurationSeconds } : {}), progressSeconds: progress?.progressSeconds ?? 0, isCompleted: progress?.isCompleted ?? false })));
  return { book, chapters };
}

export function createBookService(options: { repository?: BookRepository; generator?: BookGenerator; signUrl?: UrlSigner; id?: () => string; now?: () => string; sleep?: (milliseconds: number) => Promise<void>; leaseToken?: () => string; generationLeaseMs?: number; generationPollMs?: number; generationRenewMs?: number; scheduleLeaseRenewal?: LeaseRenewalScheduler } = {}) {
  const repository = options.repository ?? createBookRepository(); const id = options.id ?? newId; const now = options.now ?? (() => new Date().toISOString()); const sleep = options.sleep ?? ((milliseconds) => Bun.sleep(milliseconds)); const leaseToken = options.leaseToken ?? newId; const leaseMs = options.generationLeaseMs ?? 30 * 60_000; const pollMs = options.generationPollMs ?? 1_000; const renewMs = options.generationRenewMs ?? Math.max(1, Math.floor(leaseMs / 3)); const scheduleRenewal = options.scheduleLeaseRenewal ?? ((renew, milliseconds) => { const timer = setInterval(() => { void renew(); }, milliseconds); timer.unref(); return () => clearInterval(timer); }); const sign = options.signUrl ?? (async () => { throw new Error('Book URL signer is not configured'); });
  if (!Number.isFinite(leaseMs) || leaseMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0 || !Number.isFinite(renewMs) || renewMs <= 0 || renewMs >= leaseMs) throw new Error('Book generation lease, renewal, and poll durations must be positive, with renewal shorter than the lease.');
  const access = (input: { organizationKey: string; scopeKey: string }, userKey: string): BookAccessContext => ({ ...input, userKey });
  return {
    async overview(raw: unknown, userKey: string) { const input = bookOverviewInputSchema.parse(raw); const rows = await repository.list(access(input, userKey)); return { books: await Promise.all(rows.map(async (row) => (await dto(row, sign)).book)) }; },
    async detail(bookKey: string, raw: unknown, userKey: string) { const input = bookDetailInputSchema.parse(raw); return dto(await repository.detail(access(input, userKey), bookKey), sign); },
    async create(raw: unknown, userKey: string) {
      const input = bookCreateInputSchema.parse(raw); const context = access(input, userKey); await repository.authorize(context, true);
      const { generationRequestKey: _generationRequestKey, ...brief } = input;
      const { organizationKey: _organizationKey, scopeKey: _scopeKey, ...generationBrief } = brief;
      let fingerprint: string | undefined;
      const getFingerprint = () => fingerprint ??= createHash('sha256').update(JSON.stringify(generationBrief)).digest('hex');
      const validateFingerprint = (row: BookDetailRow) => {
        if (row.book.generationBriefFingerprint === undefined) {
          if (row.book.status === 'ready') return;
          throw new BookRepositoryError('conflict', 'Cannot resume legacy book generation because the original brief cannot be verified.');
        } else if (row.book.generationBriefFingerprint !== getFingerprint()) throw new BookRepositoryError('conflict', 'Generation request key was reused with a different brief.');
      };
      const finish = async (row: BookDetailRow) => {
        validateFingerprint(row);
        if (row.book.status === 'ready') return (await dto(row, sign)).book;
        if (!options.generator) throw new Error('Book generator is not configured');
        while (true) {
          const token = leaseToken(); const claimedAt = now(); const expiresAt = new Date(Date.parse(claimedAt) + leaseMs).toISOString();
          if (await repository.claimGeneration(context, row.book.key, token, claimedAt, expiresAt)) {
            let renewal = Promise.resolve(); let renewalError: unknown;
            const renew = () => renewal = renewal.then(async () => {
              if (renewalError) return;
              const renewalExpiresAt = new Date(Date.parse(now()) + leaseMs).toISOString();
              if (!await repository.renewGeneration(context, row.book.key, token, renewalExpiresAt)) throw new BookRepositoryError('conflict', 'Book generation lease was lost.');
            }).catch((error) => { renewalError = error; });
            const stopRenewal = scheduleRenewal(renew, renewMs);
            try {
              await options.generator.write(row.book.key, brief, { ...context, generationLeaseToken: token });
            } finally {
              stopRenewal();
              await renewal;
              await repository.releaseGeneration(context, row.book.key, token).catch(() => false);
            }
            if (renewalError) throw renewalError;
            const completed = await repository.detail(context, row.book.key); validateFingerprint(completed);
            if (completed.book.status === 'ready') return (await dto(completed, sign)).book;
            row = completed;
            continue;
          }
          const current = await repository.detail(context, row.book.key); validateFingerprint(current);
          if (current.book.status === 'ready') return (await dto(current, sign)).book;
          const remaining = current.book.generationLeaseExpiresAt ? Date.parse(current.book.generationLeaseExpiresAt) - Date.parse(now()) : pollMs;
          await sleep(Math.max(1, Math.min(pollMs, remaining > 0 ? remaining : 1)));
          row = await repository.detail(context, row.book.key); validateFingerprint(row);
          if (row.book.status === 'ready') return (await dto(row, sign)).book;
        }
      };
      const existing = await repository.findByGenerationRequest(context, input.generationRequestKey);
      if (existing) return finish(existing);
      if (!options.generator) throw new Error('Book generator is not configured');
      let bookKey: string;
      try {
        bookKey = await options.generator.create({ ...input, generationBriefFingerprint: getFingerprint() }, context);
      } catch (error) {
        if (!(error instanceof BookRepositoryError) || error.reason !== 'conflict') throw error;
        const winner = await repository.findByGenerationRequest(context, input.generationRequestKey);
        if (!winner) throw error;
        return finish(winner);
      }
      return finish(await repository.detail(context, bookKey));
    },
    async progress(bookKey: string, chapterKey: string, raw: unknown, userKey: string) { const input = bookProgressInputSchema.parse(raw); const context = access(input, userKey); const timestamp = now(); await repository.upsertProgress(context, bookKey, chapterKey, bookProgressSchema.parse({ key: id(), scopeKey: input.scopeKey, userKey, bookKey, chapterKey, progressSeconds: input.progressSeconds, isCompleted: input.isCompleted, completedAt: input.isCompleted ? timestamp : null, createdAt: timestamp, updatedAt: timestamp })); const detail = await dto(await repository.detail(context, bookKey), sign); return { book: detail.book, chapter: detail.chapters.find((chapter) => chapter.key === chapterKey)! }; },
  };
}
export type BookService = ReturnType<typeof createBookService>;
