import { z } from 'zod';
import { strictObject } from '@/api/validation';
import { db } from '@/lib/db/client';
import { countrySchema, type Country } from '@/lib/db/countries.node';
import { withArangoKey } from '@/lib/db/base';
import { embedText } from '@/lib/embeddings';
import { getDefaultUserSearchService, type UserSearchService } from '@/lib/user-searches/service';

export const countrySearchInputSchema = strictObject({
  organizationKey: z.string().trim().min(1), query: z.string().trim().min(1).max(200),
});
export type CountrySearchContext = { organizationKey: string; userKey: string };
export const COUNTRY_SEMANTIC_THRESHOLD = 0.72;
export interface CountrySearchRepository {
  authorize(context: CountrySearchContext): Promise<void>;
  findExact(query: string): Promise<Country | null>;
  search(context: CountrySearchContext, embedding: number[]): Promise<{ country: Country; score: number } | null>;
}
export class CountrySearchAccessError extends Error {}
export function createCountrySearchRepository(database = db): CountrySearchRepository {
  return {
    async authorize(context) {
      const cursor = await database.query('FOR membership IN userOrganizations FILTER membership.organizationId == @organizationKey && membership.userId == @userKey && membership.status == "active" LIMIT 1 RETURN true', context);
      if (!await cursor.next()) throw new CountrySearchAccessError('Country search organization access denied.');
    },
    async findExact(query) {
      const normalized = query.trim().toLocaleLowerCase();
      const cursor = await database.query('FOR country IN countries LET name = LOWER(country.name) LET code = LOWER(country.countryCode) FILTER name == @query || code == @query || STARTS_WITH(name, @query) SORT (name == @query || code == @query) DESC, LENGTH(country.name) ASC, country.name ASC LIMIT 1 RETURN country', { query: normalized });
      const value = await cursor.next();
      return value ? countrySchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
    },
    async search(context, embedding) {
    const cursor = await database.query(`
      LET membership = FIRST(FOR candidate IN userOrganizations FILTER candidate.organizationId == @organizationKey && candidate.userId == @userKey && candidate.status == "active" LIMIT 1 RETURN candidate)
      FILTER membership != null
      FOR country IN countries FILTER IS_ARRAY(country.embedding) && LENGTH(country.embedding) == @dimensions
        LET score = COSINE_SIMILARITY(country.embedding, @embedding)
        FILTER IS_NUMBER(score) SORT score DESC, country.name ASC LIMIT 1 RETURN { country, score }
    `, { ...context, embedding, dimensions: embedding.length });
    const value = await cursor.next() as { country?: unknown; score?: unknown } | undefined;
    return value?.country && typeof value.score === 'number' ? { country: countrySchema.parse(withArangoKey(value.country as Record<string, unknown>)), score: value.score } : null;
  } };
}
const embeddingCache = new Map<string, number[]>();
export function createCountrySearchService(options: { repository?: CountrySearchRepository; embed?: typeof embedText; userSearches?: UserSearchService } = {}) {
  const repository = options.repository ?? createCountrySearchRepository();
  const userSearches = options.userSearches ?? getDefaultUserSearchService();
  return { async search(raw: unknown, userKey: string, execution: { signal?: AbortSignal; timeoutMs?: number; queryEmbedding?: number[]; recordHistory?: boolean; minimumScore?: number } = {}) {
    const input = countrySearchInputSchema.parse(raw);
    const context = { organizationKey: input.organizationKey, userKey };
    await repository.authorize(context);
    if (execution.recordHistory !== false) await userSearches.record(userKey, input.query);
    let country = await repository.findExact(input.query);
    if (!country) {
      const cacheKey = input.query.toLocaleLowerCase();
      let embedding = execution.queryEmbedding ?? embeddingCache.get(cacheKey);
      if (!embedding) {
        embedding = await (options.embed ?? embedText)({ text: input.query, signal: execution.signal, timeoutMs: execution.timeoutMs });
        if (embeddingCache.size >= 500) embeddingCache.delete(embeddingCache.keys().next().value!);
        embeddingCache.set(cacheKey, embedding);
      }
      const semantic = await repository.search(context, embedding);
      country = semantic && semantic.score >= (execution.minimumScore ?? COUNTRY_SEMANTIC_THRESHOLD) ? semantic.country : null;
    }
    if (!country) return { country: null };
    const { name, countryCode, latitude, longitude } = country;
    return { country: { name, countryCode, latitude, longitude } };
  } };
}
export function clearCountrySearchEmbeddingCache() { embeddingCache.clear(); }
export type CountrySearchService = ReturnType<typeof createCountrySearchService>;
