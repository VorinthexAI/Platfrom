import { describe, expect, test } from 'bun:test';
import { appSchema } from '@/lib/db/apps.node';
import { APP_KEYS, APP_KEYS_BY_SLUG, CANONICAL_APPS, seedApps } from './registry';

describe('canonical apps registry', () => {
  test('defines the exact stable app identities and concise public descriptions', () => {
    expect(CANONICAL_APPS.map(({ key, slug, version }) => ({ key, slug, version }))).toEqual([
      { key: 'cmtlinos40000w07k6xky0v3q', slug: 'vorinthex-ai', version: '1.0.0' },
      { key: 'cmtlinos60001w07k644x6qo3', slug: 'archive', version: '1.0.0' },
      { key: 'cmtlinos60002w07k9ec59vqk', slug: 'gallery', version: '1.0.0' },
      { key: 'cmtlinos60003w07kg57h2hhq', slug: 'compass', version: '1.0.0' },
      { key: 'cmtlinos60004w07kfuh9fl4i', slug: 'signal', version: '1.0.0' },
      { key: 'cmtlinos60005w07k7cjlfur0', slug: 'ascend', version: '1.0.0' },
      { key: 'cmtlinos60006w07k04cc0cvr', slug: 'core', version: '1.0.0' },
    ]);
    expect(new Set(CANONICAL_APPS.map(({ slug }) => slug)).size).toBe(7);
    for (const app of CANONICAL_APPS) expect(app.description.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(APP_KEYS_BY_SLUG.signal).toBe(APP_KEYS.SIGNAL);
  });

  test('uses a strict public schema without embeddings or Arango keys', () => {
    const input = { ...CANONICAL_APPS[0], createdAt: '2026-09-03T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' };
    expect(appSchema.parse(input)).toEqual(input);
    expect(() => appSchema.parse({ ...input, embedding: [] })).toThrow();
    expect(() => appSchema.parse({ ...input, _key: input.key })).toThrow();
  });

  test('is idempotent, preserves createdAt, and updates only changed rows', async () => {
    const rows = new Map<string, any>();
    const repository = {
      getByKey: async (key: string) => rows.get(key) ?? null,
      insert: async (app: any) => { rows.set(app.key, app); return app; },
      update: async (key: string, patch: any) => { const value = { ...rows.get(key), ...patch }; rows.set(key, value); return value; },
    };
    expect(await seedApps(repository, () => '2026-09-01T00:00:00.000Z')).toHaveLength(7);
    expect(await seedApps(repository, () => '2026-09-02T00:00:00.000Z')).toEqual([]);
    rows.set(APP_KEYS.CORE, { ...rows.get(APP_KEYS.CORE), name: 'Old Core' });
    expect(await seedApps(repository, () => '2026-09-03T00:00:00.000Z')).toEqual([{ collection: 'apps', key: APP_KEYS.CORE, status: 'updated' }]);
    expect(rows.get(APP_KEYS.CORE)).toMatchObject({ name: 'Core', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-03T00:00:00.000Z' });
  });

  test('runs as the first part of the deterministic deployment seed', async () => {
    const source = await Bun.file(new URL('../db/seed.ts', import.meta.url)).text();
    expect(source).toContain('const results: SeedResult[] = [...await seedApps()]');
  });
});
