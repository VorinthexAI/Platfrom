import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createAccountProfileService, profileNameUpdateInputSchema } from './service';

const userKey = newId();
const now = new Date('2026-09-03T10:00:00.000Z');

describe('account profile service', () => {
  test('strictly updates a trimmed name for the authenticated user key', async () => {
    const calls: unknown[] = [];
    const service = createAccountProfileService({
      now: () => now,
      updateUser: async (key, patch) => {
        calls.push({ key, patch });
        return { key, name: patch.name, profileStorageKey: null, updatedAt: patch.updatedAt };
      },
    });
    await expect(service.updateName({ name: '  Ada Lovelace  ' }, userKey)).resolves.toEqual({ profile: { key: userKey, name: 'Ada Lovelace', profileStorageKey: null, updatedAt: now.toISOString() } });
    expect(calls).toEqual([{ key: userKey, patch: { name: 'Ada Lovelace', updatedAt: now.toISOString() } }]);
    expect(() => profileNameUpdateInputSchema.parse({ name: 'Ada', userKey })).toThrow('Unrecognized key');
    expect(() => profileNameUpdateInputSchema.parse({ name: ' '.repeat(3) })).toThrow();
    expect(() => profileNameUpdateInputSchema.parse({ name: 'x'.repeat(201) })).toThrow();
  });

  test('replaces the avatar through atomic persistence without performing unsafe storage compensation', async () => {
    const oldKey = `profiles/${userKey}/${newId()}.png`;
    const nextKey = `profiles/${userKey}/${newId()}.png`;
    const service = createAccountProfileService({
      now: () => now,
      replaceStorageKey: async (key, storageKey, updatedAt) => ({ key, name: 'Ada', profileStorageKey: storageKey, previousStorageKey: oldKey, updatedAt }),
    });
    await expect(service.replaceAvatar({ storageKey: nextKey }, userKey)).resolves.toMatchObject({ profile: { key: userKey, profileStorageKey: nextKey }, previousStorageKey: oldKey });
    await expect(service.replaceAvatar({ storageKey: `profiles/${newId()}/${newId()}.png` }, userKey)).rejects.toMatchObject({ code: 'PROFILE_INVALID_STORAGE_KEY' });

    const failure = new Error('transaction failed');
    const failing = createAccountProfileService({ replaceStorageKey: async () => { throw failure; } });
    await expect(failing.replaceAvatar({ storageKey: nextKey }, userKey)).rejects.toBe(failure);
  });
});
