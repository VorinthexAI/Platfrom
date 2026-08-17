import { describe, expect, test } from 'bun:test';
import { createUserSettingsService, UserSettingsNotFoundError } from './service';

describe('user settings service', () => {
  test('reads and updates settings through one canonical repository boundary', async () => {
    const calls: unknown[] = [];
    const repository = {
      read: async (userKey: string) => { calls.push(['read', userKey]); return { archive: { showOnlyFavorites: false } }; },
      update: async (userKey: string, settings: unknown, updatedAt: string) => { calls.push(['update', userKey, settings, updatedAt]); return settings as any; },
    };
    const service = createUserSettingsService({ repository, now: () => '2026-08-17T00:00:00.000Z' });
    expect(await service.read('user-1')).toEqual({ archive: { showOnlyFavorites: false } });
    expect(await service.update('user-1', { archive: { showOnlyFavorites: true } })).toEqual({ archive: { showOnlyFavorites: true } });
    expect(calls).toEqual([
      ['read', 'user-1'],
      ['update', 'user-1', { archive: { showOnlyFavorites: true } }, '2026-08-17T00:00:00.000Z'],
    ]);
  });

  test('rejects unknown settings and missing users', async () => {
    const service = createUserSettingsService({ repository: { read: async () => null, update: async () => null } });
    await expect(service.update('user-1', { archive: { showOnlyFavorites: false }, extra: true })).rejects.toThrow();
    await expect(service.read('user-1')).rejects.toBeInstanceOf(UserSettingsNotFoundError);
  });
});
