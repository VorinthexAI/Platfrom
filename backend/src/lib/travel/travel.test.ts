import { describe, expect, test } from 'bun:test';
import { placeSchema, type Place } from '@/lib/db/places.node';
import { imageSchema } from '@/lib/db/images.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createTravelRepository, TravelRepositoryError, type TravelAccessContext, type TravelDatabase, type TravelRepository } from './repository';
import { CHILDREN_REQUEST_TOKEN_MAX_LENGTH, CHILDREN_REQUEST_TOKEN_VALIDITY_MS, childrenRequestTokenSchema, createTravelService, placeDto, recentPlaceDto, travelChildrenFindInputSchema, travelCityDetailSchema, travelCityFindInputSchema, travelOverviewInputSchema, travelPlaceCreateInputSchema, travelPlaceDetailSchema, travelPlaceFindInputSchema, travelPlaceOpenInputSchema } from './service';

const key = 'cmrnlzf650002qc7k4p5zem5w';
const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const timestamp = '2026-08-11T12:00:00.000Z';
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
const placePngBytes = (() => { const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); const view = new DataView(bytes.buffer); view.setUint32(16, 1536); view.setUint32(20, 1024); return bytes; })();
const placePngBase64 = Buffer.from(placePngBytes).toString('base64');
const place = placeSchema.parse({ key, userKey: key, scopeKey, saved: true, name: 'Tokyo', summary: 'A city of neighborhoods.', countryCode: 'JP', latitude: 35.6, longitude: 139.6, embedding, embeddingContentVersion: 2, createdAt: timestamp });
const generatedPersistence = { findGenerated: async () => null, upsertGenerated: async (_context: TravelAccessContext, value: Place) => value };
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
const detail = travelPlaceDetailSchema.parse({ ...publicModelDetail, imageRequestToken: 'opaque-token', childrenRequestToken: 'children-token' });

describe('travel contracts and service', () => {
  test('creates a missing staged preview through the canonical generator and preserves staged bytes', async () => {
    const bytesByKey = new Map<string, Uint8Array>();
    const deleted: string[] = [], processed: Uint8Array[] = [];
    const storage = { upload: async ({ key, bytes }: any) => { bytesByKey.set(key, bytes); return { storageKey: key }; }, download: async (key: string) => { const bytes = bytesByKey.get(key); if (!bytes) throw new Error('missing'); return { bytes }; }, delete: async (key: string) => { deleted.push(key); bytesByKey.delete(key); }, copy: async () => ({ storageKey: '' }) };
    const token = { version: 4, issuedAt: Date.parse(timestamp), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2 }, hero: { title: 'Japan travel interpretation', prompt: 'Japan landscape' } } as const;
    let providerCalls = 0, converges = 0;
    const repository = { authorizeRead: async () => {}, authorizeWrite: async () => key, cancelManagedImageDeletion: async () => {}, acknowledgeManagedImageDeletion: async () => {}, compensateManagedImage: async () => null, convergeManagedPlace: async ({ place }: any) => { converges += 1; return place; } } as unknown as TravelRepository;
    const service = createTravelService({ repository, storage, decryptImageRequest: () => token, getImage: async () => null, embed: async () => embedding, now: () => timestamp,
      placeImages: { execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: placePngBase64, mimeType: 'image/png' }] }, costUsd: 0.01 }; }) as any, now: () => Date.parse(timestamp), log: () => {} },
      process: (async (input: any) => { processed.push(input.file.bytes); return imageSchema.parse({ key: input.imageKey, scopeKey, filename: input.file.filename, caption: 'Japan landscape', imageCaptionKey: key, createdByKey: key, storageKey: 'media/japan.png', mimeType: 'image/png', sizeBytes: 3, width: 1536, height: 1024, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp }); }) as any });
    const input = { organizationKey: 'organization', scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' };
    await expect(service.createPlace(input, 'user')).resolves.toMatchObject({ place: { name: 'Japan' } });
    expect(providerCalls).toBe(1); expect(processed).toEqual([placePngBytes]); expect(converges).toBe(1); expect(deleted).toContain('pending/gallery/place-media/' + 'A'.repeat(43) + '/preview.png');
  });

  test('compensates a newly processed deterministic image when later place persistence fails', async () => {
    const stagedKey = `pending/gallery/place-media/${'B'.repeat(43)}/preview.png`, deleted: string[] = [], acknowledged: string[] = [];
    const storage = { upload: async ({ key }: any) => ({ storageKey: key }), download: async () => ({ bytes: new Uint8Array([1, 2, 3]) }), delete: async (key: string) => { deleted.push(key); }, copy: async () => ({ storageKey: '' }) };
    const token = { version: 4, issuedAt: Date.parse(timestamp), nonce: 'B'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2 }, hero: { title: 'Japan', prompt: 'Japan' } } as const;
    const repository = { authorizeWrite: async () => key, cancelManagedImageDeletion: async () => {}, compensateManagedImage: async () => 'media/orphan.png', acknowledgeManagedImageDeletion: async (storageKey: string) => { acknowledged.push(storageKey); }, convergeManagedPlace: async () => { throw new Error('converge failed'); } } as unknown as TravelRepository;
    const image = imageSchema.parse({ key, scopeKey, filename: 'japan.png', caption: 'Japan', imageCaptionKey: key, createdByKey: key, storageKey: 'media/orphan.png', mimeType: 'image/png', sizeBytes: 3, width: 1536, height: 1024, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp });
    const service = createTravelService({ repository, storage, decryptImageRequest: () => token, getImage: async () => null, process: async () => image, embed: async () => embedding, now: () => timestamp });
    await expect(service.createPlace({ organizationKey: 'organization', scopeKey, name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }, 'user')).rejects.toThrow('converge failed');
    expect(stagedKey).toContain('pending/gallery'); expect(deleted).toContain('media/orphan.png'); expect(acknowledged).toEqual(['media/orphan.png']);
  });
  test('keeps inputs and the focused recommendation response strict', () => {
    const context = { organizationKey: 'organization', scopeKey };
    expect(travelOverviewInputSchema.parse(context)).toEqual(context);
    expect(travelOverviewInputSchema.safeParse({ ...context, unknown: true }).success).toBe(false);
    expect(travelPlaceFindInputSchema.safeParse({ ...context, query: 'Japan', userKey: 'untrusted' }).success).toBe(false);
    expect(travelPlaceCreateInputSchema.safeParse({ ...context, name: 'Japan', summary, countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' }).success).toBe(true);
    expect(travelPlaceOpenInputSchema.safeParse({ ...context, name: 'Japan', countryCode: 'JP' }).success).toBe(true);
    expect(travelPlaceOpenInputSchema.safeParse({ ...context, name: 'Japan', countryCode: 'JP', openedAt: timestamp }).success).toBe(false);
    expect(travelPlaceCreateInputSchema.safeParse({ ...context, name: 'Japan', countryCode: 'JP', latitude: 91, longitude: 138.2 }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, extra: true }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: cities.slice(0, 9) }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: [...cities.slice(0, 9), { ...cities[0]!, name: 'tokyo' }] }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, popularCities: [...cities.slice(0, 9), { name: 'Kobe', latitude: 35, longitude: 181 }] }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, summary: '' }).success).toBe(false);
    expect(travelCityFindInputSchema.safeParse({ ...context, city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 1, lon: 1 } }).success).toBe(true);
    expect(travelChildrenFindInputSchema.safeParse({ ...context, childrenRequestToken: 'token' }).success).toBe(true);
    expect(travelChildrenFindInputSchema.safeParse({ ...context, childrenRequestToken: 'x'.repeat(CHILDREN_REQUEST_TOKEN_MAX_LENGTH + 1) }).success).toBe(false);
    expect(travelCityDetailSchema.safeParse({ ...detail, popularCities: undefined }).success).toBe(false);
    expect(travelPlaceDetailSchema.safeParse({ ...detail, culture: undefined }).success).toBe(false);
  });

  test('preserves the simplified place overview projection', async () => {
    expect(placeDto(place)).toEqual({ key, name: 'Tokyo', summary: place.summary, countryCode: 'JP', latitude: 35.6, longitude: 139.6, createdAt: timestamp });
    const recent = placeSchema.parse({ ...place, generatedDetail: { ...modelDetail, location: { ...modelDetail.location, kind: 'place' } }, openedAt: timestamp });
    expect(recentPlaceDto(recent)).toEqual({ key, kind: 'place', name: 'Tokyo', summary: place.summary, countryCode: 'JP', latitude: 35.6, longitude: 139.6, openedAt: timestamp });
    const repository = { overview: async () => ({ places: [place], recentPlaces: [recent] }) } as unknown as TravelRepository;
    const service = createTravelService({ repository });
    expect(Object.keys(service)).toEqual(['overview', 'openPlace', 'createPlace', 'findPlace', 'findCity', 'findChildren', 'generatePlaceHeroImage']);
    await expect(service.overview({ organizationKey: 'organization', scopeKey }, 'user')).resolves.toEqual({ places: [placeDto(place)], recentPlaces: [recentPlaceDto(recent)] });
  });

  test('opens only an existing authorized generated place with a server timestamp', async () => {
    const opened = placeSchema.parse({ ...place, generatedDetail: { ...modelDetail, location: { ...modelDetail.location, kind: 'place' } }, openedAt: timestamp });
    const calls: unknown[][] = [];
    const repository = { open: async (...args: unknown[]) => { calls.push(args); return opened; } } as unknown as TravelRepository;
    const service = createTravelService({ repository, now: () => timestamp });
    await expect(service.openPlace({ organizationKey: 'organization', scopeKey, name: ' Tokyo ', countryCode: 'jp' }, key)).resolves.toEqual({ place: recentPlaceDto(opened) });
    expect(calls).toEqual([[{ organizationKey: 'organization', scopeKey, userKey: key }, 'JP', 'Tokyo', timestamp]]);
  });

  test('authorizes writes before embedding and saves countries and cities through one canonical method', async () => {
    const calls: unknown[][] = [];
    const repository = {
      authorizeWrite: async (context: TravelAccessContext) => { calls.push(['authorizeWrite', context]); return key; },
      convergeManagedPlace: async (value: any) => { calls.push(['converge', value]); return value.place; },
    } as unknown as TravelRepository;
    const input = { organizationKey: 'organization', scopeKey, name: ' Japan ', summary: ' Island country. ', countryCode: 'jp', latitude: 36.2048, longitude: 138.2529, imageRequestToken: 'token' };
    const image = { key, scopeKey, filename: 'japan.png', caption: 'Japan', imageCaptionKey: key, createdByKey: key, storageKey: 'media/japan.png', mimeType: 'image/png', sizeBytes: 1, width: 1536, height: 1024, embedding, mutationPolicy: 'system-only', isFavorite: false, createdAt: timestamp, updatedAt: timestamp } as any;
    const service = createTravelService({ repository, getImage: async () => image, storage: { delete: async () => {}, upload: async () => ({ storageKey: '' }), download: async () => ({ bytes: new Uint8Array() }), copy: async () => ({ storageKey: '' }) }, decryptImageRequest: () => ({ version: 4, issuedAt: Date.parse(timestamp), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2048, longitude: 138.2529 }, hero: { title: 'Japan', prompt: 'prompt' } }), embed: async (value) => { calls.push(['embed', value]); return embedding; }, now: () => timestamp });
    const result = await service.createPlace(input, key);
    expect(calls.map(([name]) => name)).toEqual(['authorizeWrite', 'embed', 'embed', 'converge']);
    expect(calls[0]?.[1]).toEqual({ organizationKey: 'organization', scopeKey, userKey: key });
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
    const repository = { ...generatedPersistence, authorizeRead: async (context: TravelAccessContext) => { calls.push(['authorize', context]); authorized = true; } } as unknown as TravelRepository;
    const execute: any = async (...args: unknown[]) => {
      expect(authorized).toBe(true); calls.push(['execute', ...args]);
      return { output: { text: JSON.stringify({ ...modelDetail, location: { ...modelDetail.location, name: 'Portugal', country: 'Portugal', countryCode: 'PT', continent: 'Europe' }, title: 'Portugal' }) } };
    };
    const service = createTravelService({ repository, execute, embed: async () => embedding, now: () => '2026-08-19T12:00:00.000Z', issueImageNonce: () => 'A'.repeat(43), encryptChildrenRequest: () => 'children-token', encryptImageRequest: (value: any) => { if (value.place.name === 'Portugal' && value.place.summary !== 'Preview generation pending.') sealed = value; return 'opaque-token'; } });
    const country = { name: 'Portugal', code: 'pt', continent: 'Europe', lat: 39.4, lon: -8.2 };
    const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country }, key, { signal: controller.signal, timeoutMs: 2_000 });
    expect(result.place).toMatchObject({ title: 'Portugal', summary, culture: modelDetail.culture, food: modelDetail.food, whyVisit: modelDetail.whyVisit, popularCities: cities, imageRequestToken: 'opaque-token' });
    expect(result.place).not.toHaveProperty('heroImagePrompt');
    expect(calls[0]).toEqual(['authorize', { organizationKey: 'organization', scopeKey, userKey: key }]);
    const askCall = calls.find((call) => (call[1] as { actionSlug?: string } | undefined)?.actionSlug === 'ask');
    expect(askCall?.[1]).toEqual({ mode: 'fixed', organizationKey: 'organization', actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' });
    const askInput = askCall?.[2] as any;
    expect(askInput.systemPrompt).toContain('Do not browse');
    expect(askInput.messages[0]).toMatchObject({ role: 'user', content: [{ type: 'text' }] });
    const askPrompt = askInput.messages[0].content[0].text as string;
    expect(askPrompt).toContain('four separate display sections');
    expect(askPrompt).toContain('1-2 short sentences and 20-45 words in each field');
    expect(askPrompt).toContain('Strictly exclude people, human figures, crowds, faces, and body parts');
    expect(askPrompt).toContain('Do not request or emphasize animals; incidental distant wildlife is acceptable');
    expect(askCall?.[2]).not.toHaveProperty('imageCount');
    expect(askCall?.[3]).toEqual({ signal: controller.signal, timeoutMs: 2_000 });
    const sealedPrompt = sealed.hero.prompt as string;
    expect(sealed).toMatchObject({ version: 4, issuedAt: Date.parse('2026-08-19T12:00:00.000Z'), nonce: 'A'.repeat(43), organizationKey: 'organization', scopeKey, country: { name: 'Portugal', countryCode: 'PT' }, place: { name: 'Portugal', summary, countryCode: 'PT', latitude: 39.4, longitude: -8.2 }, hero: { title: 'Portugal travel interpretation', prompt: expect.stringContaining(modelDetail.heroImagePrompt) } });
    expect(sealedPrompt).toContain('Strictly exclude people, human figures, crowds, faces, and body parts');
    expect(sealedPrompt).toContain('Do not request or emphasize animals; incidental distant wildlife is acceptable');
    expect(JSON.stringify(sealed)).not.toContain('https://');
  });

  test('retries one malformed country guide response and returns the valid retry', async () => {
    let attempts = 0;
    const retriedDetail = { ...modelDetail, location: { ...modelDetail.location, kind: 'place', name: 'Kyoto', city: 'Kyoto' }, title: 'Kyoto' };
    const service = createTravelService({
      repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository,
      execute: (async () => ({ output: { text: ++attempts === 1 ? '{"incomplete":' : JSON.stringify(retriedDetail) } })) as any,
      embed: async () => embedding,
      issueImageNonce: () => 'A'.repeat(43),
      encryptImageRequest: () => 'image-token',
    });
    await expect(service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Kyoto' }, key)).resolves.toMatchObject({ place: { title: 'Kyoto' } });
    expect(attempts).toBe(2);
  });

  test('returns durable generated detail with fresh tokens without model or embedding work', async () => {
    let asks = 0, embeds = 0, nonce = 0;
    const durable = placeSchema.parse({ ...place, generatedDetail: modelDetail, name: 'Japan', summary, countryCode: 'JP', latitude: 36.2048, longitude: 138.2529 });
    const service = createTravelService({
      repository: { authorizeRead: async () => {}, findGenerated: async () => durable } as unknown as TravelRepository,
      execute: (async () => { asks += 1; }) as any,
      embed: async () => { embeds += 1; return embedding; },
      issueImageNonce: () => `${'A'.repeat(42)}${nonce++ ? 'B' : 'A'}`,
      encryptImageRequest: (value: any) => value.nonce,
      encryptChildrenRequest: (value: any) => value.nonce,
    });
    const input = { organizationKey: 'organization', scopeKey, query: 'Japan', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2048, lon: 138.2529 } };
    const first = await service.findPlace(input, key);
    const second = await service.findPlace(input, key);
    expect(first.place).toMatchObject({ title: 'Japan', imageRequestToken: 'A'.repeat(43), childrenRequestToken: expect.any(String) });
    expect(second.place.imageRequestToken).not.toBe(first.place.imageRequestToken);
    expect({ asks, embeds }).toEqual({ asks: 0, embeds: 0 });
  });

  test('returns ten cities and focused recommendations across representative countries', async () => {
    for (const country of [{ name: 'Japan', code: 'JP', continent: 'Asia' }, { name: 'Brazil', code: 'BR', continent: 'South America' }, { name: 'Kenya', code: 'KE', continent: 'Africa' }, { name: 'Norway', code: 'NO', continent: 'Europe' }]) {
      const researched = { ...modelDetail, title: country.name, summary: summary.replace('Japan', country.name), location: { ...modelDetail.location, name: country.name, country: country.name, countryCode: country.code, continent: country.continent } };
      const service = createTravelService({ repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async () => ({ output: { text: JSON.stringify(researched) } })) as any, embed: async () => embedding, issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: () => 'token' });
      const result = await service.findPlace({ organizationKey: 'organization', scopeKey, query: country.name, country: { ...country, lat: 1, lon: 1 } }, key);
      expect(result.place.popularCities).toHaveLength(10);
      expect(result.place).toMatchObject({ culture: expect.any(String), food: expect.any(String), whyVisit: expect.any(String) });
    }
  });

  test('grounds a city guide in its authoritative country and seals a city-specific hero', async () => {
    let sealed: unknown, cityPrompt = '';
    const cityDetail = { ...modelDetail, popularCities: undefined, location: { ...modelDetail.location, kind: 'city', name: 'Tokyo', city: 'Tokyo' }, title: 'Tokyo' };
    const service = createTravelService({ repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async (_route: unknown, input: any) => { cityPrompt = input.messages[0].content[0].text; return { output: { text: JSON.stringify(cityDetail) } }; }) as any, embed: async () => embedding, issueImageNonce: () => 'A'.repeat(43), encryptImageRequest: (value) => { sealed = value; return 'token'; } });
    const result = await service.findCity({ organizationKey: 'organization', scopeKey, city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }, key);
    expect(result.city).toMatchObject({ title: 'Tokyo', location: { kind: 'place', countryCode: 'JP', city: 'Tokyo' }, imageRequestToken: 'token' });
    expect(result.city).not.toHaveProperty('popularCities');
    expect(cityPrompt).toContain('four separate display sections');
    expect(cityPrompt).toContain('1-2 short sentences and 20-45 words in each field');
    expect(cityPrompt).toContain('Strictly exclude people, human figures, crowds, faces, and body parts');
    expect(cityPrompt).toContain('Do not request or emphasize animals; incidental distant wildlife is acceptable');
    expect(sealed).toMatchObject({ country: { countryCode: 'JP' }, hero: { title: 'Tokyo travel interpretation' } });
  });

  test('seals the exact country children contract and expands all ten cities concurrently in order', async () => {
    const issuedAt = Date.parse(timestamp);
    let sealedChildren: unknown, decryptedAfterAuthorization = false, guideCalls = 0, imageCalls = 0, nonceIndex = 0;
    let releaseGuides!: () => void;
    const guideGate = new Promise<void>((resolve) => { releaseGuides = resolve; });
    const imageTokens = new Map<string, unknown>();
    const staged = new Map<string, Uint8Array>();
    const storage = {
      upload: async ({ key: storageKey, bytes }: any) => { staged.set(storageKey, bytes); return { storageKey }; },
      download: async (storageKey: string) => { const bytes = staged.get(storageKey); if (!bytes) throw new Error('missing'); return { bytes }; },
      delete: async (storageKey: string) => { staged.delete(storageKey); }, copy: async () => ({ storageKey: '' }),
    };
    const repository = { ...generatedPersistence, authorizeRead: async () => { decryptedAfterAuthorization = true; } } as unknown as TravelRepository;
    const cityModel = { ...modelDetail, popularCities: undefined, location: { ...modelDetail.location, kind: 'place', name: 'Generated city', city: 'Generated city' }, title: 'Generated city' };
    const service = createTravelService({
      repository, storage, embed: async () => embedding, now: () => timestamp,
      issueImageNonce: () => `${'A'.repeat(42)}${String.fromCharCode(65 + nonceIndex++)}`,
      issueChildrenNonce: () => 'Z'.repeat(43),
      encryptChildrenRequest: (value) => { sealedChildren = value; return 'children-token'; },
      decryptChildrenRequest: () => { expect(decryptedAfterAuthorization).toBe(true); return sealedChildren; },
      encryptImageRequest: (value) => { const token = `image-token-${imageTokens.size}`; imageTokens.set(token, value); return token; },
      decryptImageRequest: (token) => imageTokens.get(token),
      execute: (async (route: { actionSlug: string }, input: any) => {
        if (route.actionSlug === 'generate-image') { imageCalls += 1; return { output: { images: [{ base64: placePngBase64, mimeType: 'image/png' }] }, costUsd: 0.01 }; }
        if (input.messages[0].content[0].text.includes('literal place query')) return { output: { text: JSON.stringify(modelDetail) } };
        guideCalls += 1;
        await guideGate;
        return { output: { text: JSON.stringify(cityModel) } };
      }) as any,
      placeImages: { log: () => {}, now: () => issuedAt },
    });
    const countryResult = await service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }, key);
    expect(countryResult.place).toMatchObject({ childrenRequestToken: 'children-token', popularCities: cities });
    expect(childrenRequestTokenSchema.parse(sealedChildren)).toEqual({
      version: 1, organizationKey: 'organization', scopeKey, issuedAt, expiresAt: issuedAt + CHILDREN_REQUEST_TOKEN_VALIDITY_MS, nonce: 'Z'.repeat(43),
      country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 }, cities,
    });

    const pending = service.findChildren({ organizationKey: 'organization', scopeKey, childrenRequestToken: 'children-token' }, key);
    while (guideCalls < 10) await Promise.resolve();
    expect(guideCalls).toBe(10);
    releaseGuides();
    const result = await pending;
    expect(result.cities.map(({ title }) => title)).toEqual(cities.map(({ name }) => name));
    expect(result.cities).toHaveLength(10);
    expect(result.cities.every((city) => !('childrenRequestToken' in city))).toBe(true);
    await Promise.all(result.cities.map(({ imageRequestToken }) => service.generatePlaceHeroImage({ organizationKey: 'organization', scopeKey, imageRequestToken }, key)));
    expect(imageCalls).toBe(11);
  });

  test('authorizes children tokens before decryption, expiry checks, or provider work', async () => {
    let decrypts = 0, providerCalls = 0;
    const service = createTravelService({
      repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository,
      decryptChildrenRequest: () => { decrypts += 1; return {}; },
      execute: (async () => { providerCalls += 1; }) as any,
    });
    await expect(service.findChildren({ organizationKey: 'organization', scopeKey, childrenRequestToken: 'token' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect({ decrypts, providerCalls }).toEqual({ decrypts: 0, providerCalls: 0 });
    const currentTime = Date.parse(timestamp), issuedAt = currentTime - CHILDREN_REQUEST_TOKEN_VALIDITY_MS;
    const expired = createTravelService({
      repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository, now: () => timestamp,
      decryptChildrenRequest: () => ({ version: 1, organizationKey: 'organization', scopeKey, issuedAt, expiresAt: currentTime, nonce: 'E'.repeat(43), country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 }, cities }),
      execute: (async () => { providerCalls += 1; }) as any,
    });
    await expect(expired.findChildren({ organizationKey: 'organization', scopeKey, childrenRequestToken: 'token' }, 'user')).rejects.toThrow('expired');
    expect(providerCalls).toBe(0);
  });

  test('overlaps country guide and hero providers and coalesces provisional and final image tokens by nonce', async () => {
    let guideStarted = false, imageStarted = false, imageCalls = 0;
    let releaseGuide!: () => void, releaseImage!: () => void;
    const guideGate = new Promise<void>((resolve) => { releaseGuide = resolve; });
    const imageGate = new Promise<void>((resolve) => { releaseImage = resolve; });
    const tokens = new Map<string, unknown>(), staged = new Map<string, Uint8Array>();
    const storage = { upload: async ({ key: storageKey, bytes }: any) => { staged.set(storageKey, bytes); return { storageKey }; }, download: async (storageKey: string) => { const bytes = staged.get(storageKey); if (!bytes) throw new Error('missing'); return { bytes }; }, delete: async () => {}, copy: async () => ({ storageKey: '' }) };
    const service = createTravelService({
      repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository, storage, embed: async () => embedding, now: () => timestamp,
      issueImageNonce: () => 'N'.repeat(43), encryptChildrenRequest: () => 'children-token',
      encryptImageRequest: (value) => { const token = `token-${tokens.size}`; tokens.set(token, value); return token; }, decryptImageRequest: (token) => tokens.get(token),
      execute: (async (route: { actionSlug: string }) => {
        if (route.actionSlug === 'generate-image') { imageCalls += 1; imageStarted = true; await imageGate; return { output: { images: [{ base64: placePngBase64, mimeType: 'image/png' }] } }; }
        guideStarted = true; await guideGate; return { output: { text: JSON.stringify(modelDetail) } };
      }) as any,
      placeImages: { log: () => {}, now: () => Date.parse(timestamp) },
    });
    const finding = service.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } }, key);
    while (!guideStarted || !imageStarted) await Promise.resolve();
    expect(guideStarted as boolean).toBe(true);
    expect(imageStarted as boolean).toBe(true);
    releaseGuide();
    const { place: found } = await finding;
    const finalHero = service.generatePlaceHeroImage({ organizationKey: 'organization', scopeKey, imageRequestToken: found.imageRequestToken }, key);
    releaseImage();
    await finalHero;
    expect(imageCalls).toBe(1);
    expect(new Set([...tokens.values()].map((value: any) => value.nonce))).toEqual(new Set(['N'.repeat(43)]));
  });

  test('rejects wrong-country results and denies model work without access', async () => {
    let calls = 0;
    const denied = createTravelService({ repository: { authorizeRead: async () => { throw new TravelRepositoryError('forbidden'); } } as unknown as TravelRepository, execute: (async () => { calls += 1; }) as any });
    await expect(denied.findPlace({ organizationKey: 'organization', scopeKey, query: 'Japan' }, 'user')).rejects.toMatchObject({ reason: 'forbidden' });
    expect(calls).toBe(0);
    let mismatchCalls = 0;
    const mismatch = createTravelService({ repository: { ...generatedPersistence, authorizeRead: async () => {} } as unknown as TravelRepository, execute: (async (route: { actionSlug: string }) => { if (route.actionSlug === 'ask') mismatchCalls += 1; return route.actionSlug === 'ask' ? { output: { text: JSON.stringify(modelDetail) } } : { output: { images: [] } }; }) as any, embed: async () => embedding, encryptImageRequest: () => 'token', decryptImageRequest: () => ({}) });
    await expect(mismatch.findPlace({ organizationKey: 'organization', scopeKey, query: 'Portugal', country: { name: 'Portugal', code: 'PT', continent: 'Europe', lat: 39.4, lon: -8.2 } }, key)).rejects.toThrow('Country provider returned an invalid guide.');
    expect(mismatchCalls).toBe(2);
  });
});

describe('travel repository', () => {
  test('hides managed collections for newly added members without re-hiding existing members who revealed them', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const converge = source.slice(source.indexOf('async convergeManagedPlace'), source.indexOf('async compensateManagedImage'));
    expect(converge).toContain('created: OLD == null');
    expect(converge).toContain('RETURN { userId: candidate.userId, created: OLD == null }');
    expect(converge).toContain('FILTER savedCollectionState.created || savedMember.created');
    expect(converge).toContain('initialHiddens');
    expect(converge.match(/IN collectionMembers/g)).toHaveLength(1);
    expect(converge.indexOf('IN collectionMembers')).toBeLessThan(converge.indexOf('IN userHiddens'));
    expect(converge.slice(converge.indexOf('IN collectionMembers') + 'IN collectionMembers'.length)).not.toContain('FOR candidate IN collectionMembers');
    expect(converge).toContain('UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name }');
    expect(converge).toContain('UPDATE { saved: true');
    expect(converge).not.toContain('UPSERT { userKey: @userKey, source: "collection"');
  });
  test('checks caption references before removing an orphaned managed image', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const compensate = source.slice(source.indexOf('async compensateManagedImage'), source.indexOf('async cancelManagedImageDeletion'));
    expect(compensate.indexOf('FOR retained IN images')).toBeLessThan(compensate.indexOf('REMOVE image IN images'));
    expect(compensate.slice(compensate.indexOf('REMOVE image IN images'))).not.toContain('FOR retained IN images');
  });
  test('lists authorized places and exposes the same read authorization', async () => {
    const queries: string[] = [];
    const recent = { ...place, generatedDetail: { ...modelDetail, location: { ...modelDetail.location, kind: 'place' } }, openedAt: timestamp };
    const database: TravelDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('RETURN membership._key') ? ['membership'] : [query.includes('place.openedAt != null') ? { ...recent, _key: recent.key } : { ...place, _key: place.key }]; } }; } };
    const repository = createTravelRepository(database);
    await expect(repository.authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toBeUndefined();
    await expect(repository.authorizeWrite({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toBe('membership');
    await expect(repository.overview({ organizationKey: 'organization', scopeKey, userKey: 'user' })).resolves.toEqual({ places: [place], recentPlaces: [placeSchema.parse(recent)] });
    expect(queries).toContainEqual(expect.stringContaining('SORT place.openedAt DESC, place._key ASC LIMIT 25'));
    expect(queries).toContainEqual(expect.stringContaining('place.userKey == @userKey && place.saved == true'));
  });

  test('atomically authorizes and opens only the trusted user and scope place', async () => {
    const opened = placeSchema.parse({ ...place, generatedDetail: { ...modelDetail, location: { ...modelDetail.location, kind: 'place' } }, openedAt: timestamp });
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: TravelDatabase = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async all() { return [{ ...opened, _key: opened.key }]; } }; } };
    await expect(createTravelRepository(database).open({ organizationKey: 'organization', scopeKey, userKey: key }, 'JP', 'Tokyo', timestamp)).resolves.toEqual(opened);
    expect(calls[0]?.query).toContain('place.scopeKey == @scopeKey && place.userKey == @userKey');
    expect(calls[0]?.query).toContain('UPDATE place WITH { openedAt: @openedAt }');
    expect(calls[0]?.bindVars).toEqual({ organizationKey: 'organization', scopeKey, userKey: key, countryCode: 'JP', name: 'Tokyo', openedAt: timestamp });
    const denied: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    await expect(createTravelRepository(denied).open({ organizationKey: 'organization', scopeKey, userKey: key }, 'JP', 'Tokyo', timestamp)).rejects.toMatchObject({ reason: 'forbidden' });
  });

  test('upserts generated detail as unsaved without allowing regeneration to downgrade saved rows', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const generated = placeSchema.parse({ ...place, saved: false, generatedDetail: { ...modelDetail, location: { ...modelDetail.location, kind: 'country' } } });
    const database: TravelDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async all() { return [{ ...generated, _key: generated.key }]; } }; } };
    await expect(createTravelRepository(database).upsertGenerated({ organizationKey: 'organization', scopeKey, userKey: key }, generated)).resolves.toEqual(generated);
    expect(queries[0]?.query).toContain('UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name }');
    expect(queries[0]?.query).not.toContain('UPDATE {\n            saved:');
    expect(queries[0]?.bindVars).toMatchObject({ userKey: key, scopeKey, countryCode: 'JP', name: 'Tokyo', generatedDetail: generated.generatedDetail });
  });

  test('upserts duplicate places under the write policy and returns persisted data', async () => {
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database: TravelDatabase = { async query(query, bindVars) { queries.push({ query, bindVars }); return { async all() { return [{ ...place, _key: place.key }]; } }; } };
    const saved = await createTravelRepository(database).create({ organizationKey: 'organization', scopeKey, userKey: 'user' }, place);
    expect(saved).toEqual(place);
    expect(queries[0]?.query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(queries[0]?.query).toContain('UPSERT { scopeKey: @scopeKey, userKey: @userKey, countryCode: @countryCode, name: @name }');
    expect(queries[0]?.query).toContain('UPDATE {}');
    expect(queries[0]?.bindVars).toMatchObject({ organizationKey: 'organization', scopeKey, userKey: 'user', countryCode: 'JP', name: 'Tokyo' });
  });

  test('denies absent membership', async () => {
    const database: TravelDatabase = { async query() { return { async all() { return []; } }; } };
    await expect(createTravelRepository(database).authorizeRead({ organizationKey: 'organization', scopeKey, userKey: 'user' })).rejects.toMatchObject({ reason: 'forbidden' });
  });
});
