import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_CHAPTERS_COLLECTION = 'bookChapters';
export const BOOK_CHAPTER_WORD_MIN = 150;
export const BOOK_CHAPTER_WORD_MAX = 165;
export const LEGACY_BOOK_CHAPTER_WORD_MIN = 400;
export const LEGACY_BOOK_CHAPTER_WORD_MAX = 450;
export const bookChapterStatusSchema = z.enum(['planned', 'writing', 'written', 'finalizing', 'finalized', 'narrating', 'audio-ready', 'failed']);
export const bookChapterSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), partKey: z.string().cuid().optional(),
  title: z.string().trim().min(1), description: z.string().trim().min(1), objective: z.string().trim().min(1), promptGuidance: z.string().trim().min(1).optional(), topics: z.array(z.string().trim().min(1)).max(20).default([]),
  evidenceKeyPoints: z.array(z.string().trim().min(1)).min(1).max(12), priorTransition: z.string().trim().min(1), nextTransition: z.string().trim().min(1), repetitionBoundaries: z.array(z.string().trim().min(1)).min(1).max(12), targetWordMin: z.union([z.literal(BOOK_CHAPTER_WORD_MIN), z.literal(LEGACY_BOOK_CHAPTER_WORD_MIN)]), targetWordMax: z.union([z.literal(BOOK_CHAPTER_WORD_MAX), z.literal(LEGACY_BOOK_CHAPTER_WORD_MAX)]),
  content: z.string().trim().min(1).optional(), status: bookChapterStatusSchema.default('planned'), position: z.number().int().positive(), estimatedMinutes: z.number().int().nonnegative().default(0),
  summaryInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), draftInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), finalizationInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), audioInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  audioStorageKey: z.string().trim().min(1).optional(), audioDurationSeconds: z.number().int().positive().optional(), archiveDocumentKey: z.string().cuid().optional(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine((chapter, context) => {
  if (!((chapter.targetWordMin === BOOK_CHAPTER_WORD_MIN && chapter.targetWordMax === BOOK_CHAPTER_WORD_MAX) || (chapter.targetWordMin === LEGACY_BOOK_CHAPTER_WORD_MIN && chapter.targetWordMax === LEGACY_BOOK_CHAPTER_WORD_MAX))) context.addIssue({ code: 'custom', path: ['targetWordMin'], message: 'Chapter word targets must use a supported matching range.' });
});
export type BookChapter = z.infer<typeof bookChapterSchema>;
export const bookChaptersEmbeddingFields = ['title', 'description', 'objective', 'content'] as const;
const helpers = createNodeHelpers(BOOK_CHAPTERS_COLLECTION, bookChapterSchema, bookChaptersEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBookChapter = helpers.insert;
export const getBookChapterById = helpers.getById;
export const updateBookChapter = helpers.updateById;
export const deleteBookChapter = helpers.deleteById;
export const upsertBookChapterByKey = helpers.upsertByKey;
export const getAllBookChaptersChunked = helpers.getAllChunked;
export const listBookChaptersPage = helpers.listPage;
