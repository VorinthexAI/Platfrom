import { EventEmitter } from 'node:events';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { generateAlias } from '@/lib/alias';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import {
  insertVisitorSession,
  listOpenVisitorSessions,
  markVisitorSessionDisconnected,
} from '@/lib/db/visitor-sessions.node';
import {
  insertUserSession,
  listOpenUserSessions,
  markUserSessionDisconnected,
} from '@/lib/db/user-sessions.node';
import { getUserById } from '@/lib/db/users.node';
import {
  getVisitorByDistinctId,
  insertVisitor,
  updateVisitor,
  type Visitor,
} from '@/lib/db/visitors.node';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { getDefaultPlatformId, trackPlatformEvent } from '@/platform/events';
import { getUserId } from './security';
import { parseJson, strictObject } from './validation';

/**
 * Live presence: who is exploring the galaxy right now, and where.
 *
 * Redis is the live truth — one volatile key per session (TTL-refreshed
 * by heartbeats) plus a pub/sub channel every backend instance subscribes
 * to once and fans out to its SSE clients. ArangoDB is the durable
 * ledger the live state syncs into, split across two parallel funnels:
 * anonymous explorers get a `visitors` node plus a `visitorSessions`
 * sub-node per session, while signed-in users get a `userSessions` node
 * per session — both with connectedAt/disconnectedAt stamps. A sweeper
 * closes ledger sessions whose Redis key has expired (crashed tabs,
 * dropped networks) in both funnels, so the stores converge without any
 * per-heartbeat DB writes.
 */

const PRESENCE_CHANNEL = 'presence:events';
const SESSION_PREFIX = 'presence:s:';
/** Sessions survive this long without a heartbeat (client beats ~5s). */
const SESSION_TTL_SECONDS = 45;
const SWEEP_INTERVAL_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const PRESENCE_EVENT = 'presence-event';

const coordinate = z.number().finite().min(-5_000).max(5_000);
const positionSchema = z.tuple([coordinate, coordinate, coordinate]);
const presenceSourceSchema = z.enum(['web', 'mobile', 'desktop', 'tv']);
export type PresencePosition = z.infer<typeof positionSchema>;
export type PresenceSource = z.infer<typeof presenceSourceSchema>;

interface SessionRecord {
  /** funnel tag: authed user session vs anonymous visitor session */
  t: 'user' | 'visitor';
  /** identity key: the visitor key (anon) or user key (authed) */
  v: string;
  /** session ledger node key (visitorSessions or userSessions) */
  k: string;
  /** alias */
  a: string;
  /** client surface */
  s: PresenceSource;
  /** last published position */
  p: PresencePosition;
}

const presenceBus = new EventEmitter();
presenceBus.setMaxListeners(0);

let subscriberStarted = false;
/** One Redis SUBSCRIBE per process; local fan-out to every SSE client. */
function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  const subscriber = redisConnection.duplicate();
  subscriber.on('error', (error) => {
    console.warn('presence subscriber error', error instanceof Error ? error.message : String(error));
  });
  subscriber.subscribe(PRESENCE_CHANNEL).catch((error) => {
    console.warn('presence subscribe failed', error instanceof Error ? error.message : String(error));
    subscriberStarted = false;
  });
  subscriber.on('message', (_channel, message) => {
    presenceBus.emit(PRESENCE_EVENT, message);
  });
}

async function publishPresence(event: Record<string, unknown>) {
  try {
    await redisConnection.publish(PRESENCE_CHANNEL, JSON.stringify(event));
  } catch (error) {
    console.warn('presence publish failed', error instanceof Error ? error.message : String(error));
  }
}

export function buildPresenceEventData(input:
  | { presenceType: 'user'; source: PresenceSource; userId: string }
  | { presenceType: 'visitor'; source: PresenceSource; visitorId: string }
) {
  return input.presenceType === 'user'
    ? { presence_type: 'user', source: input.source, user_id: input.userId }
    : { presence_type: 'visitor', source: input.source, visitor_id: input.visitorId };
}

let sweeperStarted = false;
function ensureSweeper() {
  if (sweeperStarted) return;
  sweeperStarted = true;
  setInterval(() => {
    void sweepStaleSessions().catch((error) => {
      console.warn('presence sweep failed', error instanceof Error ? error.message : String(error));
    });
  }, SWEEP_INTERVAL_MS);
}

/**
 * Ledger ↔ live sync: close every open session node — in BOTH the visitor
 * and user funnels — whose Redis session key has expired. Idempotent —
 * safe to run on many instances.
 */
export async function sweepStaleSessions() {
  const now = new Date().toISOString();
  const [visitorSessions, userSessions] = await Promise.all([
    listOpenVisitorSessions(500),
    listOpenUserSessions(500),
  ]);
  await sweepOpenSessions(visitorSessions, markVisitorSessionDisconnected, now);
  await sweepOpenSessions(userSessions, markUserSessionDisconnected, now);
}

/**
 * Close the given open session nodes whose Redis key has expired, stamping
 * disconnectedAt via the funnel-specific mark function. Shared by both funnels.
 */
async function sweepOpenSessions(
  open: Array<{ key: string; sessionKey: string; userId?: string; visitorId?: string; source?: PresenceSource }>,
  markDisconnected: (key: string, disconnectedAt: string) => Promise<void>,
  now: string,
) {
  if (open.length === 0) return;
  const pipeline = redisConnection.pipeline();
  for (const session of open) pipeline.exists(SESSION_PREFIX + session.sessionKey);
  const results = await pipeline.exec();
  for (let index = 0; index < open.length; index += 1) {
    const alive = results?.[index]?.[1] === 1;
    if (alive) continue;
    const session = open[index]!;
    await markDisconnected(session.key, now);
    trackPlatformEvent({
      slug: 'presence.session_expired',
      userId: session.userId ?? null,
      data: session.userId
        ? buildPresenceEventData({ presenceType: 'user', source: session.source ?? 'web', userId: session.userId })
        : buildPresenceEventData({ presenceType: 'visitor', source: session.source ?? 'web', visitorId: session.visitorId ?? '' }),
    });
    await publishPresence({ type: 'leave', session: session.sessionKey, at: now });
  }
}

/**
 * Resolve the anonymous visitor node behind this request from the
 * distinct-id cookie alone — visitors are anonymous by definition now, so
 * there is no user/emailHash enrichment (authed joins skip this entirely
 * and land in the userSessions funnel). Creates the visitor on first sight,
 * bumps lastSeenAt after.
 */
async function resolvePresenceVisitor(distinctId: string | null): Promise<Visitor | null> {
  if (!distinctId) return null;
  const now = new Date().toISOString();

  const visitor = await getVisitorByDistinctId(distinctId);
  if (!visitor) {
    // Alias rolls off the distinct id so the same anonymous explorer keeps
    // the same "<Prefix> <Role>" pair (same 250×250 lists as signup) across
    // sessions.
    const alias = generateAlias(distinctId);
    try {
      return await insertVisitor({
        key: newId(),
        platformId: await getDefaultPlatformId(),
        distinctId,
        alias,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isArangoUniqueConstraintError(error)) throw error;
      // Raced a concurrent join for the same distinct id — adopt the winner.
      const winner = await getVisitorByDistinctId(distinctId);
      if (!winner) throw error;
      return winner;
    }
  }

  return updateVisitor(visitor.key, { lastSeenAt: now, updatedAt: now });
}

/** POST /presence/join — register a session, return its key + alias. */
export async function joinPresence(c: Context) {
  const body = await parseJson(c, strictObject({
    distinct_id: z.string().min(8).max(80).optional(),
    position: positionSchema.optional(),
    source: presenceSourceSchema.default('web'),
  }));

  const now = new Date().toISOString();
  const sessionKey = newId();
  const nodeKey = newId();
  const position: PresencePosition = body.position ?? [0, 6.5, 15.5];

  // Authenticated funnel: an access token skips visitor resolution entirely
  // and lands a fresh userSessions node, aliased off the user doc.
  const userId = await getUserId(c);
  if (userId) {
    const user = await getUserById(userId);
    if (user) {
      const alias = user.alias ?? generateAlias(user.key);
      const record: SessionRecord = { t: 'user', v: user.key, k: nodeKey, a: alias, s: body.source, p: position };
      // Redis first: the sweeper must never see the ledger node before its key.
      await redisConnection.set(SESSION_PREFIX + sessionKey, JSON.stringify(record), 'EX', SESSION_TTL_SECONDS);
      await insertUserSession({
        key: nodeKey,
        platformId: user.platformId,
        userId: user.key,
        alias,
        source: body.source,
        sessionKey,
        connectedAt: now,
        disconnectedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      trackPlatformEvent({
        slug: 'presence.session_joined',
        userId: user.key,
        data: buildPresenceEventData({ presenceType: 'user', source: body.source, userId: user.key }),
      });
      await publishPresence({ type: 'join', session: sessionKey, alias, position, at: now, t: 'user' });
      ensureSubscriber();
      ensureSweeper();
      return c.json({ ok: true, session_key: sessionKey, visitor_key: user.key, alias }, 201);
    }
    // Token resolved to a user that no longer exists — fall through to anon.
  }

  // Anonymous funnel: distinct-id visitor + a fresh visitorSessions node.
  const visitor = await resolvePresenceVisitor(body.distinct_id ?? null);
  if (!visitor) {
    return c.json({ error: 'distinct_id is required when no valid access token is provided' }, 400);
  }

  const record: SessionRecord = { t: 'visitor', v: visitor.key, k: nodeKey, a: visitor.alias, s: body.source, p: position };
  // Redis first: the sweeper must never see the ledger node before its key.
  await redisConnection.set(SESSION_PREFIX + sessionKey, JSON.stringify(record), 'EX', SESSION_TTL_SECONDS);
  await insertVisitorSession({
    key: nodeKey,
    platformId: visitor.platformId,
    visitorId: visitor.key,
    alias: visitor.alias,
    source: body.source,
    sessionKey,
    connectedAt: now,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  trackPlatformEvent({
    slug: 'presence.session_joined',
    data: buildPresenceEventData({ presenceType: 'visitor', source: body.source, visitorId: visitor.key }),
  });
  await publishPresence({ type: 'join', session: sessionKey, alias: visitor.alias, position, at: now, t: 'visitor' });
  ensureSubscriber();
  ensureSweeper();

  return c.json({ ok: true, session_key: sessionKey, visitor_key: visitor.key, alias: visitor.alias }, 201);
}

/** POST /presence/beat — heartbeat + position; refreshes the session TTL. */
export async function presenceBeat(c: Context) {
  const body = await parseJson(c, strictObject({
    session_key: z.string().min(8).max(80),
    position: positionSchema,
    source: presenceSourceSchema.default('web'),
  }));
  const key = SESSION_PREFIX + body.session_key;
  const raw = await redisConnection.get(key);
  if (!raw) {
    // Expired or unknown — the client should re-join.
    return c.json({ ok: false, error: 'unknown or expired session' }, 410);
  }
  let record: SessionRecord;
  try {
    record = JSON.parse(raw) as SessionRecord;
  } catch {
    return c.json({ ok: false, error: 'corrupt session' }, 410);
  }
  record.p = body.position;
  await redisConnection.set(key, JSON.stringify(record), 'EX', SESSION_TTL_SECONDS);
  await publishPresence({ type: 'move', session: body.session_key, position: body.position, at: new Date().toISOString() });
  return c.json({ ok: true });
}

/** POST /presence/leave — explicit goodbye; stamps disconnectedAt. */
export async function leavePresence(c: Context) {
  const body = await parseJson(c, strictObject({
    session_key: z.string().min(8).max(80),
    source: presenceSourceSchema.default('web'),
  }));
  const key = SESSION_PREFIX + body.session_key;
  const now = new Date().toISOString();
  const raw = await redisConnection.get(key);
  if (raw) {
    await redisConnection.del(key);
    try {
      const record = JSON.parse(raw) as SessionRecord;
      // Route the disconnect stamp to the funnel this session belongs to;
      // legacy records without a tag default to the visitor funnel and the
      // sweeper reconciles anything that lands in the wrong collection.
      if (record.t === 'user') await markUserSessionDisconnected(record.k, now);
      else await markVisitorSessionDisconnected(record.k, now);
      trackPlatformEvent({
        slug: 'presence.session_left',
        userId: record.t === 'user' ? record.v : null,
        data: record.t === 'user'
          ? buildPresenceEventData({ presenceType: 'user', source: record.s ?? body.source, userId: record.v })
          : buildPresenceEventData({ presenceType: 'visitor', source: record.s ?? body.source, visitorId: record.v }),
      });
    } catch {
      // Corrupt record — the sweeper reconciles the ledger.
    }
  }
  await publishPresence({ type: 'leave', session: body.session_key, at: now });
  return c.json({ ok: true });
}

/** Everything alive right now, straight from Redis. */
async function readRoster() {
  const roster: Array<{ session: string; alias: string; position: PresencePosition }> = [];
  let cursor = '0';
  do {
    const [next, keys] = await redisConnection.scan(cursor, 'MATCH', `${SESSION_PREFIX}*`, 'COUNT', 200);
    cursor = next;
    if (keys.length === 0) continue;
    const values = await redisConnection.mget(keys);
    keys.forEach((key, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        const record = JSON.parse(raw) as SessionRecord;
        roster.push({ session: key.slice(SESSION_PREFIX.length), alias: record.a, position: record.p });
      } catch {
        // Skip corrupt entries.
      }
    });
  } while (cursor !== '0');
  return roster;
}

/**
 * GET /presence/stream — SSE: a `roster` snapshot on connect, then every
 * join/move/leave relayed from the Redis channel as `presence` events.
 */
export async function streamPresence(c: Context) {
  ensureSubscriber();
  ensureSweeper();
  return streamSSE(c, async (stream) => {
    let eventId = 0;
    const onEvent = (payload: string) => {
      eventId += 1;
      void stream.writeSSE({ event: 'presence', data: payload, id: String(eventId) }).catch(() => {});
    };
    presenceBus.on(PRESENCE_EVENT, onEvent);
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    const closed = new Promise<void>((resolve) => {
      stream.onAbort(() => resolve());
    });

    try {
      const roster = await readRoster();
      await stream.writeSSE({ event: 'roster', data: JSON.stringify(roster), id: '0' });
      await closed;
    } finally {
      clearInterval(heartbeat);
      presenceBus.off(PRESENCE_EVENT, onEvent);
    }
  });
}
