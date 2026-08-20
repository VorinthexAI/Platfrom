import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const PLACE_IMAGES_COLLECTION = 'placeImages';
export const placeImageSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), placeKey: z.string().cuid(), imageKey: z.string().cuid(),
  role: z.enum(['hero']).default('hero'), provenance: z.enum(['generated']).default('generated'),
  position: z.number().int().nonnegative().default(0), createdAt: z.string().datetime(),
}).strict();
export type PlaceImage = z.infer<typeof placeImageSchema>;
export const placeImagesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(PLACE_IMAGES_COLLECTION, placeImageSchema, placeImagesEmbeddingFields, { requireEmbedding: false });
export const insertPlaceImage = helpers.insert;
export const getPlaceImageById = helpers.getById;
export const upsertPlaceImageByKey = helpers.upsertByKey;
export const getAllPlaceImagesChunked = helpers.getAllChunked;
export const listPlaceImagesPage = helpers.listPage;
export async function listPlaceImages(scopeKey: string, placeKey: string): Promise<PlaceImage[]> {
  const cursor = await db.query(aql`FOR relation IN ${db.collection(PLACE_IMAGES_COLLECTION)} FILTER relation.scopeKey == ${scopeKey} && relation.placeKey == ${placeKey} SORT relation.position ASC, relation._key ASC RETURN relation`);
  return (await cursor.all()).map((relation) => placeImageSchema.parse(withArangoKey(relation)));
}
