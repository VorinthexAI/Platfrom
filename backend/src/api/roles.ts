import type { Context } from 'hono';
import { z } from 'zod';
import { listPublicRoles, publicRoleSchema } from '@/lib/ai/roles';
import { getAuthIdentity } from './security';

const responseSchema = z.object({ roles: z.array(publicRoleSchema) }).strict();

export async function listRoles(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity || identity.identityType !== 'user') return c.json({ success: false, error: 'user authentication required' }, 401);
  return c.json({ success: true, data: responseSchema.parse({ roles: listPublicRoles() }) });
}
