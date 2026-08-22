import { beforeEach, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { TravelRepositoryError } from './repository';
import { createPlaceImageGenerator, PLACE_IMAGE_PNG_MAX_BYTES, PLACE_IMAGE_TOKEN_MAX_LENGTH, PLACE_IMAGE_TOKEN_VALIDITY_MS, placeImageReplayStateForTests, resetPlaceImageReplayStateForTests, travelPlaceImageInputSchema } from './place-images';

const organizationKey = 'organization';
const scopeKey = newId();
const userKey = newId();
const input = { organizationKey, scopeKey, imageRequestToken: 'opaque-token' };
const issuedAt = Date.now();
const hero = { title: 'Japan travel interpretation', prompt: 'Authoritative destination: Japan. Create an original landscape editorial interpretation of a volcanic island country with cedar forests, dense cities, timber architecture, and soft morning light. No text or identifiable people.' };
const tokenPayload = { version: 5, issuedAt, nonce: 'A'.repeat(43), organizationKey, scopeKey, country: { name: 'Japan', countryCode: 'JP', continent: 'Asia', latitude: 36.2, longitude: 138.2 }, place: { kind: 'country', name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2 }, hero } as const;
const staged = new Map<string, Uint8Array>();
const storage = { upload: async ({ key, bytes }: { key: string; bytes: Uint8Array }) => { staged.set(key, bytes); return { storageKey: key }; }, download: async (key: string) => { const bytes = staged.get(key); if (!bytes) throw new Error('missing'); return { bytes }; }, delete: async (key: string) => { staged.delete(key); } } as any;
const token = { storage, decryptImageRequest: (value: string) => { if (!value.startsWith(input.imageRequestToken)) throw new Error('tampered token'); return tokenPayload; } };
const repository = { authorizeRead: async () => {} };
function png(width = 1536, height = 1024) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const generated = (count = 1, costUsd: number | null = 0.04, bytes = png()) => ({ output: { images: Array.from({ length: count }, () => ({ base64: Buffer.from(bytes).toString('base64'), mimeType: 'image/png' as const })) }, costUsd });

describe('transient place hero generation', () => {
  beforeEach(() => { resetPlaceImageReplayStateForTests(); staged.clear(); });

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
      onMetrics: (value) => metrics.push(value), log: () => {},
    })(input, userKey, { signal: controller.signal, timeoutMs: 12_345 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toEqual({ mode: 'auto', organizationKey, actionSlug: 'generate-image' });
    expect(calls[0]?.[1]).toEqual({ prompt: hero.prompt, count: 1, size: '1536x1024', aspectRatio: '3:2', quality: 'low', outputFormat: 'png' });
    expect(calls[0]?.[2]).toEqual({ signal: controller.signal, timeoutMs: 12_345 });
    expect(result).toEqual({ status: 'ready', image: { status: 'ready', title: hero.title, url: `data:image/png;base64,${Buffer.from(png()).toString('base64')}`, width: 1536, height: 1024, mimeType: 'image/png' }, durationMs: expect.any(Number), costUsd: 0.04 });
    expect([...staged.values()][0]).toEqual(png());
    expect(metrics).toHaveLength(1);
    expect(JSON.stringify(metrics)).not.toContain(hero.prompt);
    expect(JSON.stringify(metrics)).not.toContain('transform');
  });

  test('rejects invalid provider counts and non-PNG provider output', async () => {
    await expect(createPlaceImageGenerator({ repository, ...token, execute: (async () => generated(2)) as any, log: () => {} })(input, userKey)).rejects.toThrow('expected one');
    resetPlaceImageReplayStateForTests();
    await expect(createPlaceImageGenerator({ repository, ...token, execute: (async () => ({ output: { images: [{ base64: 'AQ==', mimeType: 'image/jpeg' }] } })) as any, log: () => {} })(input, userKey)).rejects.toThrow('expected image/png');
    resetPlaceImageReplayStateForTests();
    await expect(createPlaceImageGenerator({ repository, ...token, execute: (async () => generated(1, null, png(1024, 1024))) as any, log: () => {} })(input, userKey)).rejects.toThrow('expected 1536x1024');
    expect(PLACE_IMAGE_PNG_MAX_BYTES).toBe(12 * 1024 * 1024);
  });

  test('coalesces concurrent use, rejects replay, and retains no sensitive state', async () => {
    let calls = 0, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const dependencies = { repository, ...token, execute: (async () => { calls += 1; await gate; return generated(); }) as any, log: () => {} };
    const generate = createPlaceImageGenerator(dependencies);
    const first = generate(input, userKey), second = generate({ ...input, imageRequestToken: `${input.imageRequestToken}-final` }, userKey);
    while (calls === 0) await Promise.resolve();
    release();
    await Promise.all([first, second]);
    expect(calls).toBe(1);
    await expect(generate(input, userKey)).resolves.toMatchObject({ status: 'ready', costUsd: null });
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
