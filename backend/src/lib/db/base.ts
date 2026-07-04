import type { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { embed } from '@/core/actions/embed';

const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

export function isArangoNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'errorNum' in err && (err as { errorNum?: number }).errorNum === 1202;
}

export function isArangoUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'errorNum' in err && (err as { errorNum?: number }).errorNum === 1210;
}

/**
 * Every node's public primary-key field is `key` (no underscore), never Arango's
 * own `_key` system attribute directly. These two helpers are the only place that
 * translates between them: `toArangoDoc` renames `key` -> `_key` before a
 * write, `withArangoKey` adds `key` back onto a raw document read from Arango
 * (`_key`/`_id`/`_rev` are left in place — zod's default "strip" parsing mode
 * drops them silently since no node schema declares those fields).
 */
export function toArangoDoc(doc: Record<string, unknown> & { key: string }): Record<string, unknown> {
  const { key, ...rest } = doc;
  return { _key: key, ...rest };
}

export function withArangoKey<T extends Record<string, unknown>>(raw: T): T & { key: string } {
  return { ...raw, key: (raw as unknown as { _key: string })._key };
}

/**
 * Every node's embedding is built the same way: `_<collection>:<key>:<value>:<value>...`
 * joined from a fixed, per-node ordered list of scalar fields (embedKeys), then run
 * through embed(). Non-scalar fields (objects/arrays), secrets/hashes, booleans, and
 * timestamps are deliberately never eligible — they add no semantic search value and
 * timestamps/booleans belong in an AQL FILTER, not a vector. Nodes with no meaningful
 * searchable text pass an empty embedKeys list and are simply never embedded.
 */
function buildEmbedSlug(collectionName: string, embedKeys: readonly string[], key: string, doc: Record<string, unknown>): string | null {
  if (embedKeys.length === 0) return null;
  const parts = [`_${collectionName}`, key];
  for (const field of embedKeys) {
    const value = doc[field];
    if (value === null || value === undefined || value === '') continue;
    parts.push(String(value));
  }
  return parts.join(':');
}

async function computeEmbedding(
  collectionName: string,
  embedKeys: readonly string[],
  key: string,
  doc: Record<string, unknown>,
): Promise<number[]> {
  const slug = buildEmbedSlug(collectionName, embedKeys, key, doc);
  if (!slug) return [];
  return embed({ text: slug });
}

/**
 * The one unified "get the whole collection" call every node gets. It never
 * loads the full result set into memory at once: `batchSize` controls how many
 * documents Arango returns per round-trip, and `cursor.batches` only fetches
 * the next chunk from the server on demand as the caller consumes each one via
 * `for await`. Each chunk is schema-validated and key-translated the same way
 * as every other read.
 */
function createChunkedScanner<T>(collectionName: string, schema: z.ZodTypeAny) {
  return async function* getAllChunked(chunkSize: number = DEFAULT_CHUNK_SIZE): AsyncGenerator<T[], void, void> {
    const cursor = await db.query(aql`FOR doc IN ${db.collection(collectionName)} RETURN doc`, { batchSize: chunkSize });
    for await (const batch of cursor.batches) {
      yield (batch as Record<string, unknown>[]).map((doc) => schema.parse(withArangoKey(doc)) as T);
    }
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * One page of the collection, sorted by key, resumable via `after`. Unlike
 * `getAllChunked`'s live batch cursor (which only makes sense within a single
 * process/script), this is what a stateless HTTP endpoint needs: each call is
 * a fresh, independent query, and the returned `nextCursor` (the last key
 * seen) is what the caller passes back as `after` on the next request.
 */
function createPageReader<T>(collectionName: string, schema: z.ZodTypeAny) {
  return async function listPage(after?: string, limit: number = DEFAULT_PAGE_SIZE): Promise<Page<T>> {
    const cursor = await db.query(aql`
      FOR doc IN ${db.collection(collectionName)}
        FILTER ${after ?? null} == null || doc._key > ${after ?? null}
        SORT doc._key ASC
        LIMIT ${limit}
        RETURN doc
    `);
    const docs = await cursor.all();
    const items = (docs as Record<string, unknown>[]).map((doc) => schema.parse(withArangoKey(doc)) as T);
    const last = items.at(-1) as unknown as { key: string } | undefined;
    const nextCursor = items.length === limit && last ? last.key : null;
    return { items, nextCursor };
  };
}

function assertNodeSchemaShape(schema: z.AnyZodObject, embedKeys: readonly string[]) {
  const shapeKeys = Object.keys(schema.shape);
  if (!shapeKeys.includes('key')) {
    throw new Error('Every node schema must declare a "key" field (z.string()) as its primary key — not Arango\'s own "_key".');
  }
  if (!shapeKeys.includes('embedding')) {
    throw new Error('Every node schema must declare an "embedding" field (z.array(z.number()).default([])).');
  }
  for (const field of embedKeys) {
    if (!shapeKeys.includes(field)) {
      throw new Error(`embedKeys references unknown field "${field}"; must be one of: ${shapeKeys.join(', ')}`);
    }
  }
}

export function createNodeHelpers<
  Schema extends z.AnyZodObject,
  Keys extends readonly Extract<keyof z.infer<Schema>, string>[] = [],
>(collectionName: string, schema: Schema, embedKeys: Keys = [] as unknown as Keys) {
  type T = z.infer<Schema>;
  assertNodeSchemaShape(schema, embedKeys);
  const collection = () => db.collection(collectionName);

  return {
    collectionName,
    schema,
    embedKeys,
    async insert(input: Omit<z.input<Schema>, 'embedding'>): Promise<T> {
      const doc = schema.parse({ ...input, embedding: [] });
      const embedding = await computeEmbedding(collectionName, embedKeys, doc.key, doc as Record<string, unknown>);
      const result = await collection().save(toArangoDoc({ ...doc, embedding } as unknown as Record<string, unknown> & { key: string }), { returnNew: true });
      return schema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async getById(id: string): Promise<T | null> {
      try {
        const doc = await collection().document(id);
        return schema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (err) {
        if (isArangoNotFoundError(err)) return null;
        throw err;
      }
    },
    /**
     * Dynamically re-embeds only when the patch touches an embedKeys field: it
     * merges the patch onto the current document, rebuilds the slug, re-embeds,
     * and writes the new embedding alongside the other changed fields in the
     * same update. Patches that don't touch embedKeys skip re-embedding entirely.
     */
    async updateById(id: string, patch: Partial<Omit<z.input<Schema>, 'embedding' | 'key'>>): Promise<T> {
      const touchesEmbedKeys = embedKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
      let finalPatch: Record<string, unknown> = patch;
      if (touchesEmbedKeys) {
        const current = withArangoKey(await collection().document(id) as Record<string, unknown>);
        const merged = { ...current, ...patch };
        const embedding = await computeEmbedding(collectionName, embedKeys, id, merged);
        finalPatch = { ...patch, embedding };
      }
      const result = await collection().update(id, finalPatch, { returnNew: true, mergeObjects: true });
      return schema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async deleteById(id: string): Promise<void> {
      await collection().remove(id);
    },
    /** Insert-or-replace by key, for idempotent seed scripts and fixed-id upserts. */
    async upsertByKey(input: Omit<z.input<Schema>, 'embedding'>): Promise<T> {
      const doc = schema.parse({ ...input, embedding: [] });
      const embedding = await computeEmbedding(collectionName, embedKeys, doc.key, doc as Record<string, unknown>);
      const result = await collection().save(toArangoDoc({ ...doc, embedding } as unknown as Record<string, unknown> & { key: string }), { returnNew: true, overwriteMode: 'replace' });
      return schema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    /** Streams the entire collection in chunks of `chunkSize` (default 500) instead of loading it all into memory at once. */
    getAllChunked: createChunkedScanner<T>(collectionName, schema),
    /** One resumable page (default 50), for stateless HTTP pagination. See {@link Page}. */
    listPage: createPageReader<T>(collectionName, schema),
  };
}

export function createEdgeHelpers<
  Schema extends z.AnyZodObject,
  Keys extends readonly Extract<keyof z.infer<Schema>, string>[] = [],
>(collectionName: string, schema: Schema, embedKeys: Keys = [] as unknown as Keys) {
  type T = z.infer<Schema>;
  assertNodeSchemaShape(schema, embedKeys);
  const collection = () => db.collection(collectionName);

  return {
    collectionName,
    schema,
    embedKeys,
    async insert(input: Omit<z.input<Schema>, 'embedding'>): Promise<T> {
      const doc = schema.parse({ ...input, embedding: [] });
      const embedding = await computeEmbedding(collectionName, embedKeys, doc.key, doc as Record<string, unknown>);
      const result = await collection().save(toArangoDoc({ ...doc, embedding } as unknown as Record<string, unknown> & { key: string }), { returnNew: true });
      return schema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async getById(id: string): Promise<T | null> {
      try {
        const doc = await collection().document(id);
        return schema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (err) {
        if (isArangoNotFoundError(err)) return null;
        throw err;
      }
    },
    async updateById(id: string, patch: Partial<Omit<z.input<Schema>, 'embedding' | 'key'>>): Promise<T> {
      const touchesEmbedKeys = embedKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
      let finalPatch: Record<string, unknown> = patch;
      if (touchesEmbedKeys) {
        const current = withArangoKey(await collection().document(id) as Record<string, unknown>);
        const merged = { ...current, ...patch };
        const embedding = await computeEmbedding(collectionName, embedKeys, id, merged);
        finalPatch = { ...patch, embedding };
      }
      const result = await collection().update(id, finalPatch, { returnNew: true, mergeObjects: true });
      return schema.parse(withArangoKey(result.new as Record<string, unknown>));
    },
    async deleteById(id: string): Promise<void> {
      await collection().remove(id);
    },
    /** Streams the entire collection in chunks of `chunkSize` (default 500) instead of loading it all into memory at once. */
    getAllChunked: createChunkedScanner<T>(collectionName, schema),
    /** One resumable page (default 50), for stateless HTTP pagination. See {@link Page}. */
    listPage: createPageReader<T>(collectionName, schema),
  };
}
