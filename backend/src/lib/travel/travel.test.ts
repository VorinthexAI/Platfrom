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
  sources: [],
  assetConcepts,
  imageRequestToken: 'opaque-token',
});
const { imageRequestToken: _token, sources: _sources, assetConcepts: _concepts, ...modelDetail } = detail;

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

  test('authorizes before one pinned Luna web search and seals its four image results', async () => {
    const calls: unknown[][] = [];
    const controller = new AbortController();
    let authorized = false;
    let sealed: unknown;
    const repository = { authorizeRead: async (context: TravelAccessContext) => { calls.push(['authorize', context]); authorized = true; } } as unknown as TravelRepository;
    const execute: any = async (...args: unknown[]) => {
      expect(authorized).toBe(true);
      calls.push(['execute', ...args]);
      const portugalDetail = { ...modelDetail, title: 'Portugal', summary: 'Portugal is a country in southwestern Europe.', location: { ...modelDetail.location, name: 'Portugal', country: 'Portugal', countryCode: 'PT', continent: 'Europe' } };
      return { output: {
        text: `Result:\n\`\`\`json\n${JSON.stringify(portugalDetail)}\n\`\`\``,
        citations: [{ title: 'Official Portugal source', url: 'https://www.portugal.gov.pt/' }],
        sources: ['https://www.portugal.gov.pt/'],
        images: [0, 1, 2, 3].map((index) => ({ imageUrl: `https://images.example.com/portugal-${index}.jpg`, sourcePageUrl: `https://example.com/portugal-${index}`, caption: `Portugal image ${index + 1}` })),
      } };
    };
    const service = createTravelService({ repository, execute, now: () => '2026-08-19T12:00:00.000Z', issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'opaque-token'; } });
    const country = { name: 'Portugal', code: 'pt', continent: 'Europe', lat: 39.4, lon: -8.2 };
    const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country }, 'secret-user-key', { signal: controller.signal, timeoutMs: 2_000 });
    expect(result.place).toMatchObject({ title: 'Portugal', imageRequestToken: 'opaque-token', sources: [{ title: 'Official Portugal source', url: 'https://www.portugal.gov.pt/' }], location: { kind: 'country', name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 } });
    expect(calls[0]).toEqual(['authorize', { organizationKey: 'organization', scopeKey, userKey: 'secret-user-key' }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.[1]).toEqual({ mode: 'fixed', organizationKey: 'organization', actionSlug: 'web-search', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    expect(calls[1]?.[2]).toMatchObject({ imageCount: 4, prompt: expect.stringContaining('Search the live web') });
    expect(calls[1]?.[3]).toEqual({ signal: controller.signal, timeoutMs: 2_000 });
    expect(sealed).toEqual({
      version: 2,
      issuedAt: Date.parse('2026-08-19T12:00:00.000Z'),
      nonce: 'A'.repeat(43),
      organizationKey: 'organization',
      scopeKey,
      country: { name: 'Portugal', countryCode: 'PT', continent: 'Europe', latitude: 39.4, longitude: -8.2 },
      images: [0, 1, 2, 3].map((index) => ({ role: ['hero', 'scene-1', 'scene-2', 'scene-3'][index], title: `Portugal image ${index + 1}`, url: `https://images.example.com/portugal-${index}.jpg`, sourcePageUrl: `https://example.com/portugal-${index}` })),
    });
  });

  test('returns factual text and four web images across a representative country matrix', async () => {
    const countries = [
      { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 },
      { name: 'Brazil', code: 'BR', continent: 'South America', lat: -14.2, lon: -51.9 },
      { name: 'Kenya', code: 'KE', continent: 'Africa', lat: 0.02, lon: 37.9 },
      { name: 'Norway', code: 'NO', continent: 'Europe', lat: 60.5, lon: 8.5 },
      { name: 'New Zealand', code: 'NZ', continent: 'Oceania', lat: -40.9, lon: 174.9 },
      { name: 'Canada', code: 'CA', continent: 'North America', lat: 56.1, lon: -106.3 },
    ] as const;
    for (const country of countries) {
      let sealed: any;
      const countryDetail = { ...modelDetail, title: country.name, summary: `${country.name} has current country information.`, location: { ...modelDetail.location, name: country.name, country: country.name, countryCode: country.code, continent: country.continent } };
      const service = createTravelService({
        repository: { authorizeRead: async () => {} } as unknown as TravelRepository,
        execute: (async () => ({ output: { text: JSON.stringify(countryDetail), citations: [{ title: `${country.name} official`, url: `https://example.com/${country.code.toLowerCase()}` }], sources: [], images: [0, 1, 2, 3].map((index) => ({ imageUrl: `https://images.example.com/${country.code.toLowerCase()}-${index}.jpg`, sourcePageUrl: `https://example.com/${country.code.toLowerCase()}/image-${index}` })) } })) as any,
        issueImageNonce: () => 'A'.repeat(43),
        encryptImageRequest: (value) => { sealed = value; return `token-${country.code}`; },
      });
      const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: country.name, country }, 'user');
      expect(result.place.summary).toContain(country.name);
      expect(result.place.facts.length).toBeGreaterThanOrEqual(3);
      expect(result.place.sources).toHaveLength(1);
      expect(sealed.images).toHaveLength(4);
      expect(sealed.images.every((image: any) => image.url.startsWith('https://'))).toBe(true);
    }
  });

  test('does not call the model when read access is denied', async () => {
    let calls = 0;
    const service = createTravelService({ repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository, execute: (async () => { calls += 1; }) as any });
    await expect(service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(calls).toBe(0);
  });

  test('rejects web results for a different authoritative country', async () => {
    const service = createTravelService({
      repository: { authorizeRead: async () => {} } as unknown as TravelRepository,
      execute: (async () => ({ output: { text: JSON.stringify(modelDetail), citations: [], sources: [], images: [{ imageUrl: 'https://images.example.com/japan.jpg', sourcePageUrl: 'https://example.com/japan' }] } })) as any,
    });
    await expect(service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country: { name: 'Portugal', code: 'PT', continent: 'Europe', lat: 39.4, lon: -8.2 } }, 'user')).rejects.toThrow('returned JP for selected country PT');
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
