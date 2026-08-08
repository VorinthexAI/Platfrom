import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const PLACE_VISITS_COLLECTION = 'placeVisits';
export const placeVisitSchema = z.object({ key: z.string().cuid(), scopeKey: z.string().cuid(), placeKey: z.string().cuid(), tripKey: z.string().cuid().optional(), arrivedAt: z.string().date().optional(), departedAt: z.string().date().optional(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .superRefine((visit, context) => { if (visit.arrivedAt && visit.departedAt && visit.departedAt < visit.arrivedAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ['departedAt'], message: 'departedAt must not precede arrivedAt.' }); });
export type PlaceVisit = z.infer<typeof placeVisitSchema>;
export const placeVisitsEmbeddingFields = [] as const;
const helpers = createNodeHelpers(PLACE_VISITS_COLLECTION, placeVisitSchema, placeVisitsEmbeddingFields, { requireEmbedding: false });
export const insertPlaceVisit = helpers.insert;
export const getPlaceVisitById = helpers.getById;
export const updatePlaceVisit = helpers.updateById;
export const deletePlaceVisit = helpers.deleteById;
export const upsertPlaceVisitByKey = helpers.upsertByKey;
export const getAllPlaceVisitsChunked = helpers.getAllChunked;
export const listPlaceVisitsPage = helpers.listPage;
export async function listPlaceVisitsByScope(scopeKey: string, placeKey?: string): Promise<PlaceVisit[]> {
  const cursor = await db.query(aql`FOR visit IN ${db.collection(PLACE_VISITS_COLLECTION)} FILTER visit.scopeKey == ${scopeKey} FILTER ${placeKey ?? null} == null || visit.placeKey == ${placeKey ?? null} SORT visit.arrivedAt DESC, visit.createdAt DESC, visit._key ASC RETURN visit`);
  return (await cursor.all()).map((visit) => placeVisitSchema.parse(withArangoKey(visit)));
}
