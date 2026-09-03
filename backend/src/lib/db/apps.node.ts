import { z } from 'zod';
import { db } from './client';
import { isArangoNotFoundError, toArangoDoc, withArangoKey } from './base';

export const APPS_COLLECTION = 'apps';

export const appKeySchema = z.string().cuid();
export const appSlugSchema = z.string().min(1).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const appSchema = z.object({
  key: appKeySchema,
  slug: appSlugSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(300),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export type PublicApp = z.infer<typeof appSchema>;

type AppsDatabase = Pick<typeof db, 'collection' | 'query'>;

export function createAppsRepository(database: AppsDatabase = db) {
  const collection = database.collection(APPS_COLLECTION);
  return {
    async getByKey(key: string): Promise<PublicApp | null> {
      const validKey = appKeySchema.parse(key);
      try {
        return appSchema.parse(withArangoKey(await collection.document(validKey) as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },
    async insert(input: PublicApp): Promise<PublicApp> {
      const app = appSchema.parse(input);
      const result = await collection.save(toArangoDoc(app), { returnNew: true });
      return appSchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async update(key: string, patch: Pick<PublicApp, 'slug' | 'name' | 'description' | 'version' | 'updatedAt'>): Promise<PublicApp> {
      const validPatch = appSchema.pick({ slug: true, name: true, description: true, version: true, updatedAt: true }).parse(patch);
      const result = await collection.update(appKeySchema.parse(key), validPatch, { returnNew: true });
      return appSchema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async list(): Promise<PublicApp[]> {
      const cursor = await database.query('FOR app IN apps SORT app.slug ASC, app._key ASC RETURN app');
      return (await cursor.all() as Record<string, unknown>[]).map((app) => appSchema.parse(withArangoKey(app)));
    },
  };
}

export const appsRepository = createAppsRepository();
