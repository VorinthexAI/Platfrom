import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { observeToolExecution } from '@/lib/ai/events/runtime';
import { createProfileBadgeService, profileBadgePrompt } from './badge';

const userKey = newId();
const context = {
  teamKey: 'team-1',
  runtimeScopeKey: newId(),
  principal: { kind: 'member', user: { key: userKey, name: 'Ada Lovelace' }, userTeam: { key: newId(), teamKey: 'team-1', userId: userKey, status: 'active' } },
} as any;

describe('profile badge service', () => {
  test('builds a deterministic visual prompt with the display name as untrusted inspiration', () => {
    const prompt = profileBadgePrompt(userKey, '  Ada   Lovelace  ');
    expect(prompt).toContain('untrusted display name only as abstract semantic inspiration');
    expect(prompt).toContain('"Ada Lovelace"');
    expect(prompt).toContain('No people, faces, text, names, initials');
    expect(profileBadgePrompt(userKey, 'Ada Lovelace')).toBe(prompt);
  });

  test('generates, canonicalizes, stores, reserves, and signs one candidate', async () => {
    const png = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#030507' } }).png().toBuffer();
    const candidateKey = newId();
    const calls: unknown[][] = [];
    const service = createProfileBadgeService({
      id: () => candidateKey,
      now: () => new Date('2026-09-09T10:00:00.000Z'),
      execute: (async (...args: unknown[]) => {
        calls.push(['execute', ...args]);
        return { output: { images: [{ base64: png.toString('base64'), mimeType: 'image/png' }] }, usage: {}, providerId: 'openrouter', modelId: 'model', externalModelId: 'model' };
      }) as any,
      storage: {
        upload: async (input) => { calls.push(['upload', input]); },
        delete: async (key) => { calls.push(['delete', key]); },
      },
      redis: {
        get: async () => null,
        set: (async (...args: unknown[]) => { calls.push(['set', ...args]); return 'OK'; }) as any,
        del: (async (...args: unknown[]) => { calls.push(['del', ...args]); return 1; }) as any,
      },
      sign: async (key) => { calls.push(['sign', key]); return 'https://example.com/badge.png'; },
    });

    await expect(service.generate({}, context, 'request-1')).resolves.toEqual({
      candidateKey,
      avatarUrl: 'https://example.com/badge.png',
      expiresAt: '2026-09-09T10:10:00.000Z',
    });
    expect(calls[0]).toMatchObject(['execute', { mode: 'auto', teamKey: 'team-1', actionSlug: 'image' }, { operation: 'generate', count: 1, aspectRatio: '1:1', outputFormat: 'png' }, { providers: ['image.primary'] }]);
    expect(calls).toContainEqual(['upload', expect.objectContaining({ key: `pending/profile-avatars/${userKey}/${candidateKey}/original.png`, mimeType: 'image/png' })]);
    expect(calls).toContainEqual(['sign', `pending/profile-avatars/${userKey}/${candidateKey}/original.png`]);
    await expect(service.generate({ unexpected: true }, context, 'request-2')).rejects.toThrow('Unrecognized key');
  });

  test('deletes the temporary object and reservation when signing fails', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#030507' } }).png().toBuffer();
    const deleted: string[] = [];
    const redisDeletes: string[] = [];
    const service = createProfileBadgeService({
      execute: (async () => ({ output: { images: [{ base64: png.toString('base64'), mimeType: 'image/png' }] } })) as any,
      storage: { upload: async () => undefined, delete: async (key) => { deleted.push(key); } },
      redis: { get: async () => null, set: (async () => 'OK') as any, del: (async (key: string) => { redisDeletes.push(key); return 1; }) as any },
      sign: async () => { throw new Error('signing failed'); },
    });
    await expect(service.generate({}, context, 'request-1')).rejects.toThrow('signing failed');
    expect(deleted).toHaveLength(1);
    expect(redisDeletes).toHaveLength(2);
  });

  test('returns the reserved candidate without another provider call when a paid request replays', async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#030507' } }).png().toBuffer();
    const values = new Map<string, string>();
    const candidateKey = newId();
    const transaction = { key: newId(), eventKey: newId() };
    let providerCalls = 0;
    let chargeCalls = 0;
    const service = createProfileBadgeService({
      id: () => candidateKey,
      execute: (async () => { providerCalls += 1; return { output: { images: [{ base64: png.toString('base64'), mimeType: 'image/png' }] } }; }) as any,
      storage: { upload: async () => undefined, delete: async () => undefined },
      redis: {
        get: async (key) => values.get(String(key)) ?? null,
        set: (async (key: string, value: string) => { if (values.has(key)) return null; values.set(key, value); return 'OK'; }) as any,
        del: (async (key: string) => Number(values.delete(key))) as any,
      },
      sign: async () => 'https://example.com/badge.png',
    });
    const execute = () => observeToolExecution('profile.badge.generate', context, () => service.generate({}, context, 'same-request'), {
      appScopeKey: newId(),
      idempotencyKey: 'same-request',
      input: {},
      recorder: async () => undefined,
      charge: async () => ({ status: chargeCalls++ === 0 ? 'applied' : 'replayed', transaction, claimOwner: 'owner-1' }) as any,
      complete: async () => true,
      renew: async () => true,
    });
    const first = await execute();
    const replay = await execute();
    expect(replay).toEqual(first);
    expect(providerCalls).toBe(1);
    expect(chargeCalls).toBe(2);
  });

  test('claims through the canonical avatar completion path with the authenticated user', async () => {
    const candidateKey = newId();
    const calls: unknown[][] = [];
    const service = createProfileBadgeService({ complete: (async (...args: unknown[]) => { calls.push(args); return { profile: {} }; }) as any });
    await service.claim({ candidateKey }, userKey);
    expect(calls).toEqual([[{ uploadKey: candidateKey }, userKey, undefined]]);
    expect(() => service.claim({ candidateKey, userKey }, userKey)).toThrow('Unrecognized key');
  });
});
