import { z } from 'zod';
import { buildEmbeddingText } from '@/lib/db/base';
import { placeCountryCodeSchema, placeKindSchema, placeSchema, placesEmbeddingFields, type Place } from '@/lib/db/places.node';
import { tripSchema, tripsEmbeddingFields, type Trip } from '@/lib/db/trips.node';
import { placeVisitSchema } from '@/lib/db/place-visits.node';
import type { TripPlace } from '@/lib/db/trip-places.node';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { strictObject } from '@/api/validation';
import { createTravelRepository, TravelRepositoryError, type TravelAccessContext, type TravelOverviewRow, type TravelRepository } from './repository';

const requestContextShape = { organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() };
const optionalText = z.string().trim().min(1).max(500).optional();
export const travelOverviewInputSchema = strictObject(requestContextShape);
export const travelPlaceInputSchema = strictObject({
  ...requestContextShape, kind: placeKindSchema.default('place'), name: z.string().trim().min(1).max(200), latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
  countryCode: placeCountryCodeSchema, country: optionalText, continent: optionalText, region: optionalText, city: optionalText, wishlist: z.boolean().default(false),
});
export const travelVisitInputSchema = strictObject({
  ...requestContextShape, tripKey: z.string().cuid().optional(), arrivedAt: z.string().date().optional(), departedAt: z.string().date().optional(),
}).superRefine((visit, context) => { if (visit.arrivedAt && visit.departedAt && visit.departedAt < visit.arrivedAt) context.addIssue({ code: z.ZodIssueCode.custom, path: ['departedAt'], message: 'departedAt must not precede arrivedAt.' }); });
export const travelTripInputSchema = strictObject({
  ...requestContextShape, name: z.string().trim().min(1).max(200), description: z.string().trim().min(1).max(2_000).optional(), startDate: z.string().date().optional(), endDate: z.string().date().optional(),
}).superRefine((trip, context) => { if (trip.startDate && trip.endDate && trip.endDate < trip.startDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'endDate must not precede startDate.' }); });
export const travelTripPlaceInputSchema = strictObject({
  ...requestContextShape, placeKey: z.string().cuid(), arrivalDate: z.string().date().optional(), departureDate: z.string().date().optional(),
}).superRefine((relation, context) => { if (relation.arrivalDate && relation.departureDate && relation.departureDate < relation.arrivalDate) context.addIssue({ code: z.ZodIssueCode.custom, path: ['departureDate'], message: 'departureDate must not precede arrivalDate.' }); });
export const travelDeleteInputSchema = strictObject(requestContextShape);

export function placeDto(place: Place, visitCount: number) {
  return { key: place.key, kind: place.kind, name: place.name, description: place.description ?? null, latitude: place.latitude, longitude: place.longitude, countryCode: place.countryCode ?? null, country: place.country ?? null, continent: place.continent ?? null, region: place.region ?? null, city: place.city ?? null, wishlist: place.isWishlist, isWishlist: place.isWishlist, isFavorite: place.isFavorite, visitCount, visited: visitCount > 0, createdAt: place.createdAt, updatedAt: place.updatedAt };
}
export function tripDto(trip: Trip, itinerary: TravelOverviewRow['trips'][number]['itinerary'] = []) {
  const places = itinerary.map(({ relation, place, visitCount }) => ({ key: relation.key, placeKey: place.key, position: relation.position, arrivalDate: relation.arrivalDate ?? null, departureDate: relation.departureDate ?? null, place: placeDto(place, visitCount) }));
  return { key: trip.key, name: trip.name, description: trip.description ?? null, startDate: trip.startDate ?? null, endDate: trip.endDate ?? null, isFavorite: trip.isFavorite, places, itinerary: places, createdAt: trip.createdAt, updatedAt: trip.updatedAt };
}

type Embed = typeof embedText;
export function createTravelService(options: { repository?: TravelRepository; embed?: Embed; createKey?: () => string; now?: () => string } = {}) {
  const repository = options.repository ?? createTravelRepository();
  const embed = options.embed ?? embedText;
  const createKey = options.createKey ?? newId;
  const now = options.now ?? (() => new Date().toISOString());
  const access = (input: { organizationKey: string; scopeKey: string }, userKey: string): TravelAccessContext => ({ ...input, userKey });
  const embedding = async (fields: readonly string[], value: Record<string, unknown>) => currentEmbeddingSchema.parse(await embed({ text: buildEmbeddingText(fields, value)! }));
  return {
    async overview(raw: unknown, userKey: string) { const input = travelOverviewInputSchema.parse(raw); const row = await repository.overview(access(input, userKey)); return { places: row.places.map(({ place, visitCount }) => placeDto(place, visitCount)), trips: row.trips.map(({ trip, itinerary }) => tripDto(trip, itinerary)) }; },
    async createPlace(raw: unknown, userKey: string) { const input = travelPlaceInputSchema.parse(raw); const context = access(input, userKey); await repository.authorizeWrite(context); if (input.kind === 'country') { const existing = await repository.findCountry(context, input.countryCode); if (existing) return { place: placeDto(existing, 0) }; } const timestamp = now(); const draft = { ...input, key: createKey(), isWishlist: input.wishlist, isFavorite: false, deletedAt: null, createdAt: timestamp, updatedAt: timestamp }; const place = placeSchema.parse({ ...draft, embedding: await embedding(placesEmbeddingFields, draft) }); return { place: placeDto(await repository.createPlace(context, place), 0) }; },
    async createVisit(placeKey: string, raw: unknown, userKey: string) { const input = travelVisitInputSchema.parse(raw); const timestamp = now(); const visit = placeVisitSchema.parse({ key: createKey(), scopeKey: input.scopeKey, placeKey, ...(input.tripKey ? { tripKey: input.tripKey } : {}), ...(input.arrivedAt ? { arrivedAt: input.arrivedAt } : {}), ...(input.departedAt ? { departedAt: input.departedAt } : {}), createdAt: timestamp, updatedAt: timestamp }); const saved = await repository.createVisit(access(input, userKey), visit, timestamp); return { place: placeDto(saved.place, saved.visitCount), visit: { key: saved.visit.key, placeKey: saved.visit.placeKey, tripKey: saved.visit.tripKey ?? null, arrivedAt: saved.visit.arrivedAt ?? null, departedAt: saved.visit.departedAt ?? null, createdAt: saved.visit.createdAt, updatedAt: saved.visit.updatedAt } }; },
    async createTrip(raw: unknown, userKey: string) { const input = travelTripInputSchema.parse(raw); const context = access(input, userKey); await repository.authorizeWrite(context); const timestamp = now(); const draft = { ...input, key: createKey(), isFavorite: false, deletedAt: null, createdAt: timestamp, updatedAt: timestamp }; const trip = tripSchema.parse({ ...draft, embedding: await embedding(tripsEmbeddingFields, draft) }); return { trip: tripDto(await repository.createTrip(context, trip)) }; },
    async appendPlace(tripKey: string, raw: unknown, userKey: string) { const input = travelTripPlaceInputSchema.parse(raw); const context = access(input, userKey); const relation: Omit<TripPlace, 'position'> = { key: createKey(), scopeKey: input.scopeKey, tripKey, placeKey: input.placeKey, ...(input.arrivalDate ? { arrivalDate: input.arrivalDate } : {}), ...(input.departureDate ? { departureDate: input.departureDate } : {}), createdAt: now() }; await repository.appendPlace(context, relation); const updated = (await repository.overview(context)).trips.find(({ trip }) => trip.key === tripKey); if (!updated) throw new TravelRepositoryError('not_found'); return { trip: tripDto(updated.trip, updated.itinerary) }; },
    async removePlace(tripKey: string, placeKey: string, raw: unknown, userKey: string) { const input = travelDeleteInputSchema.parse(raw); const context = access(input, userKey); await repository.removePlace(context, tripKey, placeKey); const updated = (await repository.overview(context)).trips.find(({ trip }) => trip.key === tripKey); if (!updated) throw new TravelRepositoryError('not_found'); return { trip: tripDto(updated.trip, updated.itinerary) }; },
  };
}

export type TravelService = ReturnType<typeof createTravelService>;
