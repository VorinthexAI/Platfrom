import { expect, test } from 'bun:test';
import { MOTHER_SCOPE_KEY } from '@/lib/ai/scopes';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import { graphMigrations } from '.';
import { applyCanonicalSeed, canonicalSeedMigration, RETIRED_SEEDED_SCOPE_SLUGS, SEEDED_SCOPES, SEEDED_TEAM, seedCommerceCatalog, seededScopeVisibility } from './0018-canonical-seed';

test('registers canonical seed in the graph migration sequence', () => {
  expect(graphMigrations.map(({ id }) => id)).toContain('0018-canonical-seed');
  expect(canonicalSeedMigration.id).toBe('0018-canonical-seed');
  expect(graphMigrations.at(-1)?.id).toBe('0019-user-notifications');
});

test('seeds only the live Vorinthex AI, Core, HQ, and product scopes', () => {
  expect(SEEDED_TEAM).toMatchObject({ name: 'Founders', slug: 'founders', is_root: true, mfa_enabled: true });
  expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === null).map(({ slug }) => slug)).toEqual(['vorinthex-ai']);
  expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === MOTHER_SCOPE_KEY).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['core', 'hq']);
  const core = SEEDED_SCOPES.find(({ slug }) => slug === 'core')!;
  expect(SEEDED_SCOPES.filter(({ parentKey }) => parentKey === core.key).sort((left, right) => left.position - right.position).map(({ slug }) => slug)).toEqual(['archive', 'gallery', 'signal', 'compass', 'ascend']);
  expect(SEEDED_SCOPES.find(({ slug }) => slug === 'vorinthex-ai')?.key).toBe(MOTHER_SCOPE_KEY);
  expect(seededScopeVisibility('hq')).toBe('private');
  expect(seededScopeVisibility('core')).toBe('hidden');
  expect(seededScopeVisibility('vorinthex-ai')).toBe('hidden');
  expect(SEEDED_SCOPES.filter(({ slug }) => slug !== 'hq' && slug !== 'core' && slug !== 'vorinthex-ai').every(({ slug }) => seededScopeVisibility(slug) === 'public')).toBe(true);
  expect(RETIRED_SEEDED_SCOPE_SLUGS).toContain('command');
  expect(RETIRED_SEEDED_SCOPE_SLUGS).toContain('atlas');
  expect(SEEDED_SCOPES.map(({ slug }) => slug)).not.toContain('command');
  expect(SEEDED_SCOPES.map(({ slug }) => slug)).not.toContain('atlas');
});

test('upserts commerce products and removes orchestrators', async () => {
  const queries: string[] = [];
  const products = new Map<string, { key: string }>();
  const database = {
    collection: (name: string) => ({ exists: async () => name === 'orchestrators' || name === 'userTeams' || name === 'channelParticipants' }),
    query: async (query: string, bindVars?: Record<string, unknown>) => {
      queries.push(query);
      if (query.startsWith('FOR item IN products')) return { next: async () => undefined, all: async () => [] };
      if (query.includes('UPSERT { _key: @key }') && bindVars?.product) {
        const product = bindVars.product as { _key: string };
        products.set(product._key, { key: product._key });
        return { next: async () => ({ key: product._key, created: true }), all: async () => [] };
      }
      if (query.includes('FILTER team.is_root == true')) return { next: async () => ({ key: 'root-team' }), all: async () => [] };
      if (query.includes('RETURN { scopeKey:')) return { all: async () => [] };
      return { next: async () => undefined, all: async () => [] };
    },
  };
  await applyCanonicalSeed(database as never);
  expect([...products.keys()]).toEqual(COMMERCE_CATALOG.map(({ key }) => key));
  expect(queries.some((query) => query.includes('REMOVE orchestrator IN orchestrators'))).toBe(true);
  expect(queries.some((query) => query.includes('orchestratorKey: null'))).toBe(true);
  expect(queries.some((query) => query.includes('scope.slug IN @retiredSlugs'))).toBe(true);
});

test('preserves existing commerce product keys', async () => {
  const existingKey = 'cmtoexistingproduct000001';
  const database = {
    async query(query: string, bindVars?: Record<string, unknown>) {
      if (query.startsWith('FOR item IN products')) return { async next() { return bindVars?.productId === COMMERCE_CATALOG[0].productId ? { key: existingKey, providerProductId: 'remote', createdAt: COMMERCE_CATALOG[0].createdAt } : undefined; } };
      const product = bindVars?.product as { _key: string };
      return { async next() { return { key: product._key, created: bindVars?.created }; } };
    },
  };
  const results = await seedCommerceCatalog(database as never);
  expect(results[0]?.key).toBe(existingKey);
});
