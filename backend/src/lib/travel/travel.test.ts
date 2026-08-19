import { describe, expect, test } from 'bun:test';
import { placeSchema } from '@/lib/db/places.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createTravelRepository, TravelRepositoryError, type TravelAccessContext, type TravelDatabase, type TravelRepository } from './repository';
import { createTravelService, placeDto, travelOverviewInputSchema, travelPlaceDetailSchema, travelPlaceFindInputSchema } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const place = placeSchema.parse({ key, scopeKey, name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.6, embedding, createdAt: timestamp });
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

describe('travel contracts and service', () => {
  test('keeps overview and place lookup inputs strict', () => {
    const context = { organizationKey: 'organization', scopeKey };
    expect(travelOverviewInputSchema.parse(context)).toEqual(context);
    expect(travelOverviewInputSchema.safeParse({ ...context, unknown: true }).success).toBe(false);
    expect(travelPlaceFindInputSchema.safeParse({ ...context, query: 'Japan', userKey: 'untrusted' }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, extra: true }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, assetConcepts: detail.assetConcepts.slice(0, 3) }).success).toBe(false);
  });

  test('preserves the simplified read-only overview architecture', async () => {
    expect(placeDto(place)).toEqual({ key, name: 'Tokyo', countryCode: 'JP', latitude: 35.6, longitude: 139.6, createdAt: timestamp });
    const repository = { overview: async () => [place] } as unknown as TravelRepository;
    const service = createTravelService({ repository });
    expect(Object.keys(service)).toEqual(['overview', 'findPlace', 'generatePlaceImages']);
    await expect(service.overview({ organizationKey: 'organization', scopeKey }, 'user')).resolves.toEqual({ places: [placeDto(place)] });
  });

  test('authorizes before one pinned target-supported ask call and seals the four concepts', async () => {
    const calls: unknown[][] = [];
    const controller = new AbortController();
    let authorized = false;
    let sealed: unknown;
    const repository = { authorizeRead: async (context: TravelAccessContext) => { calls.push(['authorize', context]); authorized = true; } } as unknown as TravelRepository;
    const execute: any = async (...args: unknown[]) => {
      expect(authorized).toBe(true);
      calls.push(['execute', ...args]);
      return { output: { text: `Result:\n\`\`\`json\n${JSON.stringify(modelDetail)}\n\`\`\``, toolCalls: [], stopReason: 'stop' } };
    };
    const service = createTravelService({ repository, execute, now: () => '2026-08-19T12:00:00.000Z', issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'opaque-token'; } });
    const country = { name: 'Portugal', code: 'pt', continent: 'Europe', lat: 39.4, lon: -8.2 };
    const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country }, 'secret-user-key', { signal: controller.signal, timeoutMs: 2_000 });
    expect(result.place).toMatchObject({ title: 'Portugal', imageRequestToken: 'opaque-token', location: { kind: 'country', name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 } });
    expect(calls[0]).toEqual(['authorize', { organizationKey: 'organization', scopeKey, userKey: 'secret-user-key' }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toEqual({ mode: 'fixed', organizationKey: 'organization', actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    expect(calls[1]?.[3]).toEqual({ signal: controller.signal, timeoutMs: 2_000 });
    expect(sealed).toEqual({ version: 1, issuedAt: Date.parse('2026-08-19T12:00:00.000Z'), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 }, concepts: assetConcepts });
  });

  test('does not call the model when read access is denied', async () => {
    let calls = 0;
    const service = createTravelService({ repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository, execute: (async () => { calls += 1; }) as any });
    await expect(service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(calls).toBe(0);
  });
});

describe('travel repository', () => {
  test('lists authorized places and exposes the same read authorization', async () => {
    const database: TravelDatabase = { async query(query) { return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : [{ ...place, _key: place.key }]; } }; } };
    const repository = createTravelRepository(database);
    await expect(repository.authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toBeUndefined();
    await expect(repository.overview({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toEqual([place]);
  });

  test('denies absent membership', async () => {
    const database: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    await expect(createTravelRepository(database).authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
