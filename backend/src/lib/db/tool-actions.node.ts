import { aql } from 'arangojs';
import { z } from 'zod';
import { actionSlugSchema } from './actions.node';
import { toolIdSchema } from '@/lib/ai/tools/types';
import { db } from './client';
import { createEdgeHelpers, withArangoKey } from './base';

export const TOOL_ACTIONS_COLLECTION = 'toolActions';

export const toolActionSchema = z.object({
  key: z.string().cuid(),
  toolKey: z.string().cuid(),
  actionKey: z.string().cuid(),
  priority: z.number().int().nonnegative().default(100),
  enabled: z.boolean().default(true),
});

export type ToolAction = z.infer<typeof toolActionSchema>;

export const toolActionSeedSchema = z.object({
  key: z.string().cuid(),
  toolSlug: toolIdSchema,
  actionSlug: actionSlugSchema,
  priority: z.number().int().nonnegative(),
  enabled: z.boolean(),
});

export type ToolActionSeed = z.infer<typeof toolActionSeedSchema>;

const helpers = createEdgeHelpers(TOOL_ACTIONS_COLLECTION, toolActionSchema);

export const insertToolAction = helpers.insert;
export const getToolActionById = helpers.getById;
export const updateToolAction = helpers.updateById;
export const deleteToolAction = helpers.deleteById;
export const upsertToolActionByKey = helpers.upsertByKey;
export const getAllToolActionsChunked = helpers.getAllChunked;
export const listToolActionsPage = helpers.listPage;

export async function getToolActionByPair(toolKey: string, actionKey: string): Promise<ToolAction | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(TOOL_ACTIONS_COLLECTION)}
      FILTER link.toolKey == ${toolKey} && link.actionKey == ${actionKey}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? toolActionSchema.parse(withArangoKey(doc)) : null;
}

export async function listToolActionsByToolKey(toolKey: string): Promise<ToolAction[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(TOOL_ACTIONS_COLLECTION)}
      FILTER link.toolKey == ${toolKey} && link.enabled == true
      SORT link.priority DESC, link._key ASC
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => toolActionSchema.parse(withArangoKey(doc)));
}
