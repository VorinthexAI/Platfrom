import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const MINDS_COLLECTION = 'minds';

export const mindSchema = z.object({
  key: z.string(),
  userId: z.string(),
  name: z.string(),
  storagePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Mind = z.infer<typeof mindSchema>;

export const mindsEmbedKeys = z.enum(['name']);

const helpers = createNodeHelpers(MINDS_COLLECTION, mindSchema, mindsEmbedKeys.options);

export const insertMind = helpers.insert;
export const getMindById = helpers.getById;
export const updateMind = helpers.updateById;
export const deleteMind = helpers.deleteById;
export const upsertMindByKey = helpers.upsertByKey;
export const getAllMindsChunked = helpers.getAllChunked;
export const listMindsPage = helpers.listPage;

export async function getMindByUserId(userId: string): Promise<Mind | null> {
  const cursor = await db.query(aql`
    FOR mind IN ${db.collection(MINDS_COLLECTION)}
      FILTER mind.userId == ${userId}
      LIMIT 1
      RETURN mind
  `);
  const doc = await cursor.next();
  return doc ? mindSchema.parse(withArangoKey(doc)) : null;
}
