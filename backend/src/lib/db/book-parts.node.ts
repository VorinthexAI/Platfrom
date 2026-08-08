import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_PARTS_COLLECTION = 'bookParts';
export const bookPartSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), title: z.string().trim().min(1), description: z.string().trim().min(1), objective: z.string().trim().min(1), position: z.number().int().positive(), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime() });
export type BookPart = z.infer<typeof bookPartSchema>;
export const bookPartsEmbeddingFields = ['title', 'description', 'objective'] as const;
const helpers = createNodeHelpers(BOOK_PARTS_COLLECTION, bookPartSchema, bookPartsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBookPart = helpers.insert;
export const getBookPartById = helpers.getById;
export const updateBookPart = helpers.updateById;
export const deleteBookPart = helpers.deleteById;
export const upsertBookPartByKey = helpers.upsertByKey;
export const getAllBookPartsChunked = helpers.getAllChunked;
export const listBookPartsPage = helpers.listPage;
