import { z } from 'zod';
import { createNodeHelpers } from './base';

export const BOOK_PROGRESS_COLLECTION = 'bookProgress';
export const bookProgressSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), userKey: z.string().cuid(), bookKey: z.string().cuid(), chapterKey: z.string().cuid(), progressSeconds: z.number().int().nonnegative(), isCompleted: z.boolean().default(false), completedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export type BookProgress = z.infer<typeof bookProgressSchema>;
export const bookProgressEmbeddingFields = [] as const;
const helpers = createNodeHelpers(BOOK_PROGRESS_COLLECTION, bookProgressSchema, bookProgressEmbeddingFields, { requireEmbedding: false });
export const insertBookProgress = helpers.insert;
export const getBookProgressById = helpers.getById;
export const updateBookProgress = helpers.updateById;
export const deleteBookProgress = helpers.deleteById;
export const upsertBookProgressByKey = helpers.upsertByKey;
export const getAllBookProgressChunked = helpers.getAllChunked;
export const listBookProgressPage = helpers.listPage;
