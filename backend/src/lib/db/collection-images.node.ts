import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const COLLECTION_IMAGES_COLLECTION = 'collectionImages';
export const collectionImageSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), collectionKey: z.string().cuid(), imageKey: z.string().cuid(), addedByKey: z.string().cuid(), createdAt: z.string().datetime() });
export type CollectionImage = z.infer<typeof collectionImageSchema>;
export const collectionImagesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(COLLECTION_IMAGES_COLLECTION, collectionImageSchema, collectionImagesEmbeddingFields, { requireEmbedding: false });
export const insertCollectionImage = helpers.insert;
export const getCollectionImageById = helpers.getById;
export const updateCollectionImage = helpers.updateById;
export const deleteCollectionImage = helpers.deleteById;
export const upsertCollectionImageByKey = helpers.upsertByKey;
export const getAllCollectionImagesChunked = helpers.getAllChunked;
export const listCollectionImagesPage = helpers.listPage;
export async function listCollectionImagesByScope(scopeKey: string, collectionKey?: string): Promise<CollectionImage[]> {
  const cursor = await db.query(aql`FOR relation IN ${db.collection(COLLECTION_IMAGES_COLLECTION)} FILTER relation.scopeKey == ${scopeKey} FILTER ${collectionKey ?? null} == null || relation.collectionKey == ${collectionKey ?? null} SORT relation.createdAt ASC, relation._key ASC RETURN relation`);
  return (await cursor.all()).map((relation) => collectionImageSchema.parse(withArangoKey(relation)));
}
