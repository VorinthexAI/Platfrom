import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOKS_COLLECTION = 'books';
export const bookStatusSchema = z.enum(['planning', 'researching', 'generating', 'ready', 'failed']);
export const bookSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), title: z.string().trim().min(1), subtitle: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1), goal: z.string().trim().min(1), audience: z.string().trim().min(1), outcome: z.string().trim().min(1),
  language: z.string().trim().min(1), generationRequestKey: z.string().trim().min(1).max(200).optional(), generationBriefFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  generationLeaseToken: z.string().trim().min(1).max(200).optional(), generationLeaseExpiresAt: z.string().datetime().optional(), coverStorageKey: z.string().trim().min(1).optional(), estimatedMinutes: z.number().int().nonnegative().default(0),
  chapterCount: z.number().int().nonnegative().default(0), isFavorite: z.boolean().default(false), status: bookStatusSchema, embedding: currentEmbeddingSchema,
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Book = z.infer<typeof bookSchema>;
export const booksEmbeddingFields = ['title', 'subtitle', 'description', 'goal', 'audience', 'outcome'] as const;
const helpers = createNodeHelpers(BOOKS_COLLECTION, bookSchema, booksEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBook = helpers.insert;
export const getBookById = helpers.getById;
export const updateBook = helpers.updateById;
export const deleteBook = helpers.deleteById;
export const upsertBookByKey = helpers.upsertByKey;
export const getAllBooksChunked = helpers.getAllChunked;
export const listBooksPage = helpers.listPage;
