import { describe, expect, test } from 'bun:test';
import { placeSchema, type Place } from '@/lib/db/places.node';
import { imageSchema } from '@/lib/db/images.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createTravelRepository, TravelRepositoryError, type TravelAccessContext, type TravelDatabase, type TravelRepository } from './repository';
import { createTravelService, placeDto, travelCityDetailSchema, travelCityFindInputSchema, travelOverviewInputSchema, travelPlaceCreateInputSchema, travelPlaceDetailSchema, travelPlaceFindInputSchema } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const place = placeSchema.parse({ key, scopeKey, name: 'Tokyo', summary: 'A city of neighborhoods.', countryCode: 'JP', latitude: 35.6, longitude: 139.6, embedding, embeddingContentVersion: 2, createdAt: timestamp });
const summary = 'Japan brings ancient traditions and intensely modern city life into unusually close contact. Travelers can move from quiet temple gardens and mountain forests to neon districts, coastal villages, and carefully designed contemporary spaces within a single journey. Seasonal change shapes the experience, from spring blossoms to autumn color and snowy northern landscapes. Excellent public transport, regional craftsmanship, thoughtful hospitality, and distinctive local food make the country rewarding for both first-time visitors and slower repeat exploration.';
const cities = ['Tokyo', 'Kyoto', 'Osaka', 'Hiroshima', 'Nara', 'Sapporo', 'Fukuoka', 'Kanazawa', 'Nagasaki', 'Yokohama'].map((name, index) => ({ name, latitude: 30 + index, longitude: 130 + index }));
const modelDetail = {
  location: { kind: 'country', name: 'Japan', countryCode: 'JP', country: 'Japan', continent: 'Asia', region: null, city: null, latitude: 36.2048, longitude: 138.2529 },
  title: 'Japan', summary,
  culture: 'Daily life combines deep ritual, regional festivals, refined craft traditions, contemporary design, and a strong respect for shared spaces.',
  food: 'Regional cooking ranges from sushi and ramen to okonomiyaki, kaiseki, mountain vegetables, seafood markets, and precise seasonal sweets.',
  whyVisit: 'Visit for the contrast of dense cities and accessible nature, exceptional transport, living traditions, regional variety, and consistently thoughtful hospitality.',
  popularCities: cities,
  heroImagePrompt: 'A broad Japanese landscape where forested mountains meet a compact historic district and a modern skyline, cedar and maple vegetation, timber and stone materials, soft mist, restrained natural colors, and clear early-morning light.',
} as const;
const { heroImagePrompt: _heroImagePrompt, ...publicModelDetail } = modelDetail;
const detail = travelPlaceDetailSchema.parse({ ...publicModelDetail, imageRequestToken: 'opaque-token' });

describe('travel contracts and service', () => {
  test('creates a missing staged preview through the canonical generator and preserves staged bytes', async () => {
    const bytesByKey = new Map<string, Uint8Array>();
    const deleted: string[] = [], processed: Uint8Array[] = [];
    const storage = { upload: async ({ key, bytes }: any) => { bytesByKey.set(key, bytes); return { storageKey: key }; }, download: async (key: string) => { const bytes = bytesByKey.get(key); if (!bytes) throw new Error('missing'); return { bytes }; }, delete: async (key: string) => { deleted.push(key); bytesByKey.delete(key); }, copy: async () => ({ storageKey: '' }) };
    const token = { version: 4, issuedAt: Date.parse(timestamp), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2 }, hero: { title: 'Japan travel interpretation', prompt: 'Japan landscape' } } as const;
    let providerCalls = 0, converges = 0;
    const repository = { authorizeRead: async () => {}, authorizeWrite: async () => key, cancelManagedImageDeletion: async () => {}, acknowledgeManagedImageDeletion: async () => {}, compensateManagedImage: async () => null, convergeManagedPlace: async ({ place }: any) => { converges += 1; return place; } } as unknown as TravelRepository;
    const service = createTravelService({ repository, storage, decryptImageRequest: () => token, getImage: async () => null, embed: async () => embedding, now: () => timestamp,
      placeImages: { execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: 'AQ==', mimeType: 'image/png' }] }, costUsd: 0.01 }; }) as any, transform: async () => new Uint8Array([7, 8, 9]), now: () => Date.parse(timestamp), log: () => {} },
      process: (async (input: any) => { processed.push(input.file.bytes); return imageSchema.parse({ key: input.imageKey, scopeKey, filename: input.file.filename, caption: 'Japan landscape', imageCaptionKey: key, createdByKey: key, storageKey: 'media/japan.webp', mimeType: 'image/webp', sizeBytes: 3, width: 1536, height: 864, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp }); }) as any });
    const input = { organizationKey: 'organization', scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' };
    await expect(service.createPlace(input, 'user')).resolves.toMatchObject({ place: { name: 'Japan' } });
    expect(providerCalls).toBe(1); expect(processed.map((bytes) => [...bytes])).toEqual([[7, 8, 9]]); expect(converges).toBe(1); expect(deleted).toContain('pending/gallery/place-media/' + 'A'.repeat(43) + '/preview.webp');
  });

  test('compensates a newly processed deterministic image when later place persistence fails', async () => {
    const stagedKey = `pending/gallery/place-media/${'B'.repeat(43)}/preview.webp`, deleted: string[] = [], acknowledged: string[] = [];
    const storage = { upload: async ({ key }: any) => ({ storageKey: key }), download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async (key: string) => { deleted.push(key); }, copy: async () => ({ storageKey: '' }) };
    const token = { version: 4, issuedAt: Date.parse(timestamp), nonce: 'B'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2 }, hero: { title: 'Japan', prompt: 'Japan' } } as const;
    const repository = { authorizeWrite: async () => key, cancelManagedImageDeletion: async () => {}, compensateManagedImage: async () => 'media/orphan.webp', acknowledgeManagedImageDeletion: async (storageKey: string) => { acknowledged.push(storageKey); }, convergeManagedPlace: async () => { throw new Error('converge failed'); } } as unknown as TravelRepository;
    const image = imageSchema.parse({ key, scopeKey, filename: 'japan.webp', caption: 'Japan', imageCaptionKey: key, createdByKey: key, storageKey: 'media/orphan.webp', mimeType: 'image/webp', sizeBytes: 3, width: 1, height: 1, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp });
    const service = createTravelService({ repository, storage, decryptImageRequest: () => token, getImage: async () => null, process: async () => image, embed: async () => embedding, now: () => timestamp });
    await expect(service.createPlace({ organizationKey: 'organization', scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }, 'user')).rejects.toThrow('converge failed');
    expect(stagedKey).toContain('pending/gallery'); expect(deleted).toContain('media/orphan.webp'); expect(acknowledged).toEqual(['media/orphan.webp']);
  });
  test('keeps inputs and the focused recommendation response strict', () => {
    const context = { organizationKey: 'organization', scopeKey };
    expect(travelOverviewInputSchema.parse(context)).toEqual(context);
    expect(travelOverviewInputSchema.safeParse({ ...context, unknown: true }).success).toBe(false);
    expect(travelPlaceFindInputSchema.safeParse({ ...context, query: 'Japan', userKey: 'untrusted' }).success).toBe(false);
    expect(travelPlaceCreateInputSchema.safeParse({ ...context, name: 'Japan', summary, countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }).success).toBe(true);
    expect(travelPlaceCreateInputSchema.safeParse({ ...context, name: 'Japan', countryCode: 'JP', latitude: 91, longitude: 138.2 }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, extra: true }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: cities.slice(0, 9) }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: [...cities.slice(0, 9), { ...cities[0]!, name: 'tokyo' }] }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: [...cities.slice(0, 9), { name: 'Kobe', latitude: 35, longitude: 181 }] }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, summary: '' }).success).toBe(false);
    expect(travelCityFindInputSchema.safeParse({ ...context, city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 1, lon: 1 } }).success).toBe(true);
    expect(travelCityDetailSchema.safeParse({ ...detail, popularCities: undefined }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, culture: undefined }).success).toBe(false);
  });

  test('preserves the simplified place overview projection', async () => {
    expect(placeDto(place)).toEqual({ key, name: 'Tokyo', summary: place.summary, countryCode: 'JP', latitude: 35.6, longitude: 139.6, createdAt: timestamp });
    const repository = { overview: async () => [place] } as unknown as TravelRepository;
    const service = createTravelService({ repository });
    expect(Object.keys(service)).toEqual(['overview', 'createPlace', 'findPlace', 'findCity', 'generatePlaceHeroImage']);
    await expect(service.overview({ organizationKey: 'organization', scopeKey }, 'user')).resolves.toEqual({ places: [placeDto(place)] });
  });

  test('authorizes writes before embedding and saves countries and cities through one canonical method', async () => {
    const calls: unknown[][] = [];
    const repository = {
      authorizeWrite: async (context: TravelAccessContext) => { calls.push(['authorizeWrite', context]); return key; },
      convergeManagedPlace: async (value: any) => { calls.push(['converge', value]); return value.place; },
    } as unknown as TravelRepository;
    const input = { organizationKey: 'organization', scopeKey, name: ' Japan ', summary: ' Island country. ', countryCode: 'jp', latitude: 36.2048, longitude: 138.2529, imageRequestToken: 'token' };
    const image = { key, scopeKey, filename: 'japan.webp', caption: 'Japan', imageCaptionKey: key, createdByKey: key, storageKey: 'media/japan.webp', mimeType: 'image/webp', sizeBytes: 1, width: 1, height: 1, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp } as any;
    const service = createTravelService({ repository, getImage: async () => image, storage: { delete: async () => {}, upload: async () => ({ storageKey: '' }), download: async () => ({ bytes: new Uint8Array() }), copy: async () => ({ storageKey: '' }) }, decryptImageRequest: () => ({ version: 4, issuedAt: Date.parse(timestamp), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2048, longitude: 138.2529 }, hero: { title: 'Japan', prompt: 'prompt' } }), embed: async (value) => { calls.push(['embed', value]); return embedding; }, now: () => timestamp });
    const result = await service.createPlace(input, 'trusted-user');
    expect(calls.map(([name]) => name)).toEqual(['authorizeWrite', 'embed', 'embed', 'converge']);
    expect(calls[0]?.[1]).toEqual({ organizationKey: 'organization', scopeKey, userKey: 'trusted-user' });
    expect((calls[3]?.[1] as any).place).toMatchObject({ scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2048, longitude: 138.2529, embedding, createdAt: timestamp });
    expect(result.place).toMatchObject({ name: 'Japan', countryCode: 'JP' });
  });

  test('does not call the embedding provider when place creation is unauthorized', async () => {
    let embeds = 0;
    const service = createTravelService({
      repository: { authorizeWrite: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository,
      embed: async () => { embeds += 1; return embedding; },
    });
    await expect(service.createPlace({ organizationKey: 'organization', scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(embeds).toBe(0);
  });

  test('authorizes before one direct guide request and seals one hero prompt', async () => {
    const calls: unknown[][] = [];
    const controller = new AbortController();
    let authorized = false, sealed: any;
    const repository = { authorizeRead: async (context: TravelAccessContext) => { calls.push(['authorize', context]); authorized = true; } } as unknown as TravelRepository;
    const execute: any = async (...args: unknown[]) => {
      expect(authorized).toBe(true); calls.push(['execute', ...args]);
      return { output: { text: JSON.stringify({ ...modelDetail, location: { ...modelDetail.location, name: 'Portugal', country: 'Portugal', countryCode: 'PT', continent: 'Europe' }, title: 'Portugal' }) } };
    };
    const service = createTravelService({ repository, execute, now: () => '2026-08-19T12:00:00.000Z', issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'opaque-token'; } });
    const country = { name: 'Portugal', code: 'pt', continent: 'Europe', lat: 39.4, lon: -8.2 };
    const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country }, 'secret-user-key', { signal: controller.signal, timeoutMs: 2_000 });
    expect(result.place).toMatchObject({ title: 'Portugal', summary, culture: modelDetail.culture, food: modelDetail.food, whyVisit: modelDetail.whyVisit, popularCities: cities, imageRequestToken: 'opaque-token' });
    expect(result.place).not.toHaveProperty('heroImagePrompt');
    expect(calls[0]).toEqual(['authorize', { organizationKey: 'organization', scopeKey, userKey: 'secret-user-key' }]);
    expect(calls[1]?.[1]).toEqual({ mode: 'fixed', organizationKey: 'organization', actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    expect(calls[1]?.[2]).toMatchObject({ systemPrompt: expect.stringContaining('Do not browse'), messages: [{ role: 'user', content: [{ type: 'text', text: expect.stringContaining('100 words total') }] }] });
    expect(calls[1]?.[2]).not.toHaveProperty('imageCount');
    expect(calls[1]?.[3]).toEqual({ signal: controller.signal, timeoutMs: 2_000 });
    expect(sealed).toMatchObject({ version: 4, issuedAt: Date.parse('2026-08-19T12:00:00.000Z'), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Portugal', countryCode: 'PT' }, place: { name: 'Portugal', summary, countryCode: 'PT', latitude: 39.4, longitude: -8.2 }, hero: { title: 'Portugal travel interpretation', prompt: expect.stringContaining(modelDetail.heroImagePrompt) } });
    expect(JSON.stringify(sealed)).not.toContain('https://');
  });

  test('returns ten cities and focused recommendations across representative countries', async () => {
    for (const country of [{ name: 'Japan', code: 'JP', continent: 'Asia' }, { name: 'Brazil', code: 'BR', continent: 'South America' }, { name: 'Kenya', code: 'KE', continent: 'Africa' }, { name: 'Norway', code: 'NO', continent: 'Europe' }]) {
      const researched = { ...modelDetail, title: country.name, summary: summary.replace('Japan', country.name), location: { ...modelDetail.location, name: country.name, country: country.name, countryCode: country.code, continent: country.continent } };
      const service = createTravelService({ repository: { authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async () => ({ output: { text: JSON.stringify(researched) } })) as any, issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: () => 'token' });
      const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: country.name, country: { ...country, lat: 1, lon: 1 } }, 'user');
      expect(result.place.popularCities).toHaveLength(10);
      expect(result.place).toMatchObject({ culture: expect.any(String), food: expect.any(String), whyVisit: expect.any(String) });
    }
  });

  test('grounds a city guide in its authoritative country and seals a city-specific hero', async () => {
    let sealed: unknown;
    const cityDetail = { ...modelDetail, popularCities: undefined, location: { ...modelDetail.location, kind: 'place', name: 'Tokyo', city: 'Tokyo' }, title: 'Tokyo' };
    const service = createTravelService({ repository: { authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async () => ({ output: { text: JSON.stringify(cityDetail) } })) as any, issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'token'; } });
    const result = await service.findCity({ organizationKey: 'organization', scopeKey, city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }, 'user');
    expect(result.city).toMatchObject({ title: 'Tokyo', location: { countryCode: 'JP', city: 'Tokyo' }, imageRequestToken: 'token' });
    expect(result.city).not.toHaveProperty('popularCities');
    expect(sealed).toMatchObject({ country: { countryCode: 'JP' }, hero: { title: 'Tokyo travel interpretation' } });
  });

  test('rejects wrong-country results and denies model work without access', async () => {
    let calls = 0;
    const denied = createTravelService({ repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository, execute: (async () => { calls += 1; }) as any });
    await expect(denied.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(calls).toBe(0);
    const mismatch = createTravelService({ repository: { authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async () => ({ output: { text: JSON.stringify(modelDetail) } })) as any });
    await expect(mismatch.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country: { name: 'Portugal', code: 'PT', continent: 'Europe', lat: 39.4, lon: -8.2 } }, 'user')).rejects.toThrow('returned JP for selected country PT');
  });
});

describe('travel repository', () => {
  test('hides managed collections for authorized users only when first created and preserves later reveals', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const converge = source.slice(source.indexOf('async convergeManagedPlace'), source.indexOf('async compensateManagedImage'));
    expect(converge).toContain('created: OLD == null');
    expect(converge).toContain('savedCollectionState.created ?');
    expect(converge).toContain('initialHiddens');
    expect(converge).not.toContain('UPSERT { userKey: @userKey, source: "collection"');
  });
  test('lists authorized places and exposes the same read authorization', async () => {
    const database: TravelDatabase = { async query(query) { return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : [{ ...place, _key: place.key }]; } }; } };
    const repository = createTravelRepository(database);
    await expect(repository.authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toBeUndefined();
    await expect(repository.authorizeWrite({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toBe('membership');
    await expect(repository.overview({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toEqual([place]);
  });

  test('upserts duplicate places under the write policy and returns persisted data', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: TravelDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async all() { return [{ ...place, _key: place.key }]; } }; } };
    const saved = await createTravelRepository(database).create({ organizationKey: 'organization', scopeKey, userKey: 'user' }, place);
    expect(saved).toEqual(place);
    expect(queries[0]?.query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(queries[0]?.query).toContain('UPSERT { scopeKey: @scopeKey, countryCode: @countryCode, name: @name }');
    expect(queries[0]?.query).toContain('UPDATE {}');
    expect(queries[0]?.bindVars).toMatchObject({ organizationKey: 'organization', scopeKey, userKey: 'user', countryCode: 'JP', name: 'Tokyo' });
  });

  test('denies absent membership', async () => {
    const database: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    await expect(createTravelRepository(database).authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
