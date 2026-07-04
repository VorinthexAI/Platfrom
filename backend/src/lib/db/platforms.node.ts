import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers } from './base';
import { withArangoKey } from './base';

export const PLATFORMS_COLLECTION = 'platforms';

export const platformSchema = z.object({
  key: z.string(),
  name: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Platform = z.infer<typeof platformSchema>;

export const platformsEmbedKeys = z.enum(['name']);

const helpers = createNodeHelpers(PLATFORMS_COLLECTION, platformSchema, platformsEmbedKeys.options);

export const insertPlatform = helpers.insert;
export const getPlatformById = helpers.getById;
export const updatePlatform = helpers.updateById;
export const deletePlatform = helpers.deleteById;
export const upsertPlatform = helpers.upsertByKey;
export const getAllPlatformsChunked = helpers.getAllChunked;
export const listPlatformsPage = helpers.listPage;

export async function getPlatformByName(name: string): Promise<Platform | null> {
  const cursor = await db.query(aql`
    FOR platform IN ${db.collection(PLATFORMS_COLLECTION)}
      FILTER platform.name == ${name}
      LIMIT 1
      RETURN platform
  `);
  const doc = await cursor.next();
  return doc ? platformSchema.parse(withArangoKey(doc)) : null;
}
