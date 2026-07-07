import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { countUsers, countVerifiedUsers } from '@/lib/db/users.node';
import { countFragmentEntries, sumFragmentsTotal } from '@/lib/db/intelligence-fragments.node';
import { COUNTERS_DIRTY_EVENT, liveBus } from './live-bus';

const POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

export interface LiveCounters {
  waitlist_count: number;
  waitlist_verified_count: number;
  fragments_total: number;
  fragments_entries: number;
}

export async function readLiveCounters(): Promise<LiveCounters> {
  const [waitlistCount, waitlistVerifiedCount, fragmentsTotal, fragmentsEntries] = await Promise.all([
    countUsers(),
    countVerifiedUsers(),
    sumFragmentsTotal(),
    countFragmentEntries(),
  ]);
  return {
    waitlist_count: waitlistCount,
    waitlist_verified_count: waitlistVerifiedCount,
    fragments_total: fragmentsTotal,
    fragments_entries: fragmentsEntries,
  };
}

/**
 * GET /live/stream — SSE feed of the public counters. Emits a `counters`
 * event immediately on connect, then re-emits only when values change: every
 * poll tick (5s) and instantly whenever a write path fires the live bus.
 * A comment heartbeat every 25s keeps proxies from closing the connection.
 * Stays behind the env API key middleware; the web app proxies it server-side.
 */
export async function streamLiveCounters(c: Context) {
  return streamSSE(c, async (stream) => {
    let lastPayload: string | null = null;
    let eventId = 0;
    // Serialize sends so a bus nudge and a poll tick never interleave writes.
    let chain: Promise<void> = Promise.resolve();

    const send = (force: boolean) => {
      chain = chain.then(async () => {
        const payload = JSON.stringify(await readLiveCounters());
        if (!force && payload === lastPayload) return;
        lastPayload = payload;
        eventId += 1;
        await stream.writeSSE({ event: 'counters', data: payload, id: String(eventId) });
      }).catch((error) => {
        console.warn('live counters emit failed', error instanceof Error ? error.message : String(error));
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
