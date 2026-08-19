import { describe, expect, test } from 'bun:test';
import { placeSchema } from '@/lib/db/places.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createTravelRepository, type TravelDatabase, type TravelRepository } from './repository';
import { createTravelService, placeDto, travelOverviewInputSchema } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const place = placeSchema.parse({ key, scopeKey, name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.6, embedding, createdAt: timestamp });

describe('travel contracts', () => {
  test('strictly validates overview input', () => {
    const context = { organizationKey: 'organization', scopeKey };
    expect(travelOverviewInputSchema.parse(context)).toEqual(context);
    expect(travelOverviewInputSchema.safeParse({ ...context, unknown: true }).success).toBe(false);
  });

  test('returns a public DTO without scope or embedding data', () => {
    expect(placeDto(place)).toEqual({ key, name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.6, createdAt: timestamp });
  });

  test('lists saved cities through the read-only service', async () => {
    const repository = { overview: async () => [place] } as TravelRepository;
    const service = createTravelService({ repository });
    expect(Object.keys(service)).toEqual(['overview']);
    await expect(service.overview({ organizationKey: 'organization', scopeKey }, 'user')).resolves.toEqual({ places: [placeDto(place)] });
  });
});

describe('travel repository', () => {
  test('lists authorized places in repository order', async () => {
    const database: TravelDatabase = { async query(query) { return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : [{ ...place, _key: place.key }]; } }; } };
    const repository = createTravelRepository(database);
    await expect(repository.overview({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toEqual([place]);
  });
});
