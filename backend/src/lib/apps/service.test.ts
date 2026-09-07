import { describe, expect, test } from 'bun:test';
import { CANONICAL_APPS } from './registry';
import { createAppsService } from './service';

const scopes = CANONICAL_APPS.map((app, index) => ({ key: `cm00000000000000000000${String(index).padStart(2, '0')}`, teamKey: 'root', slug: app.slug, name: app.name, summary: app.description, description: app.detailedDescription, position: index + 1, level: 1, embedding: [] }));
const catalog = CANONICAL_APPS.map((app) => ({ key: app.key, name: app.name, description: app.description, detailedDescription: app.detailedDescription }));
const readCatalog = async () => catalog;

describe('apps service', () => {
  test('returns strict apps in deterministic slug and key order', async () => {
    let calls = 0;
    const rows = [...scopes].reverse();
    const service = createAppsService({ list: async () => { calls += 1; return rows; } }, undefined, readCatalog);

    const apps = await service.list();

    expect(calls).toBe(1);
    expect(apps.map(({ slug }) => slug)).toEqual([...rows].sort((left, right) => left.slug.localeCompare(right.slug) || left.key.localeCompare(right.key)).map(({ slug }) => slug));
    expect(apps.every(({ detailedDescription }) => detailedDescription.length > 0)).toBe(true);
    expect(apps.find(({ slug }) => slug === 'core')?.detailedDescription).toBe(CANONICAL_APPS.find(({ slug }) => slug === 'core')?.detailedDescription);
    expect(apps.every((app) => !('logoStorageKey' in app))).toBe(true);
  });

  test('reads descriptions from the managed directory while preserving stable transport names', async () => {
    const changed = scopes.map((scope) => scope.slug === 'core' ? { ...scope, name: 'Mutable scope label', summary: 'Persisted summary', description: 'Persisted detailed product description.' } : scope);
    const managed = catalog.map((entry) => entry.name === 'Core' ? { ...entry, description: 'Managed brief', detailedDescription: 'Managed detailed product description.' } : entry);
    const service = createAppsService({ list: async () => changed }, undefined, async () => managed);
    const core = (await service.list()).find(({ slug }) => slug === 'core')!;
    expect(core).toMatchObject({ name: 'Core', description: 'Managed brief', detailedDescription: 'Managed detailed product description.' });
  });

  test('signs logo storage keys only in the public projection', async () => {
    const signed: string[] = [];
    const service = createAppsService({ list: async () => scopes }, async (storageKey) => {
      signed.push(storageKey);
      return `https://assets.example/${storageKey}`;
    }, readCatalog);

    const apps = await service.listPublic();

    expect(signed).toHaveLength(7);
    expect(signed).toContain(CANONICAL_APPS[0]!.logoStorageKey);
    expect(apps.every(({ logoUrl }) => logoUrl.startsWith('https://assets.example/apps/logos/v1/'))).toBe(true);
    expect(apps[0]).not.toHaveProperty('logoStorageKey');
  });

  test('fails closed when any designated root product scope is absent', async () => {
    const service = createAppsService({ list: async () => scopes.slice(1) }, undefined, readCatalog);
    await expect(service.list()).rejects.toThrow('missing: vorinthex-ai');
  });
});
