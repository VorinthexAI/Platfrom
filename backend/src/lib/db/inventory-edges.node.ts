import { z } from 'zod';
import { toArangoDoc, withArangoKey } from './base';
import { db } from './client';
import { INVENTORY_NODES_COLLECTION } from './inventory-nodes.node';

export const INVENTORY_EDGES_COLLECTION = 'inventoryEdges';
export const inventoryEdgeKindSchema = z.enum(['satisfies', 'near', 'produced']);

export const inventoryEdgeSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  userKey: z.string().cuid(),
  kind: inventoryEdgeKindSchema,
  fromKey: z.string().cuid(),
  toKey: z.string().cuid(),
  createdAt: z.string().datetime(),
}).strict();
export type InventoryEdge = z.infer<typeof inventoryEdgeSchema>;

export async function insertInventoryEdge(input: InventoryEdge) {
  const edge = inventoryEdgeSchema.parse(input);
  const document = toArangoDoc(edge);
  document._from = `${INVENTORY_NODES_COLLECTION}/${edge.fromKey}`;
  document._to = `${INVENTORY_NODES_COLLECTION}/${edge.toKey}`;
  const result = await db.collection(INVENTORY_EDGES_COLLECTION).save(document, { returnNew: true });
  return inventoryEdgeSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}
