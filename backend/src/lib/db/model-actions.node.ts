import { z } from 'zod';
import { aql } from 'arangojs';
import { actionSlugSchema } from './actions.node';
import { modelSlugSchema } from './models.node';
import { db } from './client';
import { createEdgeHelpers, withArangoKey } from './base';

export const MODEL_ACTIONS_COLLECTION = 'modelActions';

export const modelActionSchema = z.object({
  key: z.string().cuid(),
  modelKey: z.string().cuid(),
  actionKey: z.string().cuid(),
  priority: z.number().int().nonnegative().default(100),
  enabled: z.boolean().default(true),
});

export type ModelAction = z.infer<typeof modelActionSchema>;

export const modelActionSeedSchema = z.object({
  key: z.string().cuid(),
  modelSlug: modelSlugSchema,
  actionSlug: actionSlugSchema,
  priority: z.number().int().nonnegative(),
  enabled: z.boolean(),
});

export type ModelActionSeed = z.infer<typeof modelActionSeedSchema>;

const helpers = createEdgeHelpers(MODEL_ACTIONS_COLLECTION, modelActionSchema);

export const insertModelAction = helpers.insert;
export const getModelActionById = helpers.getById;
export const updateModelAction = helpers.updateById;
export const deleteModelAction = helpers.deleteById;
export const upsertModelActionByKey = helpers.upsertByKey;
export const getAllModelActionsChunked = helpers.getAllChunked;
export const listModelActionsPage = helpers.listPage;

export async function getModelActionByPair(modelKey: string, actionKey: string): Promise<ModelAction | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MODEL_ACTIONS_COLLECTION)}
      FILTER link.modelKey == ${modelKey} && link.actionKey == ${actionKey}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? modelActionSchema.parse(withArangoKey(doc)) : null;
}

export async function listEnabledModelActionsByActionKey(actionKey: string): Promise<ModelAction[]> {
  const validActionKey = modelActionSchema.shape.actionKey.parse(actionKey);
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MODEL_ACTIONS_COLLECTION)}
      FILTER link.actionKey == ${validActionKey} && link.enabled == true
      SORT link.priority DESC, link._key ASC
      RETURN link
  `);
  return (await cursor.all()).map((doc) => modelActionSchema.parse(withArangoKey(doc)));
}
