import { describe, expect, test } from 'bun:test';
import { APP_KEYS } from '@/lib/apps/registry';
import { collections, LEGACY_EVENT_APP_KEYS, migrateEventAppKeys } from './arango-migrate';
import { isLegacyIndex } from './arango-migrate-indexes';

describe('event app-key migration', () => {
  test('registers apps before events and replaces the domain index', () => {
    const apps = collections.find(({ name }) => name === 'apps');
    const events = collections.find(({ name }) => name === 'events');
    expect(apps).toEqual({ name: 'apps', skipEmbedding: true, indexes: [{ fields: ['slug'], unique: true }] });
    expect(collections.indexOf(apps!)).toBeLessThan(collections.indexOf(events!));
    expect(events?.indexes).toContainEqual({ fields: ['appKey', 'createdAt'] });
    expect(events?.indexes).not.toContainEqual({ fields: ['domain', 'createdAt'] });
    expect(isLegacyIndex('events', ['domain', 'createdAt'], events?.indexes?.map(({ fields }) => fields) ?? [])).toBe(true);
  });

  test('maps all six legacy domains and removes invalid telemetry before stripping domain', async () => {
    expect(LEGACY_EVENT_APP_KEYS).toEqual({
      archive: APP_KEYS.ARCHIVE,
      gallery: APP_KEYS.GALLERY,
      compass: APP_KEYS.COMPASS,
      signal: APP_KEYS.SIGNAL,
      ascend: APP_KEYS.ASCEND,
      core: APP_KEYS.CORE,
    });
    const queries: Array<{ query: string; bindVars: Record<string, string> }> = [];
    await migrateEventAppKeys({ query: async (query: string, bindVars: Record<string, string>) => { queries.push({ query, bindVars }); return {} as never; } } as never);
    expect(queries).toHaveLength(2);
    expect(queries[0]!.query).toContain('FILTER app == null');
    expect(queries[0]!.query).toContain('REMOVE event IN events');
    expect(queries[1]!.query).toContain('UPDATE event WITH { appKey, domain: null }');
    expect(queries[1]!.query).toContain('OPTIONS { keepNull: false }');
    expect(queries[0]!.bindVars.signalKey).toBe(APP_KEYS.SIGNAL);
  });

  test('seeds apps after creating their collection and before event backfill', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source.indexOf("if (spec.name === 'apps')")).toBeLessThan(source.indexOf("if (spec.name === 'events')"));
    expect(source.indexOf('await seedApps(createAppsRepository(targetDb))')).toBeLessThan(source.indexOf('await migrateEventAppKeys(targetDb)'));
  });
});
