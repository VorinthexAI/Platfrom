import { collections, migrateContentDocuments, migrateContentVersions } from '../src/db/arango-migrate';
import { buildEmbeddingText } from '../src/lib/db/base';
import { db } from '../src/lib/db/client';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER_ID, embedText, embeddingMetadata } from '../src/lib/embeddings';

const BATCH_SIZE = 25;
const MAX_CATCHUP_PASSES = 5;

// These are the existing semantic collections intentionally approved for external embedding.
export const SEMANTIC_COLLECTION_ALLOWLIST = [
  'actions', 'providers', 'models', 'users', 'minds', 'orchestrators', 'voices', 'agents', 'skills', 'capabilities',
  'organizations', 'scopes', 'channels', 'threads', 'messages', 'messageReactions', 'polls', 'pollOptions', 'folders',
  'documents', 'documentVersions', 'projects', 'milestones', 'tasks',
] as const;

type SemanticSpec = { name: string; embedKeys: string[]; includeMetadata: boolean };
const authoritative = new Map(collections.map((spec) => [spec.name, spec]));
const semanticCollections: SemanticSpec[] = SEMANTIC_COLLECTION_ALLOWLIST.filter((name) => name !== 'documents' && name !== 'documentVersions').map((name) => {
  const spec = authoritative.get(name);
  if (!spec || spec.skipEmbedding || !spec.embedKeys?.length) throw new Error(`Semantic allowlist entry ${name} is not an embedding collection in authoritative specs.`);
  return { name, embedKeys: [...spec.embedKeys], includeMetadata: !['folders', 'documents', 'documentVersions'].includes(name) };
});
semanticCollections.push({ name: 'agentMemories', embedKeys: ['content'], includeMetadata: true });

await migrateContentDocuments(db);
await migrateContentVersions(db);

function inclusionFilter(name: string): string {
  const active = 'FILTER !HAS(doc, "_internalDeletion") || doc._internalDeletion == null';
  // Recoverable Content documents and versions deliberately remain eligible for includeArchived retrieval.
  if (name === 'documents' || name === 'documentVersions') return active;
  return `${active}\nFILTER !HAS(doc, "deletedAt") || doc.deletedAt == null`;
}

function sourcePresentFilter(): string {
  return 'LENGTH(@embedKeys[* FILTER doc[CURRENT] != null && LENGTH(TRIM(TO_STRING(doc[CURRENT]))) > 0]) > 0';
}

function staleFilter(spec: SemanticSpec): string {
  if (!spec.includeMetadata) return `FILTER !IS_ARRAY(doc.embedding) || LENGTH(doc.embedding) != @dimensions || LENGTH(doc.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0 || HAS(doc, "embeddingProvider") || HAS(doc, "embeddingModel") || HAS(doc, "embeddingDimensions") || HAS(doc, "embeddingState") || HAS(doc, "embeddedAt")`;
  return `FILTER doc.embeddingState != "skipped_empty" || ${sourcePresentFilter()}
    FILTER doc.embeddingProvider != @provider || doc.embeddingModel != @model || doc.embeddingDimensions != @dimensions
      || !IS_ARRAY(doc.embedding) || LENGTH(doc.embedding) != @dimensions
      || LENGTH(doc.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0`;
}

function staleBindVars(spec: SemanticSpec, values: Record<string, unknown>): Record<string, unknown> {
  return spec.includeMetadata ? { ...values, provider: EMBEDDING_PROVIDER_ID, model: EMBEDDING_MODEL } : values;
}

async function staleCount(spec: SemanticSpec): Promise<number> {
  const cursor = await db.query<number>(`
    RETURN LENGTH(FOR doc IN @@collection
      ${inclusionFilter(spec.name)}
      ${staleFilter(spec)}
      RETURN 1)
  `, staleBindVars(spec, { '@collection': spec.name, dimensions: EMBEDDING_DIMENSIONS, ...(spec.includeMetadata ? { embedKeys: spec.embedKeys } : {}) }));
  return await cursor.next() ?? 0;
}

for (const spec of semanticCollections) {
  if (!await db.collection(spec.name).exists()) throw new Error(`Semantic collection ${spec.name} does not exist; run migrations before backfill.`);
  let updated = 0;
  let skippedEmpty = 0;
  let complete = false;

  for (let pass = 1; pass <= MAX_CATCHUP_PASSES; pass += 1) {
    let after = '';
    while (true) {
      const cursor = await db.query<{ _key: string; _rev: string; source: Record<string, unknown> }>(`
        FOR doc IN @@collection
          FILTER doc._key > @after
          ${inclusionFilter(spec.name)}
          ${staleFilter(spec)}
          SORT doc._key ASC
          LIMIT @limit
          RETURN { _key: doc._key, _rev: doc._rev, source: KEEP(doc, @embedKeys) }
      `, staleBindVars(spec, { '@collection': spec.name, after, limit: BATCH_SIZE, embedKeys: spec.embedKeys, dimensions: EMBEDDING_DIMENSIONS }));
      const rows = await cursor.all();
      if (rows.length === 0) break;

      for (const row of rows) {
        const text = buildEmbeddingText(spec.embedKeys, row.source);
        if (!text) {
          const write = await db.query<string>(`
            FOR doc IN @@collection
              FILTER doc._key == @key && doc._rev == @revision
              FILTER LENGTH(@embedKeys[* FILTER doc[CURRENT] != @source[CURRENT]]) == 0
              UPDATE doc WITH { embedding: [], embeddingState: "skipped_empty", embeddingProvider: null, embeddingModel: null, embeddingDimensions: null } IN @@collection OPTIONS { keepNull: false }
              RETURN NEW._key
          `, { '@collection': spec.name, key: row._key, revision: row._rev, embedKeys: spec.embedKeys, source: row.source });
          if (await write.next()) skippedEmpty += 1;
        } else {
          const embedding = await embedText({ text, purpose: 'document' });
          const write = await db.query<string>(`
            FOR doc IN @@collection
              FILTER doc._key == @key && doc._rev == @revision
              FILTER LENGTH(@embedKeys[* FILTER doc[CURRENT] != @source[CURRENT]]) == 0
              UPDATE doc WITH MERGE(@metadata, { embedding: @embedding, embeddingState: @includeMetadata && HAS(doc, "embeddingState") ? "ready" : null, embeddedAt: @includeMetadata && HAS(doc, "embeddedAt") ? @now : null, embeddingProvider: @includeMetadata ? @metadata.embeddingProvider : null, embeddingModel: @includeMetadata ? @metadata.embeddingModel : null, embeddingDimensions: @includeMetadata ? @metadata.embeddingDimensions : null }) IN @@collection OPTIONS { keepNull: false }
              RETURN NEW._key
          `, { '@collection': spec.name, key: row._key, revision: row._rev, embedKeys: spec.embedKeys, source: row.source, embedding, metadata: embeddingMetadata(), includeMetadata: spec.includeMetadata, now: new Date().toISOString() });
          if (await write.next()) updated += 1;
        }
        after = row._key;
      }
    }

    const remaining = await staleCount(spec);
    console.log(`${spec.name}: pass=${pass}, updated=${updated}, skippedEmpty=${skippedEmpty}, stale=${remaining}`);
    if (remaining === 0) { complete = true; break; }
  }

  if (!complete) throw new Error(`${spec.name} still has eligible stale semantic rows after ${MAX_CATCHUP_PASSES} catch-up passes; concurrent writes must settle before rerun.`);
}

console.log('Semantic embedding backfill complete with final stale verification.');
