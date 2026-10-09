import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const INVENTORY_NODES_COLLECTION = 'inventoryNodes';
export const inventoryLayerSchema = z.enum(['themes', 'hooks', 'stories', 'scenes', 'images']);
export type InventoryLayer = z.infer<typeof inventoryLayerSchema>;
export const inventoryDecisionSchema = z.enum(['kept', 'dropped']);

export const inventoryNodeSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  kind: inventoryLayerSchema,
  runKey: z.string().cuid(),
  index: z.number().int().min(0).max(2),
  text: z.string().trim().min(1).max(8_000),
  storageKey: z.string().trim().min(1).optional(),
  decision: inventoryDecisionSchema.optional(),
  decidedAt: z.string().datetime().optional(),
  embedding: currentEmbeddingSchema.or(z.array(z.number().finite()).length(0)).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type InventoryNode = z.infer<typeof inventoryNodeSchema>;

const helpers = createNodeHelpers(INVENTORY_NODES_COLLECTION, inventoryNodeSchema, ['text'], {
  includeEmbeddingMetadata: false,
  embeddingText: (node) => String(node.text),
});
export const insertInventoryNode = helpers.insert;
export const getInventoryNode = helpers.getById;
export const updateInventoryNode = helpers.updateById;

export function projectInventoryNode(node: InventoryNode) {
  const { embedding: _embedding, ...safe } = node;
  return safe;
}

export async function listRecentInventoryTexts(scopeKey: string, userKey: string, kind: InventoryLayer, limit = 20) {
  const cursor = await db.query(aql`
    FOR node IN ${db.collection(INVENTORY_NODES_COLLECTION)}
      FILTER node.scopeKey == ${scopeKey} && node.userKey == ${userKey} && node.kind == ${kind}
      SORT node.createdAt DESC
      LIMIT ${limit}
      RETURN node.text
  `);
  return z.array(z.string()).parse(await cursor.all());
}

export async function nearestInventoryNodes(scopeKey: string, userKey: string, kind: InventoryLayer, key: string, embedding: number[]) {
  if (!embedding.length) return [];
  const cursor = await db.query(aql`
    FOR node IN ${db.collection(INVENTORY_NODES_COLLECTION)}
      FILTER node.scopeKey == ${scopeKey} && node.userKey == ${userKey} && node.kind == ${kind} && node._key != ${key}
      FILTER IS_ARRAY(node.embedding) && LENGTH(node.embedding) == LENGTH(${embedding})
      LET score = COSINE_SIMILARITY(node.embedding, ${embedding})
      FILTER score >= 0.86
      SORT score DESC
      LIMIT 5
      RETURN node
  `);
  return (await cursor.all()).map((row) => inventoryNodeSchema.parse(withArangoKey(row as Record<string, unknown>)));
}
