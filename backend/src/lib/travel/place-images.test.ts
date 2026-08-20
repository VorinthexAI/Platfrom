import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { TravelRepositoryError } from './repository';
import { createPlaceImageGenerator, PLACE_IMAGE_TOKEN_MAX_LENGTH, PLACE_IMAGE_TOKEN_VALIDITY_MS, placeImageReplayStateForTests, resetPlaceImageReplayStateForTests, travelPlaceImagesInputSchema } from './place-images';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const input = { organizationKey, scopeKey, imageRequestToken: 'opaque-token' };
const issuedAt = Date.now();
const images = [
  { role: 'hero', title: 'Japan overview', url: 'https://images.example/japan-overview.jpg', sourcePageUrl: 'https://example.com/japan-overview' },
  { role: 'scene-1', title: 'Japan nature', url: 'https://images.example/japan-nature.jpg', sourcePageUrl: 'https://example.com/japan-nature' },
  { role: 'scene-2', title: 'Japan architecture', url: 'https://images.example/japan-architecture.jpg', sourcePageUrl: 'https://example.com/japan-architecture' },
  { role: 'scene-3', title: 'Japan culture', url: 'https://images.example/japan-culture.jpg', sourcePageUrl: 'https://example.com/japan-culture' },
] as const;
const tokenPayload = { version: 2, issuedAt, nonce: 'A'.repeat(43), organizationKey, scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, images } as const;
const token = { decryptImageRequest: (value: string) => { if (!value.startsWith(input.imageRequestToken)) throw new Error('tampered token'); return tokenPayload; } };
const repository = { authorizeRead: async () => {} };
const processing = { prepareImage: async (url: string) => `data:image/webp;base64,${Buffer.from(url).toString('base64')}` };

describe('web-sourced place image release', () => {
  beforeEach(() => resetPlaceImageReplayStateForTests());

  test('strictly accepts only trusted context and authorizes before token use', async () => {
    expect(() => travelPlaceImagesInputSchema.parse({ ...input, countryName: 'Attacker' })).toThrow('Unrecognized key');
    expect(travelPlaceImagesInputSchema.safeParse({ ...input, imageRequestToken: 'x'.repeat(PLACE_IMAGE_TOKEN_MAX_LENGTH + 1) }).success).toBe(false);
    let decrypted = false;
    const release = createPlaceImageGenerator({
      repository: { authorizeRead: async () => { expect(decrypted).toBe(false); throw new TravelRepositoryError('forbidden'); } },
      decryptImageRequest: () => { decrypted = true; return tokenPayload; },
    });
    await expect(release(input, userKey)).rejects.toThrow('forbidden');
    expect(decrypted).toBe(false);
    await expect(createPlaceImageGenerator({ repository, ...token })({ ...input, imageRequestToken: 'tampered' }, userKey)).rejects.toThrow('tampered');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, scopeKey: newId() }) })(input, userKey)).rejects.toThrow('does not match');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, unexpected: true }) })(input, userKey)).rejects.toThrow('Unrecognized key');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, images: [{ ...images[0], url: 'http://unsafe.example/image.jpg' }, ...images.slice(1)] }) })(input, userKey)).rejects.toThrow('HTTPS');
  });

  test('returns four ordered web images immediately without provider work', async () => {
    const metrics: unknown[] = [];
    const result = await createPlaceImageGenerator({ repository, ...token, ...processing, onMetrics: (value) => metrics.push(value), log: () => {} })(input, userKey);
    expect(result).toMatchObject({ status: 'ready', durationMs: expect.any(Number), costUsd: 0 });
    expect(result.images).toEqual([
      ...images.map((image) => ({ ...image, url: `data:image/webp;base64,${Buffer.from(image.url).toString('base64')}`, status: 'ready' as const })),
    ]);
    expect(metrics).toEqual([{ state: 'ready', countryCode: 'JP', imageTitles: images.map(({ title }) => title), totalMs: expect.any(Number) }]);
  });

  test('blocks private image hosts before making an outbound request', async () => {
    const oneImage = (url: string) => ({ ...tokenPayload, images: [{ ...images[0], url }] });
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => oneImage('https://127.0.0.1/image.jpg'), log: () => {} })({ ...input, imageRequestToken: 'private-token' }, userKey)).rejects.toThrow('No web image could be prepared safely');
  });

  test('keeps safely prepared images when an individual web source fails', async () => {
    const result = await createPlaceImageGenerator({
      repository, ...token, log: () => {},
      prepareImage: async (url) => { if (url.includes('nature')) throw new Error('source expired'); return `data:image/webp;base64,${Buffer.from(url).toString('base64')}`; },
    })({ ...input, imageRequestToken: `${input.imageRequestToken}-partial` }, userKey);
    expect(result.images).toHaveLength(3);
    expect(result.images.map(({ role, title }) => ({ role, title }))).toEqual([
      { role: 'hero', title: 'Japan overview' }, { role: 'scene-1', title: 'Japan architecture' }, { role: 'scene-2', title: 'Japan culture' },
    ]);
  });

  test('coalesces concurrent token use and rejects completed replay without retaining URLs', async () => {
    const dependencies = { repository, ...token, ...processing, log: () => {} };
    const release = createPlaceImageGenerator(dependencies);
    const [first, second] = await Promise.all([release(input, userKey), release(input, userKey)]);
    expect(first).toEqual(second);
    await expect(release(input, userKey)).rejects.toThrow('already been used');
    const state = JSON.stringify(placeImageReplayStateForTests());
    expect(state).not.toContain(input.imageRequestToken);
    expect(state).not.toContain(images[0].url);
    expect(placeImageReplayStateForTests().inFlight).toEqual([]);
  });

  test('propagates cancellation before releasing images', async () => {
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    const release = createPlaceImageGenerator({ repository, ...token, ...processing, log: () => {} });
    await expect(release(input, userKey, { signal: controller.signal })).rejects.toThrow('cancelled');
    await expect(release(input, userKey)).resolves.toMatchObject({ status: 'ready' });
  });

  test('rejects expired and future tokens at the exact one-hour boundary', async () => {
    const current = 2_000_000_000_000;
    const releaseFor = (tokenIssuedAt: number) => createPlaceImageGenerator({ repository, now: () => current, decryptImageRequest: () => ({ ...tokenPayload, issuedAt: tokenIssuedAt }) });
    await expect(releaseFor(current - PLACE_IMAGE_TOKEN_VALIDITY_MS)(input, userKey)).rejects.toThrow('expired');
    await expect(releaseFor(current + 1)({ ...input, imageRequestToken: `${input.imageRequestToken}-future` }, userKey)).rejects.toThrow('future');
  });
});
