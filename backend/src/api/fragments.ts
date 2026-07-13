import type { Context } from 'hono';
import { z } from 'zod';
import {
  adoptExplorerFragments,
  countFragmentEntries,
  getExplorerStanding,
  getUserStanding,
  insertIntelligenceFragment,
  listFragmentsByExplorer,
  listFragmentsByUser,
  sumFragmentsTotal,
  type IntelligenceFragment,
} from '@/lib/db/intelligence-fragments.node';
import { getUserByEmailHash } from '@/lib/db/users.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import { formatNodesForThree } from '@/lib/three-format';
import { newId } from '@/lib/ids';
import { trackPlatformEvent } from '@/platform/events';
import { trackUserPlaceChange } from '@/platform/leaderboard-digest';
import { getUserId } from './security';
import { notifyCountersDirty } from './live-bus';
import { parseJson, parseQuery, strictObject } from './validation';

const emailHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const tempEmailHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

// The collectible values come from the landing page registry — this is a
// marketing collectible, not money, so bounded validation is all we need.
const meshBodySchema = strictObject({
  generator: z.string().min(1).max(60),
  seed: z.number().int(),
  variant: z.number().int().optional(),
  scale: z.number().optional(),
  params: z.record(z.string().max(40), z.union([z.number(), z.string().max(60)])).optional(),
});

export const postFragmentsBodySchema = strictObject({
  collectible_id: z.string().min(1).max(120),
  explorer_id: z.string().min(8).max(80),
  name: z.string().min(1).max(120),
  rarity: z.string().min(1).max(40),
  fragments: z.number().int().min(1).max(1_000_000),
  mesh: meshBodySchema.optional(),
  email_hash: emailHashSchema.optional(),
  temp_email_hash: tempEmailHashSchema.optional(),
});

export const fragmentsSummaryQuerySchema = strictObject({
  explorer_id: z.string().min(8).max(80).optional(),
  format: z.literal('three').optional(),
});

export const fragmentsStandingQuerySchema = strictObject({
  explorer_id: z.string().min(8).max(80).optional(),
});

/** Dedupes merged explorer + user entries by key (an adopted entry matches both lookups). */
export function dedupeFragmentEntries<T extends Pick<IntelligenceFragment, 'key'>>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  });
}

/** Reduces deduped entries to a fragment balance and the collected collectible ids. */
export function summarizeFragmentEntries(entries: Array<Pick<IntelligenceFragment, 'key' | 'collectibleId' | 'fragments'>>) {
  const collected = new Set<string>();
  let balance = 0;
  for (const entry of dedupeFragmentEntries(entries)) {
    balance += entry.fragments;
    collected.add(entry.collectibleId);
  }
  return { balance, collected: [...collected] };
}

export async function collectFragment(c: Context) {
  const body = await parseJson(c, postFragmentsBodySchema);

  let userId = await getUserId(c);
  if (!userId && body.email_hash) {
    const user = await getUserByEmailHash(body.email_hash);
    userId = user?.key ?? null;
  }

  let entry;
  try {
    entry = await insertIntelligenceFragment({
      key: newId(),
      userId,
      explorerId: body.explorer_id,
      collectibleId: body.collectible_id,
      name: body.name,
      rarity: body.rarity,
      fragments: body.fragments,
      mesh: body.mesh ?? null,
      // Where this piece will mount in the leaderboard asteroid — rolled
      // once at collection so every surface renders it in the same spot.
      placementSeed: Math.floor(Math.random() * 0x7fffffff),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // The (explorerId, collectibleId) unique index is the duplicate gate.
    if (isArangoUniqueConstraintError(err)) {
      return c.json({ error: 'collectible already collected by this explorer' }, 409);
    }
    throw err;
  }

  // A collect can move the collector on the waitlist leaderboard; the
  // movement ledger feeds the daily digest email.
  if (userId) trackUserPlaceChange(userId);

  trackPlatformEvent({
    slug: 'fragments.collected',
    userId,
    data: {
      entry_key: entry.key,
      explorer_id: entry.explorerId,
      collectible_id: entry.collectibleId,
      rarity: entry.rarity,
      fragments: entry.fragments,
      ...(body.temp_email_hash ? { temp_email_hash: body.temp_email_hash } : {}),
    },
  });
  notifyCountersDirty();

  return c.json({
    ok: true,
    entry_key: entry.key,
    total_fragments: await sumFragmentsTotal(),
  }, 201);
}

/**
 * The single authoritative "standing" for a caller: total fragments and
 * 1-based leaderboard rank. For a signed-in user, total + rank come from the
 * SAME COLLECT/SUM query family as `listTopCollectors` (the board), so the
 * in-list "You" row and the standing card can never structurally disagree.
 * A signed-in caller with an explorer cookie first adopts any fragments still
 * stranded on the anonymous id (collected while the session was expired, or
 * missed by an interrupted sign-in) so their board seat reflects the full
 * haul. An anonymous explorer gets their device haul ranked against the same
 * board — a real place, never a number the UI has to invent.
 */
export async function getFragmentsStanding(c: Context) {
  const query = parseQuery(c, fragmentsStandingQuerySchema);
  const userId = await getUserId(c);

  if (userId) {
    // Heal before ranking: fragments collected under this device's anonymous
    // id while signed out would otherwise stay off the board forever.
    if (query.explorer_id) {
      const adopted = await adoptExplorerFragments(query.explorer_id, userId);
      if (adopted > 0) {
        trackUserPlaceChange(userId);
        notifyCountersDirty();
      }
    }
    const standing = await getUserStanding(userId);
    if (standing) {
      return c.json({
        user_id: userId,
        total: standing.total,
        rank: standing.rank,
        entries: standing.entries,
        adopted: true,
      });
    }
    // Signed in but nothing adopted yet — fall through to the device haul so
    // a just-joined explorer still sees the fragments they collected.
  }

  if (query.explorer_id) {
    const standing = await getExplorerStanding(query.explorer_id);
    return c.json({
      user_id: userId,
      total: standing.total,
      rank: standing.rank,
      entries: standing.entries,
      adopted: false,
    });
  }

  return c.json({ user_id: userId, total: 0, rank: null, entries: 0, adopted: false });
}

export async function getFragmentsSummary(c: Context) {
  const query = parseQuery(c, fragmentsSummaryQuerySchema);
  const userId = await getUserId(c);

  const [globalTotal, globalEntries] = await Promise.all([
    sumFragmentsTotal(),
    countFragmentEntries(),
  ]);

  const merged: IntelligenceFragment[] = [];
  if (query.explorer_id) merged.push(...await listFragmentsByExplorer(query.explorer_id));
  if (userId) merged.push(...await listFragmentsByUser(userId));
  const entries = dedupeFragmentEntries(merged);

  const explorer = query.explorer_id || userId ? summarizeFragmentEntries(entries) : null;

  return c.json({
    global_total: globalTotal,
    global_entries: globalEntries,
    explorer,
    ...(query.format === 'three' ? { three: formatNodesForThree(entries) } : {}),
  });
}
