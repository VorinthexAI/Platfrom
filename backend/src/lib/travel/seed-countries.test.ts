import { createHash } from 'node:crypto';
import { expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { COUNTRY_CATALOG } from './country-catalog';
import { seedCountryCatalog } from './seed-countries';

test('embeds missing countries and upserts catalog rows', async () => {
  const queries: string[] = [];
  const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index / EMBEDDING_DIMENSIONS);
  const results = await seedCountryCatalog({
    query: async (query: string) => {
      queries.push(query);
      return { next: async () => query.includes('UPSERT') ? 'ckey' : null };
    },
  } as never, { embed: async ({ texts }) => texts.map(() => embedding) });
  expect(results).toHaveLength(COUNTRY_CATALOG.length);
  expect(results.every(({ status }) => status === 'created')).toBe(true);
  expect(queries.some((query) => query.includes('UPSERT { countryCode: @countryCode }'))).toBe(true);
});

test('does not re-embed countries whose catalog hash is current', async () => {
  let embeds = 0;
  const catalog = new Map(COUNTRY_CATALOG.map((country) => [country.countryCode, country]));
  await seedCountryCatalog({
    query: async (query: string, bindVars?: Record<string, unknown>) => {
      if (query.includes('FILTER country.countryCode')) {
        const country = catalog.get(String(bindVars?.countryCode));
        return { next: async () => ({ key: 'k', semanticVersion: 1, semanticHash: createHash('sha256').update(country!.name).digest('hex') }) };
      }
      return { next: async () => 'k' };
    },
  } as never, { embed: async ({ texts }) => { embeds += texts.length; return texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0)); } });
  expect(embeds).toBe(0);
});
