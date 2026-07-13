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
  /**
   * Random seed rolled at collection time that decides where this piece
   * mounts on the leaderboard-asteroid's walls. Null for legacy entries
   * (renderers fall back to hashing the key).
   */
  placementSeed: z.number().int().nullable().default(null),
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

export interface LeaderboardRow {
  userId: string;
  alias: string | null;
  total: number;
}

/**
 * Top collectors, straight off the fragments ledger (userId index) joined
 * to their user node for the alias — users and their fragments stay the
 * single source of truth; there is deliberately no leaderboard node.
 */
export async function listTopCollectors(limit: number): Promise<LeaderboardRow[]> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      FILTER f.userId != null
      COLLECT userId = f.userId AGGREGATE total = SUM(f.fragments)
      SORT total DESC
      LIMIT ${limit}
      LET user = DOCUMENT('users', userId)
      RETURN { userId, alias: user != null ? user.alias : null, total }
  `);
  const rows = await cursor.all();
  return rows.map((row) => ({
    userId: String(row.userId),
    alias: typeof row.alias === 'string' ? row.alias : null,
    total: typeof row.total === 'number' ? row.total : 0,
  }));
}

/**
 * Every collector ranked by total fragments, best first. Bounded by the
 * user count; the (userId) index carries the aggregation.
 */
export async function listRankedCollectors(): Promise<Array<{ userId: string; total: number }>> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      FILTER f.userId != null
      COLLECT userId = f.userId AGGREGATE total = SUM(f.fragments)
      SORT total DESC
      RETURN { userId, total }
  `);
  const rows = await cursor.all();
  return rows.map((row) => ({
    userId: String(row.userId),
    total: typeof row.total === 'number' ? row.total : 0,
  }));
}

/**
 * A single user's fragment total and 1-based leaderboard place (everyone
 * with a strictly higher total, plus one). Null when they have no entries.
 */
export async function getUserFragmentPlace(
  userId: string,
): Promise<{ total: number; place: number } | null> {
  const cursor = await db.query(aql`
    LET mine = SUM(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId == ${userId}
        RETURN f.fragments
    )
    LET entries = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId == ${userId}
        LIMIT 1
        RETURN 1
    )
    LET ahead = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId != null
        COLLECT other = f.userId AGGREGATE total = SUM(f.fragments)
        FILTER total > mine
        RETURN 1
    )
    RETURN { mine, entries, ahead }
  `);
  const row = await cursor.next();
  if (!row || row.entries === 0) return null;
  return {
    total: typeof row.mine === 'number' ? row.mine : 0,
    place: (typeof row.ahead === 'number' ? row.ahead : 0) + 1,
  };
}

/**
 * A signed-in user's authoritative standing: total fragments, 1-based rank,
 * and entry count — all from the SAME COLLECT/SUM family as
 * `listTopCollectors`, so the board and the "you" card can never structurally
 * disagree. Null when the user has adopted no entries yet.
 */
export async function getUserStanding(
  userId: string,
): Promise<{ total: number; rank: number; entries: number } | null> {
  const cursor = await db.query(aql`
    LET mine = SUM(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId == ${userId}
        RETURN f.fragments
    )
    LET entries = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId == ${userId}
        RETURN 1
    )
    LET ahead = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId != null
        COLLECT other = f.userId AGGREGATE total = SUM(f.fragments)
        FILTER total > mine
        RETURN 1
    )
    RETURN { mine, entries, ahead }
  `);
  const row = await cursor.next();
  if (!row || row.entries === 0) return null;
  return {
    total: typeof row.mine === 'number' ? row.mine : 0,
    rank: (typeof row.ahead === 'number' ? row.ahead : 0) + 1,
    entries: typeof row.entries === 'number' ? row.entries : 0,
  };
}

/**
 * An anonymous explorer's standing: the device's haul plus the 1-based place
 * that haul earns against the adopted board (everyone with a strictly higher
 * total, plus one) — the same rank rule as `getUserStanding`, so the "you"
 * card never has to invent a place. Rank is null only when the explorer has
 * collected nothing.
 */
export async function getExplorerStanding(
  explorerId: string,
): Promise<{ total: number; entries: number; rank: number | null }> {
  const cursor = await db.query(aql`
    LET mine = SUM(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.explorerId == ${explorerId}
        RETURN f.fragments
    )
    LET entries = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.explorerId == ${explorerId}
        RETURN 1
    )
    LET ahead = LENGTH(
      FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
        FILTER f.userId != null
        COLLECT other = f.userId AGGREGATE total = SUM(f.fragments)
        FILTER total > mine
        RETURN 1
    )
    RETURN { mine, entries, ahead }
  `);
  const row = await cursor.next();
  const entries = row && typeof row.entries === 'number' ? row.entries : 0;
  return {
    total: row && typeof row.mine === 'number' ? row.mine : 0,
    entries,
    rank: entries > 0 ? (row && typeof row.ahead === 'number' ? row.ahead : 0) + 1 : null,
  };
}

export interface RecentFragmentEntry {
  key: string;
  fragments: number;
  rarity: string;
  mesh: FragmentMesh | null;
  placementSeed: number | null;
  createdAt: string;
  alias: string | null;
}

/** Latest collected pieces (createdAt index) with the collector's alias. */
export async function listRecentFragmentEntries(limit: number): Promise<RecentFragmentEntry[]> {
  const cursor = await db.query(aql`
    FOR f IN ${db.collection(INTELLIGENCE_FRAGMENTS_COLLECTION)}
      SORT f.createdAt DESC
      LIMIT ${limit}
      LET user = f.userId != null ? DOCUMENT('users', f.userId) : null
      RETURN {
        key: f._key,
        fragments: f.fragments,
        rarity: f.rarity,
        mesh: f.mesh,
        placementSeed: f.placementSeed,
        createdAt: f.createdAt,
        alias: user != null ? user.alias : null,
      }
  `);
  const rows = await cursor.all();
  return rows.map((row) => ({
    key: String(row.key),
    fragments: typeof row.fragments === 'number' ? row.fragments : 0,
    rarity: typeof row.rarity === 'string' ? row.rarity : 'common',
    mesh: row.mesh ? fragmentMeshSchema.parse(row.mesh) : null,
    placementSeed: typeof row.placementSeed === 'number' ? row.placementSeed : null,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : new Date(0).toISOString(),
    alias: typeof row.alias === 'string' ? row.alias : null,
  }));
}

/**
 * Collects every not-yet-adopted entry collected under an anonymous explorer id
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
