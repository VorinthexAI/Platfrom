import { aql } from 'arangojs';
import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { countryCodeSchema } from './users.node';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const PLACES_COLLECTION = 'places';
export const placeCountryCodeSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
  countryCodeSchema,
);
export const placeSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: z.string().trim().min(1),
  countryCode: placeCountryCodeSchema,
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  embedding: currentEmbeddingSchema, createdAt: z.string().datetime(),
});
export type Place = z.infer<typeof placeSchema>;
export const placesEmbeddingFields = ['name'] as const;
const helpers = createNodeHelpers(PLACES_COLLECTION, placeSchema, placesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertPlace = helpers.insert;
export const getPlaceById = helpers.getById;
export const updatePlace = helpers.updateById;
export const deletePlace = helpers.deleteById;
export const upsertPlaceByKey = helpers.upsertByKey;
export const getAllPlacesChunked = helpers.getAllChunked;
export const listPlacesPage = helpers.listPage;
export async function listPlacesByScope(scopeKey: string): Promise<Place[]> {
  const cursor = await db.query(aql`FOR place IN ${db.collection(PLACES_COLLECTION)} FILTER place.scopeKey == ${scopeKey} SORT place.name ASC, place._key ASC RETURN place`);
  return (await cursor.all()).map((place) => placeSchema.parse(withArangoKey(place)));
}
