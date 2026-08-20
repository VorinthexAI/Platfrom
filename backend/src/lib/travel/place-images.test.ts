import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { TravelRepositoryError } from './repository';
import { createPlaceImageGenerator, PLACE_IMAGE_TOKEN_MAX_LENGTH, PLACE_IMAGE_TOKEN_VALIDITY_MS, PLACE_IMAGE_WEBP_MAX_BYTES, placeImageReplayStateForTests, resetPlaceImageReplayStateForTests, travelPlaceImageInputSchema } from './place-images';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const input = { organizationKey, scopeKey, imageRequestToken: 'opaque-token' };
const issuedAt = Date.now();
const hero = { title: 'Japan travel interpretation', prompt: 'Authoritative destination: Japan. Create an original landscape editorial interpretation of a volcanic island country with cedar forests, dense cities, timber architecture, and soft morning light. No text or identifiable people.' };
const tokenPayload = { version: 3, issuedAt, nonce: 'A'.repeat(43), organizationKey, scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, hero } as const;
const token = { decryptImageRequest: (value: string) => { if (!value.startsWith(input.imageRequestToken)) throw new Error('tampered token'); return tokenPayload; } };
const repository = { authorizeRead: async () => {} };
const generated = (count = 1, costUsd: number | null = 0.04) => ({ output: { images: Array.from({ length: count }, () => ({ base64: 'AQ==', mimeType: 'image/png' as const })) }, costUsd });

describe('transient place hero generation', () => {
  beforeEach(() => resetPlaceImageReplayStateForTests());

  test('accepts only trusted context and authorizes before token use', async () => {
    expect(() => travelPlaceImageInputSchema.parse({ ...input, prompt: 'untrusted' })).toThrow('Unrecognized key');
    expect(travelPlaceImageInputSchema.safeParse({ ...input, imageRequestToken: 'x'.repeat(PLACE_IMAGE_TOKEN_MAX_LENGTH + 1) }).success).toBe(false);
    let decrypted = false, providerCalls = 0;
    const generate = createPlaceImageGenerator({
      repository: { authorizeRead: async () => { expect(decrypted).toBe(false); throw new TravelRepositoryError('forbidden'); } },
      decryptImageRequest: () => { decrypted = true; return tokenPayload; },
      execute: (async () => { providerCalls += 1; return generated(); }) as any,
    });
    await expect(generate(input, userKey)).rejects.toThrow('forbidden');
    expect({ decrypted, providerCalls }).toEqual({ decrypted: false, providerCalls: 0 });
    await expect(createPlaceImageGenerator({ repository, ...token })({ ...input, imageRequestToken: 'tampered' }, userKey)).rejects.toThrow('tampered');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, scopeKey: newId() }) })(input, userKey)).rejects.toThrow('does not match');
    await expect(createPlaceImageGenerator({ repository, decryptImageRequest: () => ({ ...tokenPayload, unexpected: true }) })(input, userKey)).rejects.toThrow('Unrecognized key');
  });

  test('generates exactly one low-quality landscape hero from the sealed prompt', async () => {
    const calls: any[][] = [], metrics: unknown[] = [];
    const controller = new AbortController();
    const result = await createPlaceImageGenerator({
      repository, ...token,
      execute: (async (...args: any[]) => { calls.push(args); return generated(); }) as any,
      transform: async (bytes) => { expect([...bytes]).toEqual([1]); return new Uint8Array([1, 2, 3]); },
      onMetrics: (value) => metrics.push(value), log: () => {},
    })(input, userKey, { signal: controller.signal, timeoutMs: 12_345 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual({ mode: 'fixed', organizationKey, actionSlug: 'generate-image', modelSlug: 'openai.gpt-image-2', providerSlug: 'openai' });
    expect(calls[0]?.[1]).toEqual({ prompt: hero.prompt, count: 1, size: '1536x1024', quality: 'low' });
    expect(calls[0]?.[2]).toEqual({ signal: controller.signal, timeoutMs: 12_345 });
    expect(result).toEqual({ status: 'ready', image: { status: 'ready', title: hero.title, url: 'data:image/webp;base64,AQID', width: 1536, height: 864, mimeType: 'image/webp' }, durationMs: expect.any(Number), costUsd: 0.04 });
    expect(metrics).toHaveLength(1);
    expect(JSON.stringify(metrics)).not.toContain(hero.prompt);
  });

  test('rejects invalid provider counts and oversized prepared output', async () => {
    await expect(createPlaceImageGenerator({ repository, ...token, execute: (async () => generated(2)) as any, log: () => {} })(input, userKey)).rejects.toThrow('expected one');
    resetPlaceImageReplayStateForTests();
    await expect(createPlaceImageGenerator({ repository, ...token, execute: (async () => generated()) as any, transform: async () => new Uint8Array(PLACE_IMAGE_WEBP_MAX_BYTES + 1), log: () => {} })(input, userKey)).rejects.toThrow('maximum allowed size');
  });

  test('coalesces concurrent use, rejects replay, and retains no sensitive state', async () => {
    let calls = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { repository, ...token, execute: (async () => { calls += 1; await gate; return generated(); }) as any, transform: async () => new Uint8Array([1]), log: () => {} };
    const generate = createPlaceImageGenerator(dependencies);
    const first = generate(input, userKey), second = generate(input, userKey);
    while (calls === 0) await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    await expect(generate(input, userKey)).rejects.toThrow('already been used');
    const state = JSON.stringify(placeImageReplayStateForTests());
    expect(state).not.toContain(input.imageRequestToken);
    expect(state).not.toContain(hero.prompt);
  });

  test('rejects expired and future tokens before provider work', async () => {
    const current = 2_000_000_000_000;
    let calls = 0;
    const generateFor = (tokenIssuedAt: number) => createPlaceImageGenerator({ repository, now: () => current, decryptImageRequest: () => ({ ...tokenPayload, issuedAt: tokenIssuedAt }), execute: (async () => { calls += 1; return generated(); }) as any });
    await expect(generateFor(current - PLACE_IMAGE_TOKEN_VALIDITY_MS)(input, userKey)).rejects.toThrow('expired');
    await expect(generateFor(current + 1)({ ...input, imageRequestToken: `${input.imageRequestToken}-future` }, userKey)).rejects.toThrow('future');
    expect(calls).toBe(0);
  });
});
