import { beforeEach, describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { TravelRepositoryError } from './repository';
import { createPlaceImageGenerator, PLACE_IMAGE_TOKEN_MAX_LENGTH, PLACE_IMAGE_TOKEN_VALIDITY_MS, PLACE_IMAGE_WEBP_MAX_BYTES, placeImageReplayStateForTests, resetPlaceImageReplayStateForTests, travelPlaceImagesInputSchema } from './place-images';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const assetConcepts = [
  { title: 'Country overview', prompt: 'Role: hero. Premium cinematic editorial travel imagery of Japan from an expansive viewpoint, portrait composition, restrained natural colors, clearly an AI interpretation, no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Coastal scene', prompt: 'Role: scene-1. Premium cinematic editorial travel imagery of a quiet Japanese coast, portrait composition, restrained natural colors, clearly an AI interpretation, no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Architectural scene', prompt: 'Role: scene-2. Premium cinematic editorial travel imagery of anonymous Japanese architecture, portrait composition, restrained natural colors, clearly an AI interpretation, no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
  { title: 'Garden scene', prompt: 'Role: scene-3. Premium cinematic editorial travel imagery of an atmospheric Japanese garden, portrait composition, restrained natural colors, clearly an AI interpretation, no text, logos, flags, maps, borders, identifiable people, or fabricated named landmarks.' },
] as const;
const input = { organizationKey, scopeKey, imageRequestToken: 'opaque-token' };
const issuedAt = Date.now();
const tokenPayload = { version: 1, issuedAt, nonce: 'A'.repeat(43), organizationKey, scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, concepts: assetConcepts } as const;
const token = { decryptImageRequest: (value: string) => { if (!value.startsWith(input.imageRequestToken)) throw new Error('tampered token'); return tokenPayload; } };
const repository = { authorizeRead: async () => {} };
const generated = (costUsd: number | null = 0.125, base64 = 'AQ==') => ({ output: { images: [{ base64, mimeType: 'image/png' as const }] }, costUsd });

describe('transient place image generation', () => {
  beforeEach(() => resetPlaceImageReplayStateForTests());

  test('strictly accepts only trusted context and an opaque token, then authorizes before token use', async () => {
    expect(() => travelPlaceImagesInputSchema.parse({ ...input, promptVersion: 'client-owned' })).toThrow('Unrecognized key');
    expect(travelPlaceImagesInputSchema.safeParse({ ...input, imageRequestToken: 'x'.repeat(PLACE_IMAGE_TOKEN_MAX_LENGTH + 1) }).success).toBe(false);
    expect(travelPlaceImagesInputSchema.safeParse({ ...input, countryName: 'Attacker', prompts: ['arbitrary'] }).success).toBe(false);
    let decrypted = false, providerCalls = 0;
    const generate = createPlaceImageGenerator({
      repository: { authorizeRead: async () => { expect(decrypted).toBe(false); throw new TravelRepositoryError('forbidden'); } },
      decryptImageRequest: () => { decrypted = true; return tokenPayload; },
      execute: (async () => { providerCalls += 1; return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction,
    });
    await expect(generate(input, userKey)).rejects.toThrow('forbidden');
    expect({ decrypted, providerCalls }).toEqual({ decrypted: false, providerCalls: 0 });
    await expect(createPlaceImageGenerator({ repository, ...token })( { ...input, imageRequestToken: 'tampered' }, userKey)).rejects.toThrow('tampered');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, scopeKey: newId() }) })(input, userKey)).rejects.toThrow('does not match');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, unexpected: true }) })(input, userKey)).rejects.toThrow('Unrecognized key');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, nonce: 'weak' }) })(input, userKey)).rejects.toThrow();
  });

  test('runs exactly four provider calls in parallel and returns ordered inline WebP images without persistence', async () => {
    let active = 0;
    const calls: Array<{ route: any; value: any; execution: any }> = [];
    const transforms: unknown[] = [];
    const metrics: unknown[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const controller = new AbortController();
    const generate = createPlaceImageGenerator({
      repository,
      ...token,
      execute: (async (route: any, value: any, execution: any) => { calls.push({ route, value, execution }); active += 1; await gate; active -= 1; return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction,
      transform: async (bytes, dimensions) => { transforms.push({ bytes: [...bytes], dimensions }); return new Uint8Array([1, 2, 3]); },
      onMetrics: (value) => metrics.push(value),
      log: (_message, value) => metrics.push(value),
    });
    const promise = generate(input, userKey, { signal: controller.signal, timeoutMs: 12_345 });
    while (active < 4) await Promise.resolve();
    expect(active).toBe(4);
    release();
    const result = await promise;
    expect(calls).toHaveLength(4);
    expect(calls.every(({ route, value, execution }) => route.mode === 'auto' && route.organizationKey === organizationKey && route.actionSlug === 'generate-image' && !('providerSlug' in route) && !('modelSlug' in route) && value.count === 1 && value.size === '1024x1536' && value.quality === 'low' && execution.timeoutMs === 12_345 && execution.signal instanceof AbortSignal)).toBe(true);
    expect(calls.map(({ value }) => value.prompt)).toEqual(assetConcepts.map(({ prompt }) => `Authoritative country: Japan (JP), Asia. ${prompt}`));
    expect(transforms).toEqual(Array(4).fill({ bytes: [1], dimensions: { width: 864, height: 1536, mimeType: 'image/webp' } }));
    expect(result).toEqual({
      status: 'ready',
      images: [
        { role: 'hero', status: 'ready', title: assetConcepts[0].title, url: 'data:image/webp;base64,AQID', width: 864, height: 1536, mimeType: 'image/webp' },
        { role: 'scene-1', status: 'ready', title: assetConcepts[1].title, url: 'data:image/webp;base64,AQID', width: 864, height: 1536, mimeType: 'image/webp' },
        { role: 'scene-2', status: 'ready', title: assetConcepts[2].title, url: 'data:image/webp;base64,AQID', width: 864, height: 1536, mimeType: 'image/webp' },
        { role: 'scene-3', status: 'ready', title: assetConcepts[3].title, url: 'data:image/webp;base64,AQID', width: 864, height: 1536, mimeType: 'image/webp' },
      ],
      durationMs: expect.any(Number),
      costUsd: 0.5,
    });
    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({ state: 'ready', countryCode: 'JP', conceptTitles: assetConcepts.map(({ title }) => title), providerDurationMs: expect.any(Array), costUsd: 0.5 });
    expect(JSON.stringify(metrics)).not.toMatch(/Role:|base64|AQID/);
  });

  test('uses Sharp to crop every generated image to exact 864x1536 WebP output', async () => {
    const source = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#456789' } }).png().toBuffer();
    const generate = createPlaceImageGenerator({ repository, ...token, execute: (async () => generated(0.1, source.toString('base64'))) as unknown as typeof import('@/lib/ai/router').executeAction, log: () => {} });
    const result = await generate(input, userKey);
    for (const image of result.images) {
      expect(image.url.startsWith('data:image/webp;base64,')).toBe(true);
      const metadata = await sharp(Buffer.from(image.url.slice('data:image/webp;base64,'.length), 'base64')).metadata();
      expect(metadata).toMatchObject({ format: 'webp', width: 864, height: 1536 });
    }
  });

  test('throws provider and processing failures and reports all-or-null aggregate cost', async () => {
    let calls = 0;
    const providerFailure = createPlaceImageGenerator({ repository, ...token, execute: (async () => { calls += 1; if (calls === 2) throw new Error('provider failed'); return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction, transform: async () => new Uint8Array([1]), log: () => {} });
    await expect(providerFailure(input, userKey)).rejects.toThrow('provider failed');
    expect(calls).toBe(4);

    const costs = [0.1, 0.2, null, 0.4];
    await expect(providerFailure(input, userKey)).rejects.toThrow('already been used');
    expect(calls).toBe(4);

    const unknownCost = createPlaceImageGenerator({ repository, ...token, execute: (async () => generated(costs.shift()!)) as unknown as typeof import('@/lib/ai/router').executeAction, transform: async () => new Uint8Array([1]), log: () => {} });
    await expect(unknownCost({ ...input, imageRequestToken: `${input.imageRequestToken}-cost` }, userKey)).resolves.toMatchObject({ status: 'ready', costUsd: null });

    const processingFailure = createPlaceImageGenerator({ repository, ...token, execute: (async () => generated()) as unknown as typeof import('@/lib/ai/router').executeAction, transform: async () => { throw new Error('sharp failed'); }, log: () => {} });
    await expect(processingFailure({ ...input, imageRequestToken: `${input.imageRequestToken}-processing` }, userKey)).rejects.toThrow('sharp failed');
  });

  test('coalesces concurrent token use and rejects completed replay while retaining no sensitive state', async () => {
    let active = 0, maximum = 0, calls = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const dependencies = {
      repository,
      ...token,
      execute: (async () => { calls += 1; active += 1; maximum = Math.max(maximum, active); if (calls <= 4) await firstGate; active -= 1; return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction,
      transform: async () => new Uint8Array([1]),
      log: () => {},
    };
    const first = createPlaceImageGenerator(dependencies)(input, userKey);
    const second = createPlaceImageGenerator(dependencies)(input, userKey);
    while (calls < 4) await Promise.resolve();
    await Promise.resolve();
    expect(calls).toBe(4);
    releaseFirst();
    await Promise.all([first, second]);
    expect({ calls, maximum }).toEqual({ calls: 4, maximum: 4 });
    await expect(createPlaceImageGenerator(dependencies)(input, userKey)).rejects.toThrow('already been used');
    const state = JSON.stringify(placeImageReplayStateForTests());
    expect(state).not.toContain(input.imageRequestToken);
    expect(state).not.toContain(assetConcepts[0].prompt);
    expect(placeImageReplayStateForTests().inFlight).toEqual([]);
  });

  test('propagates cancellation while a set is waiting for the process semaphore', async () => {
    let firstCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { repository, ...token, execute: (async () => { firstCalls += 1; await gate; return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction, transform: async () => new Uint8Array([1]), log: () => {} };
    const first = createPlaceImageGenerator(dependencies)(input, userKey);
    while (firstCalls < 4) await Promise.resolve();
    const controller = new AbortController();
    const second = createPlaceImageGenerator(dependencies)({ ...input, imageRequestToken: `${input.imageRequestToken}-second` }, userKey, { signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(second).rejects.toThrow('cancelled');
    release();
    await first;
    expect(firstCalls).toBe(4);
  });

  test('rejects expired and future tokens at the exact one-hour boundary before provider calls', async () => {
    const current = 2_000_000_000_000;
    let providerCalls = 0;
    const generateFor = (tokenIssuedAt: number) => createPlaceImageGenerator({
      repository,
      now: () => current,
      decryptImageRequest: () => ({ ...tokenPayload, issuedAt: tokenIssuedAt }),
      execute: (async () => { providerCalls += 1; return generated(); }) as unknown as typeof import('@/lib/ai/router').executeAction,
    });
    await expect(generateFor(current - PLACE_IMAGE_TOKEN_VALIDITY_MS)(input, userKey)).rejects.toThrow('expired');
    await expect(generateFor(current + 1)({ ...input, imageRequestToken: `${input.imageRequestToken}-future` }, userKey)).rejects.toThrow('future');
    expect(providerCalls).toBe(0);
  });

  test('rejects transformed WebP output larger than four MiB', async () => {
    const generate = createPlaceImageGenerator({ repository, ...token, execute: (async () => generated()) as unknown as typeof import('@/lib/ai/router').executeAction, transform: async () => new Uint8Array(PLACE_IMAGE_WEBP_MAX_BYTES + 1), log: () => {} });
    await expect(generate(input, userKey)).rejects.toThrow('maximum allowed size');
  });
});
