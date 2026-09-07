import { describe, expect, test } from 'bun:test';
import { COMMERCE_CATALOG } from './catalog';
import { seedCommerceCatalog } from '@/lib/db/seed';

describe('commerce catalog seed', () => {
  test('runs as part of normal database migration after the products collection exists', async () => {
    const migration = await Bun.file(new URL('../../db/arango-migrate.ts', import.meta.url)).text();
    const collectionLoop = migration.indexOf('for (const spec of collections)');
    const collectionCreation = migration.indexOf('await collection.create()', collectionLoop);
    const catalogSeed = migration.indexOf("if (spec.name === 'products') await seedCommerceCatalog(targetDb)", collectionLoop);
    expect(collectionCreation).toBeGreaterThan(collectionLoop);
    expect(catalogSeed).toBeGreaterThan(collectionCreation);
  });

  test('upserts all exact stable keys and preserves provider mappings', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const rows = new Map<string, { key: string; providerProductId: string | null; createdAt: string }>();
    const database = { async query<T>(query: string, bindVars?: Record<string, unknown>) {
      calls.push({ query, bindVars });
      if (query.startsWith('FOR item IN products')) return { async next() { return rows.get(String(bindVars?.productId)); } } as never;
      const product = bindVars?.product as { _key: string; productId: string; providerProductId: string | null; createdAt: string };
      rows.set(product.productId, { key: product._key, providerProductId: product.providerProductId, createdAt: product.createdAt });
      return { async next() { return { key: product._key, created: bindVars?.created }; } } as never;
    } };
    const first = await seedCommerceCatalog(database as never);
    const second = await seedCommerceCatalog(database as never);
    expect(first.map(({ key }) => key)).toEqual(COMMERCE_CATALOG.map(({ key }) => key));
    expect(second).toHaveLength(4);
    expect(calls).toHaveLength(16);
    for (const call of calls.filter(({ query }) => query.includes('UPSERT'))) {
      expect(call.query).toContain('UPSERT { _key: @key }');
      expect((call.bindVars?.product as { _key: string })._key).toMatch(/^c/);
    }
  });

  test('preserves a valid existing key and never removes dependent commerce identity', async () => {
    const existingKey = 'cmtoexistingproduct000001';
    const queries: string[] = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) {
      queries.push(query);
      if (query.startsWith('FOR item IN products')) return { async next() { return bindVars?.productId === COMMERCE_CATALOG[0].productId ? { key: existingKey, providerProductId: 'remote', createdAt: COMMERCE_CATALOG[0].createdAt } : undefined; } } as never;
      const product = bindVars?.product as { _key: string };
      return { async next() { return { key: product._key, created: bindVars?.created }; } } as never;
    } };
    const results = await seedCommerceCatalog(database as never);
    expect(results[0]?.key).toBe(existingKey);
    expect(queries.some((query) => query.includes('REMOVE'))).toBe(false);
  });
});
