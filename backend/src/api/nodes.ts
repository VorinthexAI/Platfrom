import type { Context } from 'hono';
import { z } from 'zod';
import { NODE_NAMES, NODE_REGISTRY } from '@/lib/db/registry';
import { parseQuery, strictObject } from './validation';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

const listNodesQuerySchema = strictObject({
  node: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).default(DEFAULT_LIMIT),
  after: z.string().optional(),
});

/**
 * GET /api/v1/nodes?node=<name>&limit=<n>&after=<cursor>
 *
 * - `node` given: one page from just that node, resumable via `after`.
 * - `node` omitted: one page (default limit) from every registered node,
 *   grouped and sorted by node name. No cross-node `after` in this mode —
 *   pass `node` to page deeper into a specific one.
 */
export async function listNodes(c: Context) {
  const query = parseQuery(c, listNodesQuerySchema);

  if (query.node) {
    const node = NODE_REGISTRY[query.node];
    if (!node) {
      return c.json({ error: `unknown node "${query.node}"`, known_nodes: NODE_NAMES }, 400);
    }
    const { items, nextCursor } = await node.listPage(query.after, query.limit);
    return c.json({ node: query.node, items, next_cursor: nextCursor });
  }

  const results = await Promise.all(
    NODE_NAMES.map(async (name) => {
      const { items, nextCursor } = await NODE_REGISTRY[name].listPage(undefined, query.limit);
      return { node: name, items, next_cursor: nextCursor };
    }),
  );

  return c.json({ items: results });
}
