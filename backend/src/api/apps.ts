import type { Context } from 'hono';
import { z } from 'zod';
import { appSchema, appsRepository } from '@/lib/db/apps.node';

export const appsResponseSchema = z.object({ apps: z.array(appSchema) }).strict();

export function createListApps(list: typeof appsRepository.list = appsRepository.list) {
  return async (c: Context) => {
    c.header('Cache-Control', 'no-store');
    const apps = [...await list()].sort((left, right) => left.slug.localeCompare(right.slug) || left.key.localeCompare(right.key));
    return c.json(appsResponseSchema.parse({ apps }));
  };
}

export const listApps = createListApps();
