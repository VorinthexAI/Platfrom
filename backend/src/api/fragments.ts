import type { Context } from 'hono';
import { z } from 'zod';
import {
  countFragmentEntries,
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
  fragments: z.number().int().min(1).max(100000),
  mesh: meshBodySchema.optional(),
  email_hash: emailHashSchema.optional(),
  temp_email_hash: tempEmailHashSchema.optional(),
});

export const fragmentsSummaryQuerySchema = strictObject({
  explorer_id: z.string().min(8).max(80).optional(),
  format: z.literal('three').optional(),
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

/** Reduces deduped entries to a fragment balance and the claimed collectible ids. */
export function summarizeFragmentEntries(entries: Array<Pick<IntelligenceFragment, 'key' | 'collectibleId' | 'fragments'>>) {
  const claimed = new Set<string>();
  let balance = 0;
  for (const entry of dedupeFragmentEntries(entries)) {
    balance += entry.fragments;
    claimed.add(entry.collectibleId);
  }
  return { balance, claimed: [...claimed] };
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
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    // The (explorerId, collectibleId) unique index is the duplicate gate.
    if (isArangoUniqueConstraintError(err)) {
      return c.json({ error: 'collectible already claimed by this explorer' }, 409);
    }
    throw err;
  }

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
