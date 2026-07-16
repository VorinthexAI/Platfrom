import { aql } from 'arangojs';
import { z } from 'zod';
import { toolIdSchema } from '@/lib/ai/tools/types';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const TOOLS_COLLECTION = 'tools';

export const toolSchema = z.object({
  key: z.string().cuid(),
  slug: toolIdSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(4000),
  scopeKey: z.string().cuid().nullable().default(null),
  enabled: z.boolean().default(true),
  embedding: z.array(z.number().finite()).default([]),
});

export type Tool = z.infer<typeof toolSchema>;

export const toolsEmbedKeys = z.enum(['name', 'description']);

const helpers = createNodeHelpers(TOOLS_COLLECTION, toolSchema, toolsEmbedKeys.options);

export const insertTool = helpers.insert;
export const getToolById = helpers.getById;
export const updateTool = helpers.updateById;
export const deleteTool = helpers.deleteById;
export const upsertToolByKey = helpers.upsertByKey;
export const getAllToolsChunked = helpers.getAllChunked;
export const listToolsPage = helpers.listPage;

export async function getToolBySlug(slug: Tool['slug']): Promise<Tool | null> {
  const cursor = await db.query(aql`
    FOR tool IN ${db.collection(TOOLS_COLLECTION)}
      FILTER tool.slug == ${slug}
      LIMIT 1
      RETURN tool
  `);
  const doc = await cursor.next();
  return doc ? toolSchema.parse(withArangoKey(doc)) : null;
}
