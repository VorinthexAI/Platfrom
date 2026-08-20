import { aql } from 'arangojs';
import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { countryCodeSchema } from './users.node';
import { createNodeHelpers, withArangoKey } from './base';
import { db, withTransaction } from './client';
import { buildPlaceEmbeddingText } from '@/lib/travel/semantic-text';

export const PLACES_COLLECTION = 'places';
export const placeCountryCodeSchema = z.preprocess(
  (value) => typeof value === 'string' ? value.trim().toUpperCase() : value,
  countryCodeSchema,
);
export const placeSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: z.string().trim().min(1),
  // Empty is retained only so pre-summary rows remain readable until migration backfills them.
  summary: z.string().default(''),
  countryCode: placeCountryCodeSchema,
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  embedding: currentEmbeddingSchema, embeddingContentVersion: z.literal(2).default(2), createdAt: z.string().datetime(),
});
export type Place = z.infer<typeof placeSchema>;
export const placesEmbeddingFields = ['name', 'summary'] as const;
const helpers = createNodeHelpers(PLACES_COLLECTION, placeSchema, placesEmbeddingFields, { includeEmbeddingMetadata: false, embeddingText: (place) => buildPlaceEmbeddingText({ name: String(place.name), summary: String(place.summary) }) });
export const insertPlace = helpers.insert;
export const getPlaceById = helpers.getById;
export const updatePlace = helpers.updateById;
export async function deletePlace(key: string) {
  return withTransaction({ read: [], write: [PLACES_COLLECTION, 'placeImages'] }, async (transaction) => {
    await transaction.query('FOR relation IN placeImages FILTER relation.placeKey == @key REMOVE relation IN placeImages', { key });
    const cursor = await transaction.query('FOR place IN places FILTER place._key == @key REMOVE place IN places RETURN OLD', { key });
    const removed = await cursor.next();
    return removed ? placeSchema.parse(withArangoKey(removed as Record<string, unknown>)) : null;
  });
}
export const upsertPlaceByKey = helpers.upsertByKey;
export const getAllPlacesChunked = helpers.getAllChunked;
export const listPlacesPage = helpers.listPage;
export async function listPlacesByScope(scopeKey: string): Promise<Place[]> {
  const cursor = await db.query(aql`FOR place IN ${db.collection(PLACES_COLLECTION)} FILTER place.scopeKey == ${scopeKey} SORT place.name ASC, place._key ASC RETURN place`);
  return (await cursor.all()).map((place) => placeSchema.parse(withArangoKey(place)));
}
