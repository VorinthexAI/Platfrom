import { EventEmitter } from 'node:events';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { generateAlias } from '@/lib/alias';
import { isArangoUniqueConstraintError } from '@/lib/db/base';
import {
  insertActiveVisitor,
  listOpenActiveVisitors,
  markActiveVisitorDisconnected,
} from '@/lib/db/active-visitors.node';
import { getUserById } from '@/lib/db/users.node';
import {
  getVisitorByDistinctId,
  getVisitorByEmailHash,
  insertVisitor,
  updateVisitor,
  type Visitor,
} from '@/lib/db/visitors.node';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { getDefaultPlatformId } from '@/platform/events';
import { getUserId } from './security';
import { parseJson, strictObject } from './validation';

/**
 * Live presence: who is exploring the galaxy right now, and where.
 *
 * Redis is the live truth — one volatile key per session (TTL-refreshed
 * by heartbeats) plus a pub/sub channel every backend instance subscribes
 * to once and fans out to its SSE clients. ArangoDB is the durable
 * ledger the live state syncs into: a `visitors` node per distinct
 * explorer and an `activeVisitors` sub-node per session with
 * connectedAt/disconnectedAt stamps. A sweeper closes ledger sessions
 * whose Redis key has expired (crashed tabs, dropped networks), so the
 * two stores converge without any per-heartbeat DB writes.
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
export type PresencePosition = z.infer<typeof positionSchema>;

interface SessionRecord {
  /** visitor key */
  v: string;
  /** activeVisitors node key */
  k: string;
  /** alias */
  a: string;
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
 * Ledger ↔ live sync: close every open activeVisitors node whose Redis
 * session key has expired. Idempotent — safe to run on many instances.
 */
export async function sweepStaleSessions() {
  const open = await listOpenActiveVisitors(500);
  if (open.length === 0) return;
  const pipeline = redisConnection.pipeline();
  for (const active of open) pipeline.exists(SESSION_PREFIX + active.sessionKey);
  const results = await pipeline.exec();
  const now = new Date().toISOString();
  for (let index = 0; index < open.length; index += 1) {
    const alive = results?.[index]?.[1] === 1;
    if (alive) continue;
    const active = open[index]!;
    await markActiveVisitorDisconnected(active.key, now);
    await publishPresence({ type: 'leave', session: active.sessionKey, at: now });
  }
}

/**
 * Resolve the visitor node behind this request: the access token's user
 * (emailHash + their alias) wins; the distinct-id cookie is the
 * anonymous fallback. Creates the visitor on first sight, enriches it
 * with anything newly learned after.
 */
async function resolvePresenceVisitor(c: Context, distinctId: string | null): Promise<Visitor | null> {
  const now = new Date().toISOString();
  const userId = await getUserId(c);
  let emailHash: string | null = null;
  let userAlias: string | null = null;
  if (userId) {
    const user = await getUserById(userId);
    if (user) {
      emailHash = user.emailHash;
      userAlias = user.alias;
    }
  }
  if (!emailHash && !distinctId) return null;

  let visitor = emailHash ? await getVisitorByEmailHash(emailHash) : null;
  if (!visitor && distinctId) visitor = await getVisitorByDistinctId(distinctId);

  if (!visitor) {
    // Alias seeds off the most durable identity so the same explorer
    // rolls the same "<Prefix> <Role>" pair (same 250×250 lists as
    // signup) across sessions.
    const alias = userAlias ?? generateAlias(emailHash ?? distinctId!);
    try {
      return await insertVisitor({
        key: newId(),
        platformId: await getDefaultPlatformId(),
        distinctId,
        emailHash,
        userId: userId ?? null,
        alias,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (!isArangoUniqueConstraintError(error)) throw error;
      // Raced a concurrent join for the same identity — adopt the winner.
      const winner = (emailHash ? await getVisitorByEmailHash(emailHash) : null)
        ?? (distinctId ? await getVisitorByDistinctId(distinctId) : null);
      if (!winner) throw error;
      return winner;
    }
  }

  const patch: Partial<Omit<Visitor, 'key' | 'embedding'>> = { lastSeenAt: now, updatedAt: now };
  if (emailHash && visitor.emailHash == null) patch.emailHash = emailHash;
  if (distinctId && visitor.distinctId == null) patch.distinctId = distinctId;
  if (userId && visitor.userId == null) patch.userId = userId;
  // Once authed, the user's alias is authoritative for their star.
  if (userAlias && visitor.alias !== userAlias) patch.alias = userAlias;
  try {
    return await updateVisitor(visitor.key, patch);
  } catch (error) {
    if (!isArangoUniqueConstraintError(error)) throw error;
    // Another visitor already owns this emailHash/distinctId — use it.
    const winner = (emailHash ? await getVisitorByEmailHash(emailHash) : null) ?? visitor;
    return winner;
  }
}

/** POST /presence/join — register a session, return its key + alias. */
export async function joinPresence(c: Context) {
  const body = await parseJson(c, strictObject({
    distinct_id: z.string().min(8).max(80).optional(),
    position: positionSchema.optional(),
  }));

  const visitor = await resolvePresenceVisitor(c, body.distinct_id ?? null);
  if (!visitor) {
    return c.json({ error: 'distinct_id is required when no valid access token is provided' }, 400);
  }

  const now = new Date().toISOString();
  const sessionKey = newId();
  const activeKey = newId();
  const position: PresencePosition = body.position ?? [0, 6.5, 15.5];
  const record: SessionRecord = { v: visitor.key, k: activeKey, a: visitor.alias, p: position };

  // Redis first: the sweeper must never see the ledger node before its key.
  await redisConnection.set(SESSION_PREFIX + sessionKey, JSON.stringify(record), 'EX', SESSION_TTL_SECONDS);
  await insertActiveVisitor({
    key: activeKey,
    platformId: visitor.platformId,
    visitorId: visitor.key,
    emailHash: visitor.emailHash,
    alias: visitor.alias,
    sessionKey,
    connectedAt: now,
    disconnectedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await publishPresence({ type: 'join', session: sessionKey, alias: visitor.alias, position, at: now });
  ensureSubscriber();
  ensureSweeper();

  return c.json({ ok: true, session_key: sessionKey, visitor_key: visitor.key, alias: visitor.alias }, 201);
}

/** POST /presence/beat — heartbeat + position; refreshes the session TTL. */
export async function presenceBeat(c: Context) {
  const body = await parseJson(c, strictObject({
    session_key: z.string().min(8).max(80),
    position: positionSchema,
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
  }));
  const key = SESSION_PREFIX + body.session_key;
  const now = new Date().toISOString();
  const raw = await redisConnection.get(key);
  if (raw) {
    await redisConnection.del(key);
    try {
      const record = JSON.parse(raw) as SessionRecord;
      await markActiveVisitorDisconnected(record.k, now);
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
