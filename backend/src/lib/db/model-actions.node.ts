import { z } from 'zod';
import { aql } from 'arangojs';
import { actionIdSchema } from '@/lib/ai/actions/types';
import { modelSlugSchema } from './models.node';
import { db } from './client';
import { createEdgeHelpers, withArangoKey } from './base';

export const MODEL_ACTIONS_COLLECTION = 'modelActions';

export const modelActionSchema = z.object({
  key: z.string().cuid(),
  modelKey: z.string().cuid(),
  actionSlug: actionIdSchema,
  priority: z.number().int().nonnegative().default(100),
  enabled: z.boolean().default(true),
}).strict();

export type ModelAction = z.infer<typeof modelActionSchema>;

export const modelActionSeedSchema = z.object({
  key: z.string().cuid(),
  modelSlug: modelSlugSchema,
  actionSlug: actionIdSchema,
  priority: z.number().int().nonnegative(),
  enabled: z.boolean(),
}).strict();

export type ModelActionSeed = z.infer<typeof modelActionSeedSchema>;

const helpers = createEdgeHelpers(MODEL_ACTIONS_COLLECTION, modelActionSchema);

export const insertModelAction = helpers.insert;
export const getModelActionById = helpers.getById;
export const updateModelAction = helpers.updateById;
export const deleteModelAction = helpers.deleteById;
export const upsertModelActionByKey = helpers.upsertByKey;
export const getAllModelActionsChunked = helpers.getAllChunked;
export const listModelActionsPage = helpers.listPage;

export async function getModelActionByPair(modelKey: string, actionSlug: ModelAction['actionSlug']): Promise<ModelAction | null> {
  const validActionSlug = actionIdSchema.parse(actionSlug);
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MODEL_ACTIONS_COLLECTION)}
      FILTER link.modelKey == ${modelKey} && link.actionSlug == ${validActionSlug}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? modelActionSchema.parse(withArangoKey(doc)) : null;
}

export async function listEnabledModelActionsByActionSlug(actionSlug: ModelAction['actionSlug']): Promise<ModelAction[]> {
  const validActionSlug = actionIdSchema.parse(actionSlug);
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(MODEL_ACTIONS_COLLECTION)}
      FILTER link.actionSlug == ${validActionSlug} && link.enabled == true
      SORT link.priority DESC, link._key ASC
      RETURN link
  `);
  return (await cursor.all()).map((doc) => modelActionSchema.parse(withArangoKey(doc)));
}
