import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const OUTPUTS_COLLECTION = 'outputs';

export const outputSchema = z.object({
  key: z.string(),
  type: z.string(),
  data: z.record(z.unknown()).nullable().default(null),
  storagePath: z.string().nullable().default(null),
  usageCount: z.number().int().default(0),
  embedding: z.array(z.number()).default([]),
  createdAt: z.string(),
});

export type Output = z.infer<typeof outputSchema>;

// data is an arbitrary nested payload and storagePath is an S3 key, both out of
// scope for the generic scalar-only embedding normalizer; usageCount is a stat,
// not search text.
export const outputsEmbedKeys = z.enum(['type']);

const helpers = createNodeHelpers(OUTPUTS_COLLECTION, outputSchema, outputsEmbedKeys.options);

export const insertOutput = helpers.insert;
export const getOutputById = helpers.getById;
export const updateOutput = helpers.updateById;
export const deleteOutput = helpers.deleteById;
export const upsertOutput = helpers.upsertByKey;
export const getAllOutputsChunked = helpers.getAllChunked;
export const listOutputsPage = helpers.listPage;

export async function incrementOutputUsageCount(id: string): Promise<Output> {
  const cursor = await db.query(aql`
    UPDATE ${id} WITH { usageCount: DOCUMENT(${db.collection(OUTPUTS_COLLECTION)}, ${id}).usageCount + 1 }
      IN ${db.collection(OUTPUTS_COLLECTION)}
      OPTIONS { mergeObjects: true }
      RETURN NEW
  `);
  const doc = await cursor.next();
  return outputSchema.parse(withArangoKey(doc));
}

export interface SearchOutputFilter {
  type?: string;
  limit: number;
}

export async function searchOutputs(filter: SearchOutputFilter): Promise<Output[]> {
  const cursor = await db.query(aql`
    FOR output IN ${db.collection(OUTPUTS_COLLECTION)}
      FILTER ${filter.type ?? null} == null || output.type == ${filter.type ?? null}
      SORT output.createdAt DESC
      LIMIT ${filter.limit}
      RETURN output
  `);
  const docs = await cursor.all();
  return docs.map((doc) => outputSchema.parse(withArangoKey(doc)));
}
