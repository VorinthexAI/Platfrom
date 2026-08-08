import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_CONTEXTS_COLLECTION = 'bookContexts';
const context = z.string().trim().min(1);
export const bookContextSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), userContext: context, priorKnowledge: context,
  priorBookContext: context, personalizationContext: context, researchContext: context, noveltyContext: context, generationBrief: context,
  embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type BookContext = z.infer<typeof bookContextSchema>;
export const bookContextsEmbeddingFields = ['userContext', 'priorKnowledge', 'priorBookContext', 'personalizationContext', 'researchContext', 'noveltyContext', 'generationBrief'] as const;
const helpers = createNodeHelpers(BOOK_CONTEXTS_COLLECTION, bookContextSchema, bookContextsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBookContext = helpers.insert;
export const getBookContextById = helpers.getById;
export const updateBookContext = helpers.updateById;
export const deleteBookContext = helpers.deleteById;
export const upsertBookContextByKey = helpers.upsertByKey;
export const getAllBookContextsChunked = helpers.getAllChunked;
export const listBookContextsPage = helpers.listPage;
