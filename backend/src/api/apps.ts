import type { Context } from 'hono';
import { z } from 'zod';
import { appsService, publicAppSchema, type AppsService } from '@/lib/apps/service';

export const appsResponseSchema = z.object({ apps: z.array(publicAppSchema) }).strict();

export function createListApps(service: Pick<AppsService, 'listPublic'> = appsService) {
  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const apps = await service.listPublic();
    return c.json(appsResponseSchema.parse({ apps }));
  };
}

export const listApps = createListApps();
