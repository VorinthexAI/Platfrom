import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_CHAPTERS_COLLECTION = 'bookChapters';
export const bookChapterStatusSchema = z.enum(['planned', 'writing', 'written', 'finalizing', 'finalized', 'narrating', 'audio-ready', 'failed']);
export const bookChapterSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), partKey: z.string().cuid().optional(),
  title: z.string().trim().min(1), description: z.string().trim().min(1), objective: z.string().trim().min(1), topics: z.array(z.string().trim().min(1)).max(20).default([]),
  evidenceKeyPoints: z.array(z.string().trim().min(1)).min(1).max(12), priorTransition: z.string().trim().min(1), nextTransition: z.string().trim().min(1), repetitionBoundaries: z.array(z.string().trim().min(1)).min(1).max(12), targetWordMin: z.literal(500), targetWordMax: z.literal(750),
  content: z.string().trim().min(1).optional(), status: bookChapterStatusSchema.default('planned'), position: z.number().int().positive(), estimatedMinutes: z.number().int().nonnegative().default(0),
  draftInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), finalizationInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), audioInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), imageInputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  audioStorageKey: z.string().trim().min(1).optional(), audioDurationSeconds: z.number().int().positive().optional(), imageStorageKey: z.string().trim().min(1).optional(), archiveDocumentKey: z.string().cuid().optional(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
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
