import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_CHAPTERS_COLLECTION = 'bookChapters';
export const bookChapterSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), partKey: z.string().cuid().optional(),
  title: z.string().trim().min(1), description: z.string().trim().min(1), objective: z.string().trim().min(1), content: z.string().trim().min(1),
  position: z.number().int().positive(), estimatedMinutes: z.number().int().positive(), audioStorageKey: z.string().trim().min(1),
  audioDurationSeconds: z.number().int().positive(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
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
