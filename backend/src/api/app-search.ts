import type { Context } from 'hono';
import { z } from 'zod';
import { searchFiles } from '@/lib/app-search/service';
import { authorizeContentExecution } from '@/lib/ai/tools';
import { getAuthIdentity } from './security';
import { parseJson, strictObject } from './validation';

const schema = strictObject({
  scopeKey: z.string().cuid(),
  query: z.string().trim().min(1).max(500).optional(),
  operation: z.enum(['search', 'list', 'count']).optional(),
  collectionSlugs: z.array(z.enum(['folders', 'files'])).min(1).max(2).optional(),
  folderKey: z.string().cuid().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export async function searchApp(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ success: false, error: 'authentication required' }, 401);
  const body = await parseJson(c, schema);
  const { context } = await authorizeContentExecution({ scopeKey: body.scopeKey }, { authenticatedUserKey: identity.key });
  return c.json({ success: true, data: await searchFiles(context, body) });
}
