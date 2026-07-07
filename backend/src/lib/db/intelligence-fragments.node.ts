import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const INTELLIGENCE_FRAGMENTS_COLLECTION = 'intelligenceFragments';

/**
 * Deterministic recipe for the exact 3D mesh a collectible was rendered with.
 * The frontend regenerates the identical geometry from generator + seed +
 * params, so storing the recipe preserves the exact mesh without persisting
 * megabytes of vertex data.
 */
export const fragmentMeshSchema = z.object({
  generator: z.string().min(1).max(60),
  seed: z.number().int(),
  variant: z.number().int().optional(),
  scale: z.number().optional(),
  params: z.record(z.string().max(40), z.union([z.number(), z.string().max(60)])).optional(),
});

export type FragmentMesh = z.infer<typeof fragmentMeshSchema>;

export const intelligenceFragmentSchema = z.object({
  key: z.string(),
  /** Null until the anonymous explorer joins the waitlist and the entry is adopted. */
  userId: z.string().nullable().default(null),
  /** The anonymous vx_explorer cookie id assigned by the landing page. */
  explorerId: z.string(),
  collectibleId: z.string(),
  name: z.string(),
  rarity: z.string(),
  fragments: z.number().int().min(1),
  /** Exact 3D mesh recipe captured at collection time (null for legacy entries). */
  mesh: fragmentMeshSchema.nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type IntelligenceFragment = z.infer<typeof intelligenceFragmentSchema>;

// Collectible identity text only: ids, counts, and timestamps belong in AQL
// filters, not semantic search text.
export const intelligenceFragmentsEmbedKeys = z.enum(['collectibleId', 'rarity']);

const helpers = createNodeHelpers(INTELLIGENCE_FRAGMENTS_COLLECTION, intelligenceFragmentSchema, intelligenceFragmentsEmbedKeys.options);

export const insertIntelligenceFragment = helpers.insert;
export const getIntelligenceFragmentById = helpers.getById;
export const updateIntelligenceFragment = helpers.updateById;
export const deleteIntelligenceFragment = helpers.deleteById;
export const upsertIntelligenceFragmentByKey = helpers.upsertByKey;
export const getAllIntelligenceFragmentsChunked = helpers.getAllChunked;
export const listIntelligenceFragmentsPage = helpers.listPage;

export async function listFragmentsByUser(userId: string): Promise<IntelligenceFragment[]> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      FILTER f.userId == ${userId}
      RETURN f
  `);
  const docs = await cursor.all();
  return docs.map((doc) => intelligenceFragmentSchema.parse(withArangoKey(doc)));
}

export async function listFragmentsByExplorer(explorerId: string): Promise<IntelligenceFragment[]> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      FILTER f.explorerId == ${explorerId}
      RETURN f
  `);
  const docs = await cursor.all();
  return docs.map((doc) => intelligenceFragmentSchema.parse(withArangoKey(doc)));
}

export async function countFragmentEntries(): Promise<number> {
  const cursor = await db.query(aql`
    RETURN LENGTH(${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)})
  `);
  const count = await cursor.next();
  return typeof count === 'number' ? count : 0;
}

export async function sumFragmentsTotal(): Promise<number> {
  const cursor = await db.query(aql`
    RETURN SUM(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        RETURN f.fragments
    )
  `);
  const total = await cursor.next();
  return typeof total === 'number' ? total : 0;
}

/**
 * Claims every not-yet-adopted entry collected under an anonymous explorer id
 * for a real user. Returns how many entries were adopted.
 */
export async function adoptExplorerFragments(explorerId: string, userId: string): Promise<number> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      FILTER f.explorerId == ${explorerId} && f.userId == null
      UPDATE f WITH { userId: ${userId} } IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      COLLECT WITH COUNT INTO adopted
      RETURN adopted
  `);
  const adopted = await cursor.next();
  return typeof adopted === 'number' ? adopted : 0;
}
