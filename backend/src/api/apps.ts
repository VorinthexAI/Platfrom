import type { Context } from 'hono';
import { z } from 'zod';
import { getUserById } from '@/lib/db/users.node';
import { appsService, publicAppSchema, type AppsService } from '@/lib/apps/service';
import { getAuthIdentity } from './security';

export const appsResponseSchema = z.object({ apps: z.array(publicAppSchema) }).strict();

async function viewerEmail(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity || identity.identityType !== 'user') return null;
  const user = await getUserById(identity.key);
  return user?.email ?? null;
}

export function createListApps(service: Pick<AppsService, 'listPublic'> = appsService) {
  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const apps = await service.listPublic(await viewerEmail(c));
    return c.json(appsResponseSchema.parse({ apps }));
  };
}

export const listApps = createListApps();

export const agentsResponseSchema = z.object({ agents: z.array(publicAppSchema) }).strict();

export function createListAgents(service: Pick<AppsService, 'listPublic'> = appsService) {
  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const agents = await service.listPublic(await viewerEmail(c));
    return c.json(agentsResponseSchema.parse({ agents }));
  };
}

export const listAgents = createListAgents();
