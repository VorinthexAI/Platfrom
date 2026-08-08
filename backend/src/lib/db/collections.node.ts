import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const COLLECTIONS_COLLECTION = 'collections';
export const collectionSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: z.string().trim().min(1), description: z.string().trim().min(1).optional(), coverImageKey: z.string().cuid().optional(),
  embedding: currentEmbeddingSchema,
  isFavorite: z.boolean().default(false), deletedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Collection = z.infer<typeof collectionSchema>;
export const collectionsEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(COLLECTIONS_COLLECTION, collectionSchema, collectionsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertCollection = helpers.insert;
export const getCollectionById = helpers.getById;
export const updateCollection = helpers.updateById;
export const upsertCollectionByKey = helpers.upsertByKey;
export const getAllCollectionsChunked = helpers.getAllChunked;
export const listCollectionsPage = helpers.listPage;

export async function getCollectionInScope(scopeKey: string, collectionKey: string, includeDeleted = false): Promise<Collection | null> {
  const cursor = await db.query(aql`FOR collection IN ${db.collection(COLLECTIONS_COLLECTION)} FILTER collection._key == ${collectionKey} && collection.scopeKey == ${scopeKey} FILTER ${includeDeleted} || collection.deletedAt == null LIMIT 1 RETURN collection`);
  const collection = await cursor.next();
  return collection ? collectionSchema.parse(withArangoKey(collection)) : null;
}

export async function listCollectionsByScope(scopeKey: string, includeDeleted = false): Promise<Collection[]> {
  const cursor = await db.query(aql`FOR collection IN ${db.collection(COLLECTIONS_COLLECTION)} FILTER collection.scopeKey == ${scopeKey} FILTER ${includeDeleted} || collection.deletedAt == null SORT collection.name ASC, collection._key ASC RETURN collection`);
  return (await cursor.all()).map((collection) => collectionSchema.parse(withArangoKey(collection)));
}
