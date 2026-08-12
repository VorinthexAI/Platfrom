import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { placeSchema } from '@/lib/db/places.node';
import { tripSchema } from '@/lib/db/trips.node';
import { tripPlaceSchema } from '@/lib/db/trip-places.node';
import { createTravelRepository, hasTravelWriteAccess, TravelRepositoryError, type TravelAccessContext, type TravelDatabase, type TravelRepository } from './repository';
import { createTravelService, placeDto, travelPlaceInputSchema, travelTripInputSchema, travelTripPlaceInputSchema, travelVisitInputSchema, tripDto } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const thirdKey = 'cmrnlzf640001qc7kazsr96k6';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const place = placeSchema.parse({ key, scopeKey: otherKey, kind: 'place', name: 'Tokyo', latitude: 35.6, longitude: 139.6, countryCode: 'JP', isWishlist: true, embedding, createdAt: timestamp, updatedAt: timestamp });
const trip = tripSchema.parse({ key: thirdKey, scopeKey: otherKey, name: 'Japan', embedding, createdAt: timestamp, updatedAt: timestamp });

describe('travel contracts', () => {
  test('strictly rejects unknown body fields and invalid date ranges', () => {
    const context = { organizationKey: 'organization', scopeKey: otherKey };
    expect(travelPlaceInputSchema.safeParse({ ...context, kind: 'country', name: 'Japan', latitude: 36, longitude: 138, countryCode: 'JP', unknown: true }).success).toBe(false);
    expect(travelPlaceInputSchema.safeParse({ ...context, kind: 'place', name: 'Nowhere', latitude: 0, longitude: 0, countryCode: 'ZZ' }).success).toBe(false);
    expect(travelVisitInputSchema.safeParse({ ...context, arrivedAt: '2026-08-12', departedAt: '2026-08-11' }).success).toBe(false);
    expect(travelTripInputSchema.safeParse({ ...context, name: 'Invalid', startDate: '2026-08-12', endDate: '2026-08-11' }).success).toBe(false);
    expect(travelTripPlaceInputSchema.safeParse({ ...context, placeKey: key, arrivalDate: '2026-08-12', departureDate: '2026-08-11' }).success).toBe(false);
  });

  test('allows elevated organization roles or writable active scope roles only', () => {
    expect(hasTravelWriteAccess('owner', null)).toBe(true);
    expect(hasTravelWriteAccess('admin', 'viewer')).toBe(true);
    expect(hasTravelWriteAccess('member', 'moderator')).toBe(true);
    expect(hasTravelWriteAccess('viewer', 'viewer')).toBe(false);
    expect(hasTravelWriteAccess(null, null)).toBe(false);
  });

  test('returns safe DTOs and preserves repository itinerary order', () => {
    const relation = tripPlaceSchema.parse({ key: otherKey, scopeKey: otherKey, tripKey: trip.key, placeKey: place.key, position: 1, createdAt: timestamp });
    const safePlace = placeDto(place, 1);
    const safeTrip = tripDto(trip, [{ relation, place, visitCount: 1 }]);
    expect(safePlace).toMatchObject({ key, kind: 'place', wishlist: true, visited: true });
    expect(safePlace).not.toHaveProperty('embedding');
    expect(safePlace).not.toHaveProperty('scopeKey');
    expect(safeTrip.places[0]).toMatchObject({ placeKey: key, position: 1, place: { key, visited: true } });
    expect(safeTrip).not.toHaveProperty('embedding');
  });

  test('generates place keys, timestamps, and embeddings on the server', async () => {
    let saved = place;
    const repository = { authorizeWrite: async () => undefined, findCountry: async () => null, createPlace: async (_context: TravelAccessContext, value: typeof place) => (saved = value) } as unknown as TravelRepository;
    const service = createTravelService({ repository, createKey: () => key, now: () => timestamp, embed: async () => embedding });
    const output = await service.createPlace({ organizationKey: 'organization', scopeKey: otherKey, kind: 'country', name: 'Japan', latitude: 36, longitude: 138, countryCode: 'jp', wishlist: true }, 'user');
    expect(saved).toMatchObject({ key, kind: 'country', countryCode: 'JP', isWishlist: true, createdAt: timestamp, updatedAt: timestamp, embedding });
    expect(output.place).not.toHaveProperty('embedding');
  });

  test('authorizes before requesting an embedding', async () => {
    let embeddingCalls = 0;
    const repository = { authorizeWrite: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository;
    const service = createTravelService({ repository, embed: async () => { embeddingCalls += 1; return embedding; } });
    await expect(service.createPlace({ organizationKey: 'organization', scopeKey: otherKey, kind: 'country', name: 'Japan', latitude: 36, longitude: 138, countryCode: 'JP' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(embeddingCalls).toBe(0);
  });
});

describe('travel repository atomic itinerary changes', () => {
  test('replays duplicate itinerary places without inserting again', async () => {
    const queries: string[] = [];
    const relation = { _key: otherKey, scopeKey: otherKey, tripKey: trip.key, placeKey: place.key, position: 1, createdAt: timestamp };
    const transaction: TravelDatabase = { async query(query) { queries.push(query); return { async all() { if (query.includes('RETURN membership._key')) return ['membership']; if (query.includes('RETURN { place, existing')) return [{ place: { ...place, _key: place.key }, existing: relation, position: 2 }]; return []; } }; } };
    const repository = createTravelRepository(transaction, async (_collections, operation) => operation(transaction));
    await expect(repository.appendPlace({ organizationKey: 'organization', scopeKey: otherKey, userKey: 'user' }, { key: otherKey, scopeKey: otherKey, tripKey: trip.key, placeKey: place.key, createdAt: timestamp })).resolves.toMatchObject({ relation: { position: 1 } });
    expect(queries.some((query) => query.includes('INSERT @relation'))).toBe(false);
  });

  test('removes and resequences in one transaction without transient unique positions', async () => {
    const queries: string[] = [];
    let declaration: { read?: string[]; write: string[] } | undefined;
    const transaction: TravelDatabase = { async query(query) { queries.push(query); return { async all() { if (query.includes('RETURN membership._key')) return ['membership']; if (query.includes('FOR relation IN tripPlaces')) return [{ _key: key, scopeKey: otherKey, tripKey: trip.key, placeKey: place.key, position: 2, createdAt: timestamp }]; return []; } }; } };
    const repository = createTravelRepository(transaction, async (collections, operation) => { declaration = collections; return operation(transaction); });
    await repository.removePlace({ organizationKey: 'organization', scopeKey: otherKey, userKey: 'user' }, trip.key, place.key);
    expect(declaration?.write).toEqual(expect.arrayContaining(['trips', 'tripPlaces']));
    expect(queries.some((query) => query.includes('position: -item.position'))).toBe(true);
    expect(queries.some((query) => query.includes('position: -item.position - 1'))).toBe(true);
  });

  test('denies when no active organization and writable scope membership is derived', async () => {
    const database: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    const repository = createTravelRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.createPlace({ organizationKey: 'organization', scopeKey: otherKey, userKey: 'user' }, place)).rejects.toBeInstanceOf(TravelRepositoryError);
  });
});
