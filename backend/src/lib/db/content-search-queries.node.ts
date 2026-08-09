import { z } from 'zod';
import { db } from './client';
import { toArangoDoc, withArangoKey } from './base';

export const CONTENT_SEARCH_QUERIES_COLLECTION = 'contentSearchQueries';
export const CONTENT_SEARCH_CACHE_VERSION = 1;

export const contentSearchQuerySchema = z.object({
  key: z.string().cuid(),
  actorKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  query: z.string().trim().min(1).max(8_000),
  normalizedQuery: z.string().trim().min(1).max(8_000),
  cacheVersion: z.number().int().positive(),
  output: z.unknown(),
  count: z.number().int().positive(),
  searchedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
}).strict();

export const contentSearchQueries = {
  async get(input: { actorKey: string; scopeKey: string; normalizedQuery: string; cacheVersion: number; now: string }) {
    await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query.expiresAt <= @now && query.output != null
        UPDATE query WITH { output: null } IN @@collection
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, actorKey: input.actorKey, scopeKey: input.scopeKey, now: input.now });
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey
          && query.normalizedQuery == @normalizedQuery && query.cacheVersion == @cacheVersion
          && query.expiresAt > @now
        LIMIT 1
        RETURN query
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    const value = await cursor.next();
    return value ? contentSearchQuerySchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
  },
  async record(input: { key: string; actorKey: string; scopeKey: string; query: string; normalizedQuery: string; cacheVersion: number; output: unknown; now: string; expiresAt: string }) {
    const { now, ...stored } = input;
    const value = contentSearchQuerySchema.parse({ ...stored, count: 1, searchedAt: now });
    await db.query(`
      UPSERT { actorKey: @actorKey, scopeKey: @scopeKey, normalizedQuery: @normalizedQuery }
        INSERT @value
        UPDATE { query: @query, output: @output, cacheVersion: @cacheVersion, expiresAt: @expiresAt, searchedAt: @now, count: OLD.count + 1 }
        IN @@collection
    `, {
      '@collection': CONTENT_SEARCH_QUERIES_COLLECTION,
      actorKey: input.actorKey,
      scopeKey: input.scopeKey,
      normalizedQuery: input.normalizedQuery,
      query: input.query,
      output: input.output,
      cacheVersion: input.cacheVersion,
      expiresAt: input.expiresAt,
      now: input.now,
      value: toArangoDoc(value),
    });
    await db.query(`
      LET retained = (FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey
        SORT query.searchedAt DESC
        LIMIT 100
        RETURN query._key)
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query._key NOT IN retained
        REMOVE query IN @@collection
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, actorKey: input.actorKey, scopeKey: input.scopeKey });
  },
  async list(input: { actorKey: string; scopeKey: string; limit: number }) {
    await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query.expiresAt <= DATE_ISO8601(DATE_NOW()) && query.output != null
        UPDATE query WITH { output: null } IN @@collection
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, actorKey: input.actorKey, scopeKey: input.scopeKey });
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey
        SORT query.searchedAt DESC
        LIMIT @limit
        RETURN KEEP(query, "query", "normalizedQuery", "searchedAt", "count")
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    return z.array(z.object({ query: z.string(), normalizedQuery: z.string(), searchedAt: z.string().datetime(), count: z.number().int().positive() }).strict()).parse(await cursor.all());
  },
};
