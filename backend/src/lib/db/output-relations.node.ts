import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const OUTPUT_RELATIONS_COLLECTION = 'outputRelations';

export const outputRelationSchema = z.object({
  key: z.string(),
  parentOutputId: z.string(),
  childOutputId: z.string(),
  relationType: z.string(),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type OutputRelation = z.infer<typeof outputRelationSchema>;

export const outputRelationsEmbedKeys = z.enum(['relationType']);

const helpers = createNodeHelpers(
  OUTPUT_RELATIONS_COLLECTION,
  outputRelationSchema,
  outputRelationsEmbedKeys.options,
);

export const insertOutputRelation = helpers.insert;
export const getOutputRelationById = helpers.getById;
export const deleteOutputRelation = helpers.deleteById;
export const upsertOutputRelationByKey = helpers.upsertByKey;
export const getAllOutputRelationsChunked = helpers.getAllChunked;
export const listOutputRelationsPage = helpers.listPage;

export async function listRelationsByParentOutputId(parentOutputId: string): Promise<OutputRelation[]> {
  const cursor = await db.query(aql`
    FOR r IN ${db.collection(OUTPUT_RELATIONS_COLLECTION)}
      FILTER r.parentOutputId == ${parentOutputId}
      RETURN r
  `);
  const docs = await cursor.all();
  return docs.map((doc) => outputRelationSchema.parse(withArangoKey(doc)));
}

export async function listRelationsByChildOutputId(childOutputId: string): Promise<OutputRelation[]> {
  const cursor = await db.query(aql`
    FOR r IN ${db.collection(OUTPUT_RELATIONS_COLLECTION)}
      FILTER r.childOutputId == ${childOutputId}
      RETURN r
  `);
  const docs = await cursor.all();
  return docs.map((doc) => outputRelationSchema.parse(withArangoKey(doc)));
}
