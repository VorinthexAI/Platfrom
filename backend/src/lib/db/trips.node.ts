import { aql } from 'arangojs';
import { z } from 'zod';
import { rolloutEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const TRIPS_COLLECTION = 'trips';
export const tripSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: z.string().trim().min(1), description: z.string().trim().min(1).optional(),
  startDate: z.string().date().optional(), endDate: z.string().date().optional(), isFavorite: z.boolean().default(false),
  embedding: rolloutEmbeddingSchema, deletedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).superRefine((trip, context) => { if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'endDate must not precede startDate.' }); });
export type Trip = z.infer<typeof tripSchema>;
export const tripsEmbeddingFields = ['name', 'description'] as const;
const helpers = createNodeHelpers(TRIPS_COLLECTION, tripSchema, tripsEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertTrip = helpers.insert;
export const getTripById = helpers.getById;
export const updateTrip = helpers.updateById;
export const deleteTrip = helpers.deleteById;
export const upsertTripByKey = helpers.upsertByKey;
export const getAllTripsChunked = helpers.getAllChunked;
export const listTripsPage = helpers.listPage;
export async function listTripsByScope(scopeKey: string, includeDeleted = false): Promise<Trip[]> {
  const cursor = await db.query(aql`FOR trip IN ${db.collection(TRIPS_COLLECTION)} FILTER trip.scopeKey == ${scopeKey} FILTER ${includeDeleted} || trip.deletedAt == null SORT trip.startDate ASC, trip.name ASC, trip._key ASC RETURN trip`);
  return (await cursor.all()).map((trip) => tripSchema.parse(withArangoKey(trip)));
}
