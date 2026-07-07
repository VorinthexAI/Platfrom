import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { countOpenActiveVisitors } from '@/lib/db/active-visitors.node';
import {
  countFragmentEntries,
  listRecentFragmentEntries,
  listTopCollectors,
  sumFragmentsTotal,
} from '@/lib/db/intelligence-fragments.node';
import { COUNTERS_DIRTY_EVENT, liveBus } from './live-bus';

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
/** A few extra rows beyond the visible 10 so the client can drop itself. */
const TOP_LIMIT = 14;
/** Enough recent pieces to dress the whole crystal cave. */
const RECENT_LIMIT = 250;

export interface LeaderboardPayload {
  top: Array<{ user_id: string; alias: string | null; total: number }>;
  fragments_total: number;
  fragments_entries: number;
  active_explorers: number;
  recent: Array<{
    key: string;
    fragments: number;
    rarity: string;
    mesh: Record<string, unknown> | null;
    placement_seed: number | null;
    created_at: string;
    alias: string | null;
  }>;
}

export async function readLeaderboard(): Promise<LeaderboardPayload> {
  const [top, fragmentsTotal, fragmentsEntries, activeExplorers, recent] = await Promise.all([
    listTopCollectors(TOP_LIMIT),
    sumFragmentsTotal(),
    countFragmentEntries(),
    countOpenActiveVisitors(),
    listRecentFragmentEntries(RECENT_LIMIT),
  ]);
  return {
    top: top.map((row) => ({ user_id: row.userId, alias: row.alias, total: row.total })),
    fragments_total: fragmentsTotal,
    fragments_entries: fragmentsEntries,
    active_explorers: activeExplorers,
    recent: recent.map((entry) => ({
      key: entry.key,
      fragments: entry.fragments,
      rarity: entry.rarity,
      mesh: entry.mesh,
      placement_seed: entry.placementSeed,
      created_at: entry.createdAt,
      alias: entry.alias,
    })),
  };
}

/**
 * GET /leaderboard/stream — SSE feed of the galaxy leaderboard: top
 * collectors, global totals, active explorer count, and the latest
 * collected pieces (mesh recipes + placement seeds) that dress the
 * leaderboard asteroid's crystal cave. Emits on connect, then re-emits
 * when values change: every poll tick and instantly whenever a fragment
 * collect nudges the live bus. Users and their fragments nodes are the
 * only source of truth — there is no leaderboard collection.
 */
export async function streamLeaderboard(c: Context) {
  return streamSSE(c, async (stream) => {
    let lastPayload: string | null = null;
    let eventId = 0;
    let chain: Promise<void> = Promise.resolve();

    const send = (force: boolean) => {
      chain = chain.then(async () => {
        const payload = JSON.stringify(await readLeaderboard());
        if (!force && payload === lastPayload) return;
        lastPayload = payload;
        eventId += 1;
        await stream.writeSSE({ event: 'leaderboard', data: payload, id: String(eventId) });
      }).catch((error) => {
        console.warn('leaderboard emit failed', error instanceof Error ? error.message : String(error));
      });
      return chain;
    };

    const onDirty = () => { void send(false); };
    liveBus.on(COUNTERS_DIRTY_EVENT, onDirty);
    const poll = setInterval(() => { void send(false); }, POLL_INTERVAL_MS);
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });

    try {
      await send(true);
      await closed;
    } finally {
      clearInterval(poll);
      clearInterval(heartbeat);
      liveBus.off(COUNTERS_DIRTY_EVENT, onDirty);
    }
  });
}
