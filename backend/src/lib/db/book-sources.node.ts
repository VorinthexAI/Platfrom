import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const BOOK_SOURCES_COLLECTION = 'bookSources';
export const bookSourceTypeSchema = z.enum(['document', 'image', 'collection', 'place', 'trip', 'book', 'web']);
export const bookSourceSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), bookKey: z.string().cuid(), sourceType: bookSourceTypeSchema,
  sourceKey: z.string().cuid().optional(), url: z.string().url().optional(), title: z.string().trim().min(1), content: z.string().trim().min(1),
  relevance: z.string().trim().min(1), embedding: currentEmbeddingSchema, createdAt: z.string().datetime(),
}).superRefine((source, context) => {
  if (source.sourceType === 'web') {
    if (!source.url) context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Web sources require url.' });
    if (source.sourceKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceKey'], message: 'Web sources must not use sourceKey.' });
  } else {
    if (!source.sourceKey) context.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceKey'], message: 'Internal sources require sourceKey.' });
    if (source.url) context.addIssue({ code: z.ZodIssueCode.custom, path: ['url'], message: 'Internal sources must not use url.' });
  }
});
export type BookSource = z.infer<typeof bookSourceSchema>;
export const bookSourcesEmbeddingFields = ['title', 'content', 'relevance'] as const;
const helpers = createNodeHelpers(BOOK_SOURCES_COLLECTION, bookSourceSchema, bookSourcesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertBookSource = helpers.insert;
export const getBookSourceById = helpers.getById;
export const updateBookSource = helpers.updateById;
export const deleteBookSource = helpers.deleteById;
export const upsertBookSourceByKey = helpers.upsertByKey;
export const getAllBookSourcesChunked = helpers.getAllChunked;
export const listBookSourcesPage = helpers.listPage;
