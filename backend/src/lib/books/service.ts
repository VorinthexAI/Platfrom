import { z } from 'zod';
import { strictObject } from '@/api/validation';
import { newId } from '@/lib/ids';
import { bookProgressSchema } from '@/lib/db/book-progress.node';
import { createBookRepository, type BookAccessContext, type BookDetailRow, type BookRepository } from './repository';

const contextShape = { organizationKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid() };
export const bookLengthSchema = z.enum(['short', 'standard', 'deep']);
export const bookOverviewInputSchema = strictObject(contextShape);
export const bookCreateInputSchema = strictObject({ ...contextShape, generationRequestKey: z.string().trim().min(1).max(200), topic: z.string().trim().min(3).max(2_000), goal: z.string().trim().min(3).max(2_000), audience: z.string().trim().min(2).max(1_000), tone: z.string().trim().min(2).max(200), length: bookLengthSchema, language: z.string().trim().min(2).max(100), sourceNotes: z.string().trim().max(12_000).optional() });
export const bookDetailInputSchema = strictObject(contextShape);
export const bookProgressInputSchema = strictObject({ ...contextShape, progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean() });
export type BookCreateInput = z.output<typeof bookCreateInputSchema>;

type BookGenerationInput = Omit<BookCreateInput, 'generationRequestKey'> & { generationRequestKey?: string };
export interface BookGenerator { create(input: BookGenerationInput, context: BookAccessContext): Promise<string>; write(bookKey: string, input: Omit<BookCreateInput, 'generationRequestKey'>, context: BookAccessContext): Promise<void> }
type UrlSigner = (storageKey: string) => Promise<string>;

async function dto(row: BookDetailRow, sign: UrlSigner) {
  const completed = row.chapters.filter(({ progress }) => progress?.isCompleted).length;
  const active = row.chapters.find(({ progress }) => progress && !progress.isCompleted && progress.progressSeconds > 0)?.chapter.key ?? row.chapters.find(({ progress }) => !progress?.isCompleted)?.chapter.key ?? null;
  const book = { key: row.book.key, title: row.book.title, subtitle: row.book.subtitle ?? row.book.title, description: row.book.description, status: row.book.status, ...(row.book.coverStorageKey ? { coverUrl: await sign(row.book.coverStorageKey) } : {}), estimatedMinutes: row.book.estimatedMinutes, chapterCount: row.chapters.length, progressPercent: row.chapters.length ? Math.round(completed / row.chapters.length * 100) : 0, ...(active ? { currentChapterKey: active } : {}) };
  const chapters = await Promise.all(row.chapters.map(async ({ chapter, progress }) => ({ key: chapter.key, title: chapter.title, description: chapter.description, ...(chapter.content ? { content: chapter.content } : {}), position: chapter.position, estimatedMinutes: chapter.estimatedMinutes, ...(chapter.audioStorageKey ? { audioUrl: await sign(chapter.audioStorageKey) } : {}), ...(chapter.audioDurationSeconds ? { audioDurationSeconds: chapter.audioDurationSeconds } : {}), progressSeconds: progress?.progressSeconds ?? 0, isCompleted: progress?.isCompleted ?? false })));
  return { book, chapters };
}

export function createBookService(options: { repository?: BookRepository; generator?: BookGenerator; signUrl?: UrlSigner; id?: () => string; now?: () => string } = {}) {
  const repository = options.repository ?? createBookRepository(); const id = options.id ?? newId; const now = options.now ?? (() => new Date().toISOString()); const sign = options.signUrl ?? (async () => { throw new Error('Book URL signer is not configured'); });
  const access = (input: { organizationKey: string; scopeKey: string }, userKey: string): BookAccessContext => ({ ...input, userKey });
  return {
    async overview(raw: unknown, userKey: string) { const input = bookOverviewInputSchema.parse(raw); const rows = await repository.list(access(input, userKey)); return { books: await Promise.all(rows.map(async (row) => (await dto(row, sign)).book)) }; },
    async detail(bookKey: string, raw: unknown, userKey: string) { const input = bookDetailInputSchema.parse(raw); return dto(await repository.detail(access(input, userKey), bookKey), sign); },
    async create(raw: unknown, userKey: string) { const input = bookCreateInputSchema.parse(raw); const context = access(input, userKey); await repository.authorize(context, true); const existing = await repository.findByGenerationRequest(context, input.generationRequestKey); if (existing) return (await dto(existing, sign)).book; if (!options.generator) throw new Error('Book generator is not configured'); const bookKey = await options.generator.create(input, context); const { generationRequestKey: _generationRequestKey, ...brief } = input; await options.generator.write(bookKey, brief, context); return (await dto(await repository.detail(context, bookKey), sign)).book; },
    async progress(bookKey: string, chapterKey: string, raw: unknown, userKey: string) { const input = bookProgressInputSchema.parse(raw); const context = access(input, userKey); const timestamp = now(); await repository.upsertProgress(context, bookKey, chapterKey, bookProgressSchema.parse({ key: id(), scopeKey: input.scopeKey, userKey, bookKey, chapterKey, progressSeconds: input.progressSeconds, isCompleted: input.isCompleted, completedAt: input.isCompleted ? timestamp : null, createdAt: timestamp, updatedAt: timestamp })); const detail = await dto(await repository.detail(context, bookKey), sign); return { book: detail.book, chapter: detail.chapters.find((chapter) => chapter.key === chapterKey)! }; },
  };
}
export type BookService = ReturnType<typeof createBookService>;
