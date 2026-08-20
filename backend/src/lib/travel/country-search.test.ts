import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { COUNTRY_CATALOG } from './country-catalog';
import { clearCountrySearchEmbeddingCache, countrySearchInputSchema, createCountrySearchService } from './country-search';

describe('country search', () => {
  test('has one deterministic catalog row for every canonical country code', () => {
    expect(COUNTRY_CATALOG).toHaveLength(249);
    expect(new Set(COUNTRY_CATALOG.map(({ countryCode }) => countryCode)).size).toBe(249);
    expect(COUNTRY_CATALOG.every(({ key, name, latitude, longitude }) => key.startsWith('c') && name.length > 0 && Number.isFinite(latitude) && Number.isFinite(longitude))).toBe(true);
  });

  test('uses strict input and returns only the public top-one projection', async () => {
    clearCountrySearchEmbeddingCache();
    const country = { key: newId(), name: 'Portugal', countryCode: 'PT' as const, latitude: 39.61, longitude: -8.27, embedding: Array(EMBEDDING_DIMENSIONS).fill(0) };
    const calls: unknown[] = [];
    const service = createCountrySearchService({
      embed: async (input) => { calls.push(input.text); return country.embedding; },
      repository: { authorize: async (context) => { calls.push(context); }, findExact: async () => null, search: async (context, embedding) => { calls.push(context, embedding); return { country: { ...country, semanticVersion: 1, semanticHash: 'a'.repeat(64) }, score: 0.9 }; } },
    });
    await expect(service.search({ organizationKey: 'org', query: ' portugal ', extra: true }, 'user')).rejects.toThrow('Unrecognized key');
    await expect(service.search({ organizationKey: 'org', query: ' portugal ' }, 'user')).resolves.toEqual({ country: { name: 'Portugal', countryCode: 'PT', latitude: 39.61, longitude: -8.27 } });
    expect(calls[0]).toEqual({ organizationKey: 'org', userKey: 'user' });
    expect(calls[1]).toBe('portugal');
    expect(countrySearchInputSchema.safeParse({ organizationKey: 'org', query: '' }).success).toBe(false);
  });

  test('authorizes before exact matching or embedding, prefers exact matches, and thresholds semantics', async () => {
    clearCountrySearchEmbeddingCache();
    const country = { key: newId(), name: 'Portugal', countryCode: 'PT' as const, latitude: 39.61, longitude: -8.27, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), semanticVersion: 1 as const, semanticHash: 'a'.repeat(64) };
    const order: string[] = [];
    let embeds = 0;
    const exact = createCountrySearchService({ repository: { authorize: async () => { order.push('authorize'); }, findExact: async () => { order.push('exact'); return country; }, search: async () => { throw new Error('semantic not expected'); } }, embed: async () => { embeds += 1; return country.embedding; } });
    await expect(exact.search({ organizationKey: 'org', query: 'PT' }, 'user')).resolves.toMatchObject({ country: { countryCode: 'PT' } });
    expect(order).toEqual(['authorize', 'exact']); expect(embeds).toBe(0);

    const semantic = createCountrySearchService({ repository: { authorize: async () => { order.push('authorize-2'); }, findExact: async () => null, search: async () => ({ country, score: 0.71 }) }, embed: async ({ signal, timeoutMs }) => { expect(signal).toBeInstanceOf(AbortSignal); expect(timeoutMs).toBe(321); embeds += 1; return country.embedding; } });
    await expect(semantic.search({ organizationKey: 'org', query: 'Iberian destination' }, 'user', { signal: new AbortController().signal, timeoutMs: 321 })).resolves.toEqual({ country: null });
    expect(order.at(-1)).toBe('authorize-2'); expect(embeds).toBe(1);
    await expect(createCountrySearchService({ repository: { authorize: async () => { throw new Error('forbidden'); }, findExact: async () => country, search: async () => null }, embed: async () => { embeds += 1; return country.embedding; } }).search({ organizationKey: 'org', query: 'Portugal' }, 'user')).rejects.toThrow('forbidden');
    expect(embeds).toBe(1);
  });
});
