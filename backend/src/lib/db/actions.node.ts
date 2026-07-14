import { z } from 'zod';
import { aql } from 'arangojs';
import { actionIdSchema } from '@/lib/ai/actions';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const ACTIONS_COLLECTION = 'actions';

export const actionSlugSchema = actionIdSchema;

export const actionSchema = z.object({
  key: z.string(),
  slug: actionSlugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(4000),
  objective: z.string().trim().min(1).max(4000),
  inputDescription: z.string().trim().min(1).max(4000),
  outputDescription: z.string().trim().min(1).max(4000),
  handlerKey: actionSlugSchema,
  enabled: z.boolean().default(true),
  embedding: z.array(z.number()).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Action = z.infer<typeof actionSchema>;

export const actionsEmbedKeys = z.enum([
  'name',
  'description',
  'objective',
  'inputDescription',
  'outputDescription',
]);

const helpers = createNodeHelpers(ACTIONS_COLLECTION, actionSchema, actionsEmbedKeys.options);

export const insertAction = helpers.insert;
export const getActionById = helpers.getById;
export const updateAction = helpers.updateById;
export const deleteAction = helpers.deleteById;
export const upsertActionByKey = helpers.upsertByKey;
export const getAllActionsChunked = helpers.getAllChunked;
export const listActionsPage = helpers.listPage;

export async function getActionBySlug(slug: Action['slug']): Promise<Action | null> {
  const cursor = await db.query(aql`
    FOR action IN ${db.collection(ACTIONS_COLLECTION)}
      FILTER action.slug == ${slug}
      LIMIT 1
      RETURN action
  `);
  const doc = await cursor.next();
  return doc ? actionSchema.parse(withArangoKey(doc)) : null;
}
