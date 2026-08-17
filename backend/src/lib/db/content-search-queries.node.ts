import { z } from 'zod';
import { db } from './client';
import { toArangoDoc, withArangoKey } from './base';

export const CONTENT_SEARCH_QUERIES_COLLECTION = 'contentSearchQueries';
export const CONTENT_SEARCH_CACHE_VERSION = 4;
export const CONTENT_SEARCH_CONTEXT_DOMAIN = 'content' as const;

export const contentSearchQuerySchema = z.object({
  key: z.string().cuid(),
  actorKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  contextDomain: z.literal(CONTENT_SEARCH_CONTEXT_DOMAIN).default(CONTENT_SEARCH_CONTEXT_DOMAIN),
  query: z.string().trim().min(1).max(8_000),
  normalizedQuery: z.string().trim().min(1).max(8_000),
  folderKey: z.string().cuid().nullable().default(null),
  includeDescendants: z.boolean().default(false),
  cacheVersion: z.number().int().positive(),
  output: z.unknown(),
  usageCount: z.number().int().positive(),
  searchedAt: z.string().datetime(),
}).strict();

const storedDocumentSchema = z.object({ documentKey: z.string().cuid(), scopeKey: z.string().cuid(), folderKey: z.string().cuid().optional(), name: z.string().trim().min(1), extension: z.string().trim().min(1).optional(), isFavorite: z.boolean(), score: z.number().min(0).max(1), summary: z.string().trim().min(1).optional() }).strict();

export const contentSearchQueries = {
  async get(input: { actorKey: string; scopeKey: string; contextDomain: typeof CONTENT_SEARCH_CONTEXT_DOMAIN; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number }) {
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query.contextDomain == @contextDomain
          && query.normalizedQuery == @normalizedQuery && query.cacheVersion == @cacheVersion
          && query.folderKey == @folderKey && query.includeDescendants == @includeDescendants
        LIMIT 1
        RETURN query
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    const value = await cursor.next();
    return value ? contentSearchQuerySchema.parse(withArangoKey(value as Record<string, unknown>)) : null;
  },
  async record(input: { key: string; actorKey: string; scopeKey: string; contextDomain: typeof CONTENT_SEARCH_CONTEXT_DOMAIN; query: string; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean; cacheVersion: number; output: unknown; now: string }) {
    const { now, ...stored } = input;
    const value = contentSearchQuerySchema.parse({ ...stored, usageCount: 1, searchedAt: now });
    await db.query(`
      UPSERT { actorKey: @actorKey, scopeKey: @scopeKey, contextDomain: @contextDomain, normalizedQuery: @normalizedQuery, folderKey: @folderKey, includeDescendants: @includeDescendants }
        INSERT @value
        UPDATE { query: @query, output: @output, cacheVersion: @cacheVersion, searchedAt: @now, usageCount: (OLD.usageCount || OLD.count || 0) + 1, count: null }
        IN @@collection OPTIONS { keepNull: false }
    `, {
      '@collection': CONTENT_SEARCH_QUERIES_COLLECTION,
      actorKey: input.actorKey,
      scopeKey: input.scopeKey,
      contextDomain: input.contextDomain,
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
  async list(input: { actorKey: string; scopeKey: string; contextDomain: typeof CONTENT_SEARCH_CONTEXT_DOMAIN; folderKey: string | null; includeDescendants: boolean; cacheVersion: number; limit: number }) {
    const cursor = await db.query(`
      FOR query IN @@collection
        FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query.contextDomain == @contextDomain
        FILTER query.cacheVersion == @cacheVersion
        FILTER query.folderKey == @folderKey && query.includeDescendants == @includeDescendants
        SORT query.searchedAt DESC
        LIMIT @limit
        LET result = query.output.result
        RETURN MERGE(KEEP(query, "query", "normalizedQuery", "contextDomain", "searchedAt", "usageCount"), query.folderKey == null ? {} : { folderKey: query.folderKey, includeDescendants: query.includeDescendants }, { documents: IS_ARRAY(result.documents) ? result.documents : [] })
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    return z.array(z.object({ query: z.string(), normalizedQuery: z.string(), contextDomain: z.literal(CONTENT_SEARCH_CONTEXT_DOMAIN), searchedAt: z.string().datetime(), usageCount: z.number().int().positive(), folderKey: z.string().cuid().optional(), includeDescendants: z.boolean().optional(), documents: z.array(storedDocumentSchema).max(10) }).strict()).parse(await cursor.all());
  },
  async remove(input: { actorKey: string; scopeKey: string; contextDomain: typeof CONTENT_SEARCH_CONTEXT_DOMAIN; normalizedQuery: string; folderKey: string | null; includeDescendants: boolean }) {
    const cursor = await db.query(`
      LET keys = (FOR query IN @@collection
          FILTER query.actorKey == @actorKey && query.scopeKey == @scopeKey && query.contextDomain == @contextDomain
          FILTER query.normalizedQuery == @normalizedQuery && query.folderKey == @folderKey && query.includeDescendants == @includeDescendants
          RETURN query._key)
      FOR key IN keys
        REMOVE key IN @@collection
        RETURN true
    `, { '@collection': CONTENT_SEARCH_QUERIES_COLLECTION, ...input });
    return Boolean(await cursor.next());
  },
};
