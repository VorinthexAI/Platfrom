import { z } from 'zod';
import { aql } from 'arangojs';
import { providerSlugSchema } from './providers.node';
import { modelSlugSchema } from './models.node';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const MODEL_PROVIDERS_COLLECTION = 'modelProviders';

export const modelProviderSchema = z.object({
  key: z.string(),
  modelKey: z.string(),
  providerKey: z.string(),
  providerModelId: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
  embedding: z.array(z.number().finite()).default([]),
});

export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelProviderSeedSchema = z.object({
  key: z.string(),
  modelSlug: modelSlugSchema,
  providerSlug: providerSlugSchema,
  providerModelId: z.string().trim().min(1).max(500),
  enabled: z.boolean(),
});

export type ModelProviderSeed = z.infer<typeof modelProviderSeedSchema>;

const helpers = createNodeHelpers(MODEL_PROVIDERS_COLLECTION, modelProviderSchema);

export const insertModelProvider = helpers.insert;
export const getModelProviderById = helpers.getById;
export const updateModelProvider = helpers.updateById;
export const deleteModelProvider = helpers.deleteById;
export const upsertModelProviderByKey = helpers.upsertByKey;
export const getAllModelProvidersChunked = helpers.getAllChunked;
export const listModelProvidersPage = helpers.listPage;

export async function getModelProviderByPair(modelKey: string, providerKey: string): Promise<ModelProvider | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MODEL_PROVIDERS_COLLECTION)}
      FILTER link.modelKey == ${modelKey} && link.providerKey == ${providerKey}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? modelProviderSchema.parse(withArangoKey(doc)) : null;
}
