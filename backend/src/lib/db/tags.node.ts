import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const TAGS_COLLECTION = 'tags';
export const tagSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: z.string().trim().min(1), description: z.string().trim().default(''), embedding: currentEmbeddingSchema,
  embeddingProvider: z.string().trim().min(1).optional(), embeddingModel: z.string().trim().min(1).optional(), embeddingDimensions: z.number().int().positive().optional(),
  deletedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Tag = z.infer<typeof tagSchema>;
export const tagsEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(TAGS_COLLECTION, tagSchema, tagsEmbeddingFields);
export const insertTag = helpers.insert;
export const getTagById = helpers.getById;
export const updateTag = helpers.updateById;
export const deleteTag = helpers.deleteById;
export const upsertTagByKey = helpers.upsertByKey;
export const getAllTagsChunked = helpers.getAllChunked;
export const listTagsPage = helpers.listPage;
export async function listTagsByScope(scopeKey: string, includeDeleted = false): Promise<Tag[]> {
  const cursor = await db.query(aql`FOR tag IN ${db.collection(TAGS_COLLECTION)} FILTER tag.scopeKey == ${scopeKey} FILTER ${includeDeleted} || tag.deletedAt == null SORT tag.name ASC, tag._key ASC RETURN tag`);
  return (await cursor.all()).map((tag) => tagSchema.parse(withArangoKey(tag)));
}
