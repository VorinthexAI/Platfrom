import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const TRIP_PLACES_COLLECTION = 'tripPlaces';
export const tripPlaceSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), tripKey: z.string().cuid(), placeKey: z.string().cuid(), position: z.number().int().positive(), arrivalDate: z.string().date().optional(), departureDate: z.string().date().optional(), createdAt: z.string().datetime() })
  .superRefine((relation, context) => { if (relation.arrivalDate && relation.departureDate && relation.departureDate < relation.arrivalDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['departureDate'], message: 'departureDate must not precede arrivalDate.' }); });
export type TripPlace = z.infer<typeof tripPlaceSchema>;
export const tripPlacesEmbeddingFields = [] as const;
const helpers = createNodeHelpers(TRIP_PLACES_COLLECTION, tripPlaceSchema, tripPlacesEmbeddingFields, { requireEmbedding: false });
export const insertTripPlace = helpers.insert;
export const getTripPlaceById = helpers.getById;
export const updateTripPlace = helpers.updateById;
export const deleteTripPlace = helpers.deleteById;
export const upsertTripPlaceByKey = helpers.upsertByKey;
export const getAllTripPlacesChunked = helpers.getAllChunked;
export const listTripPlacesPage = helpers.listPage;
export async function listTripPlacesByScope(scopeKey: string, tripKey?: string): Promise<TripPlace[]> {
  const cursor = await db.query(aql`FOR relation IN ${db.collection(TRIP_PLACES_COLLECTION)} FILTER relation.scopeKey == ${scopeKey} FILTER ${tripKey ?? null} == null || relation.tripKey == ${tripKey ?? null} SORT relation.position ASC, relation._key ASC RETURN relation`);
  return (await cursor.all()).map((relation) => tripPlaceSchema.parse(withArangoKey(relation)));
}
