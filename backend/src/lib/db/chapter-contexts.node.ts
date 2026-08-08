import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const CHAPTER_CONTEXTS_COLLECTION = 'chapterContexts';
const context = z.string().trim().min(1);
export const chapterContextSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), chapterKey: z.string().cuid(), previousContext: context, objectiveContext: context,
  sourceContext: context, personalizationContext: context, noveltyContext: context, nextContext: context, generationBrief: context,
  embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type ChapterContext = z.infer<typeof chapterContextSchema>;
export const chapterContextsEmbeddingFields = ['previousContext', 'objectiveContext', 'sourceContext', 'personalizationContext', 'noveltyContext', 'nextContext', 'generationBrief'] as const;
const helpers = createNodeHelpers(CHAPTER_CONTEXTS_COLLECTION, chapterContextSchema, chapterContextsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertChapterContext = helpers.insert;
export const getChapterContextById = helpers.getById;
export const updateChapterContext = helpers.updateById;
export const deleteChapterContext = helpers.deleteById;
export const upsertChapterContextByKey = helpers.upsertByKey;
export const getAllChapterContextsChunked = helpers.getAllChunked;
export const listChapterContextsPage = helpers.listPage;
