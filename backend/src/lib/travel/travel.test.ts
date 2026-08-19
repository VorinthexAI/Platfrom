import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { placeSchema } from '@/lib/db/places.node';
import { tripSchema } from '@/lib/db/trips.node';
import { tripPlaceSchema } from '@/lib/db/trip-places.node';
import { createTravelRepository, hasTravelWriteAccess, TravelRepositoryError, type TravelAccessContext, type TravelDatabase, type TravelRepository } from './repository';
import { createTravelService, placeDto, travelPlaceDetailSchema, travelPlaceFindInputSchema, travelPlaceInputSchema, travelTripInputSchema, travelTripPlaceInputSchema, travelVisitInputSchema, tripDto } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const otherKey = 'cmrnlzf640001qc7kazsr96k5';
const thirdKey = 'cmrnlzf640001qc7kazsr96k6';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const place = placeSchema.parse({ key, scopeKey: otherKey, kind: 'place', name: 'Tokyo', latitude: 35.6, longitude: 139.6, countryCode: 'JP', isWishlist: true, embedding, createdAt: timestamp, updatedAt: timestamp });
const trip = tripSchema.parse({ key: thirdKey, scopeKey: otherKey, name: 'Japan', embedding, createdAt: timestamp, updatedAt: timestamp });
const assetConcepts = [
  { title: 'Japan overview', prompt: 'Role: hero. Premium cinematic editorial travel imagery of Japan, portrait composition, restrained natural colors, clearly an AI interpretation, with no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Japan coast', prompt: 'Role: scene-1. Premium cinematic editorial travel imagery of a Japanese coastal scene, portrait composition, restrained natural colors, clearly an AI interpretation, with no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Japan street', prompt: 'Role: scene-2. Premium cinematic editorial travel imagery of a quiet Japanese street scene, portrait composition, restrained natural colors, clearly an AI interpretation, with no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Japan garden', prompt: 'Role: scene-3. Premium cinematic editorial travel imagery of a Japanese garden scene, portrait composition, restrained natural colors, clearly an AI interpretation, with no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
] as const;
const detail = travelPlaceDetailSchema.parse({
  location: { kind: 'country', name: 'Japan', countryCode: 'JP', country: 'Japan', continent: 'Asia', region: null, city: null, latitude: 36.2048, longitude: 138.2529 },
  title: 'Japan', summary: 'An island country in East Asia.',
  facts: [{ label: 'Capital', value: 'Tokyo' }, { label: 'Population', value: 'About 124 million' }, { label: 'Government', value: 'Constitutional monarchy' }],
  highlights: [{ title: 'Kyoto', description: 'Historic temples and traditional neighborhoods.' }],
  practicalInfo: { bestTimeToVisit: 'Spring and autumn are generally mild.', languages: ['Japanese'], currency: 'Japanese yen (JPY)', timeZone: 'Japan Standard Time (UTC+9)', safety: 'Review current official travel advice.', entryRequirements: 'Verify current requirements with official authorities before travel.' },
  assetConcepts,
  imageRequestToken: 'opaque-token',
});
const { imageRequestToken: _token, ...modelDetail } = detail;

describe('travel contracts', () => {
  test('strictly rejects unknown body fields and invalid date ranges', () => {
    const context = { organizationKey: 'organization', scopeKey: otherKey };
    expect(travelPlaceInputSchema.safeParse({ ...context, kind: 'country', name: 'Japan', latitude: 36, longitude: 138, countryCode: 'JP', unknown: true }).success).toBe(false);
    expect(travelPlaceInputSchema.safeParse({ ...context, kind: 'place', name: 'Nowhere', latitude: 0, longitude: 0, countryCode: 'ZZ' }).success).toBe(false);
    expect(travelVisitInputSchema.safeParse({ ...context, arrivedAt: '2026-08-12', departedAt: '2026-08-11' }).success).toBe(false);
    expect(travelTripInputSchema.safeParse({ ...context, name: 'Invalid', startDate: '2026-08-12', endDate: '2026-08-11' }).success).toBe(false);
    expect(travelTripPlaceInputSchema.safeParse({ ...context, placeKey: key, arrivalDate: '2026-08-12', departureDate: '2026-08-11' }).success).toBe(false);
    expect(travelPlaceFindInputSchema.safeParse({ ...context, query: 'Japan', userKey: 'untrusted' }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, extra: true }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, location: { ...detail.location, countryCode: 'Japan' } }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, assetConcepts: detail.assetConcepts.slice(0, 3) }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, assetConcepts: detail.assetConcepts.map((concept, index) => index === 3 ? detail.assetConcepts[2] : concept) }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, assetConcepts: [detail.assetConcepts[1], detail.assetConcepts[0], detail.assetConcepts[2], detail.assetConcepts[3]] }).success).toBe(false);
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

  test('authorizes before one pinned bounded ask call and parses fenced JSON', async () => {
    const calls: unknown[][] = [];
    const controller = new AbortController();
    let authorized = false;
    const repository = { authorizeRead: async (context: TravelAccessContext) => { calls.push(['authorize', context]); authorized = true; } } as unknown as TravelRepository;
    const execute: any = async (...args: unknown[]) => {
      expect(authorized).toBe(true);
      calls.push(['execute', ...args]);
      return { output: { text: `Result:\n\`\`\`json\n${JSON.stringify(modelDetail)}\n\`\`\``, toolCalls: [], stopReason: 'stop' } };
    };
    const service = createTravelService({ repository, execute, encryptImageRequest: () => 'opaque-token' });
    await expect(service.findPlace({ organizationKey: 'organization', scopeKey: otherKey, query: ' Japan ' }, 'secret-user-key', { signal: controller.signal, timeoutMs: 2_000 })).resolves.toEqual({ place: detail });
    expect(calls[0]).toEqual(['authorize', { organizationKey: 'organization', scopeKey: otherKey, userKey: 'secret-user-key' }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toEqual({ mode: 'model', organizationKey: 'organization', actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite' });
    expect(calls[1]?.[3]).toEqual({ signal: controller.signal, timeoutMs: 2_000 });
    expect(JSON.stringify(calls[1]?.[2])).not.toContain('organization');
    expect(JSON.stringify(calls[1]?.[2])).not.toContain(otherKey);
    expect(JSON.stringify(calls[1]?.[2])).not.toContain('secret-user-key');
    expect(JSON.stringify(calls[1]?.[2])).toContain('assetConcepts');
    expect(JSON.stringify(calls[1]?.[2])).toContain('Role: hero.');
  });

  test('does not call the model when read access is denied and safely projects malformed model output', async () => {
    let calls = 0;
    const denied = createTravelService({ repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository, execute: (async () => { calls += 1; }) as any, encryptImageRequest: () => 'opaque-token' });
    await expect(denied.findPlace({ organizationKey: 'organization', scopeKey: otherKey, query: 'Japan' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(calls).toBe(0);

    const repository = { authorizeRead: async () => undefined } as unknown as TravelRepository;
    for (const text of ['not json', JSON.stringify({ ...modelDetail, unexpected: true })]) {
      const service = createTravelService({ repository, execute: (async () => ({ output: { text, toolCalls: [], stopReason: 'stop' } })) as any, encryptImageRequest: () => 'opaque-token' });
      const result = await service.findPlace({ organizationKey: 'organization', scopeKey: otherKey, query: 'Japan (JP), Asia' }, 'user');
      expect(result.place).toMatchObject({ location: { kind: 'country', name: 'Japan', countryCode: 'JP', continent: 'Asia' }, title: 'Japan' });
      expect(travelPlaceDetailSchema.safeParse(result.place).success).toBe(true);
    }
    const longQuery = `${'A'.repeat(160)} (AA), ${'B'.repeat(33)}`;
    const service = createTravelService({ repository, execute: (async () => ({ output: { text: 'malformed', toolCalls: [], stopReason: 'stop' } })) as any, encryptImageRequest: () => 'opaque-token' });
    const fallback = await service.findPlace({ organizationKey: 'organization', scopeKey: otherKey, query: longQuery }, 'user');
    expect(fallback.place.assetConcepts).toHaveLength(4);
    expect(new Set(fallback.place.assetConcepts.map(({ title, prompt }) => `${title}\0${prompt}`))).toHaveProperty('size', 4);
  });

  test('overrides model identity from an exact country selector and seals authoritative concepts', async () => {
    let sealed: any;
    const repository = { authorizeRead: async () => undefined } as unknown as TravelRepository;
    const service = createTravelService({ repository, execute: (async () => ({ output: { text: JSON.stringify(modelDetail), toolCalls: [], stopReason: 'stop' } })) as any, now: () => '2026-08-19T12:00:00.000Z', issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'sealed'; } });
    const country = { name: 'Portugal', code: 'pt', continent: 'Europe', lat: 39.4, lon: -8.2 };
    const result = await service.findPlace({ organizationKey: 'organization', scopeKey: otherKey, query: 'wrong model location', country }, 'user');
    expect(result.place).toMatchObject({ title: 'Portugal', imageRequestToken: 'sealed', location: { kind: 'country', name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 } });
    expect(sealed).toEqual({ version: 1, issuedAt: Date.parse('2026-08-19T12:00:00.000Z'), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey: otherKey, country: { name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 }, concepts: assetConcepts });
    expect(travelPlaceFindInputSchema.safeParse({ organizationKey: 'organization', scopeKey: otherKey, query: 'Portugal', country: { ...country, prompt: 'attacker' } }).success).toBe(false);
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

  test('exposes read authorization for active viewers and denies absent membership', async () => {
    const allowed: TravelDatabase = { async query(query) { return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : []; } }; } };
    await expect(createTravelRepository(allowed).authorizeRead({ organizationKey: 'organization', scopeKey: otherKey, userKey: 'user' })).resolves.toBeUndefined();
    const denied: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    await expect(createTravelRepository(denied).authorizeRead({ organizationKey: 'organization', scopeKey: otherKey, userKey: 'user' })).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
