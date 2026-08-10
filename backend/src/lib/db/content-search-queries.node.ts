import { z } from 'zod';
import { db } from './client';
import { toArangoDoc, withArangoKey } from './base';

export const CONTENT_SEARCH_QUERIES_COLLECTION = 'contentSearchQueries';
export const CONTENT_SEARCH_CACHE_VERSION = 2;

export const contentSearchQuerySchema = z.object({
  key: z.string().cuid(),
  actorKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  query: z.string().trim().min(1).max(8_000),
  normalizedQuery: z.string().trim().min(1).max(8_000),
  folderKey: z.string().cuid().nullable().default(null),
  includeDescendants: z.boolean().default(false),
  cacheVersion: z.number().int().positive(),
  output: z.unknown(),
  count: z.number().int().positive(),
  searchedAt: z.string().datetime(),
}).strict();

const storedDocumentSchema = z.object({ documentKey: z.string().cuid(), scopeKey: z.string().cuid(), folderKey: z.string().cuid().optional(), name: z.string().trim().min(1), score: z.number().min(0).max(1), summary: z.string().trim().min(1) }).strict();

export const contentSearchQueries = {
  async get(input: { actorKey: string; scopeKey: string; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number }) {
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey
          && query.normalizedQuery == @normalizedQuery && query.cacheVersion == @cacheVersion
          && query.folderKey == @folderKey && query.includeDescendants == @includeDescendants
        LIMIT 1
        RETURN query
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    const value = await cursor.next();
    return value ? contentSearchQuerySchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
  },
  async record(input: { key: string; actorKey: string; scopeKey: string; query: string; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number; output: unknown; now: string }) {
    const { now, ...stored } = input;
    const value = contentSearchQuerySchema.parse({ ...stored, count: 1, searchedAt: now });
    await db.query(`
      UPSERT { actorKey: @actorKey, scopeKey: @scopeKey, normalizedQuery: @normalizedQuery, folderKey: @folderKey, includeDescendants: @includeDescendants }
        INSERT @value
        UPDATE { query: @query, output: @output, cacheVersion: @cacheVersion, searchedAt: @now, count: OLD.count + 1 }
        IN @@collection
    `, {
      '@collection': CONTENT_SEARCH_QUERIES_COLLECTION,
      actorKey: input.actorKey,
      scopeKey: input.scopeKey,
      normalizedQuery: input.normalizedQuery,
      folderKey: input.folderKey,
      includeDescendants: input.includeDescendants,
      query: input.query,
      output: input.output,
      cacheVersion: input.cacheVersion,
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
  async list(input: { actorKey: string; scopeKey: string; folderKey: string | null; includeDescendants: boolean; limit: number }) {
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey
        FILTER query.folderKey == @folderKey && query.includeDescendants == @includeDescendants
        SORT query.searchedAt DESC
        LIMIT @limit
        LET result = query.output.result
        RETURN MERGE(KEEP(query, "query", "normalizedQuery", "searchedAt", "count"), query.folderKey == null ? {} : { folderKey: query.folderKey, includeDescendants: query.includeDescendants }, { documents: IS_ARRAY(result.documents) ? result.documents : [] })
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    return z.array(z.object({ query: z.string(), normalizedQuery: z.string(), searchedAt: z.string().datetime(), count: z.number().int().positive(), folderKey: z.string().cuid().optional(), includeDescendants: z.boolean().optional(), documents: z.array(storedDocumentSchema).max(10) }).strict()).parse(await cursor.all());
  },
};
