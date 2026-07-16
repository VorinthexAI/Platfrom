import { z } from 'zod';
import { aql } from 'arangojs';
import { modelSlugSchema } from '@/lib/ai/models/types';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const MODELS_COLLECTION = 'models';

export { modelSlugSchema };
export type ModelSlug = z.infer<typeof modelSlugSchema>;

export const modelSchema = z.object({
  key: z.string().cuid(),
  slug: modelSlugSchema,
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().min(1).max(4000),
  supportedUseCases: z.string().trim().min(1).max(4000),
  enabled: z.boolean().default(true),
  embedding: z.array(z.number().finite()).default([]),
});

export type Model = z.infer<typeof modelSchema>;

export const modelsEmbedKeys = z.enum(['name', 'description', 'supportedUseCases']);

const helpers = createNodeHelpers(MODELS_COLLECTION, modelSchema, modelsEmbedKeys.options);

export const insertModel = helpers.insert;
export const getModelById = helpers.getById;
export const updateModel = helpers.updateById;
export const deleteModel = helpers.deleteById;
export const upsertModelByKey = helpers.upsertByKey;
export const getAllModelsChunked = helpers.getAllChunked;
export const listModelsPage = helpers.listPage;

export async function getModelBySlug(slug: ModelSlug): Promise<Model | null> {
  const cursor = await db.query(aql`
    FOR model IN ${db.collection(MODELS_COLLECTION)}
      FILTER model.slug == ${slug}
      LIMIT 1
      RETURN model
  `);
  const doc = await cursor.next();
  return doc ? modelSchema.parse(withArangoKey(doc)) : null;
}
