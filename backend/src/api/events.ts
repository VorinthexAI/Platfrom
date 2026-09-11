import { EventEmitter } from 'node:events';
import { aql } from 'arangojs';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { redisConnection } from '@/lib/redis';
import { parseEventEnvelope, shouldDeliverEvent, type AppEventSlug, type EventEnvelope, type SparkBalanceRequiredCode } from './event-contract';
import { getAuthIdentity } from './security';
import { emptyObject, parseJson } from './validation';

export { APP_EVENT_SLUGS } from './event-contract';
export type { AppEventSlug } from './event-contract';

const EVENT_CHANNEL = 'app:events';
const LOCAL_EVENT = 'event';
const HEARTBEAT_INTERVAL_MS = 20_000;
const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);
const eventSubscriber = redisConnection.duplicate();
let subscriberStart: Promise<void> | undefined;

eventSubscriber.on('error', (error) => {
  console.warn('event subscriber error', error instanceof Error ? error.message : String(error));
});
eventSubscriber.on('message', (_channel, message) => {
  eventBus.emit(LOCAL_EVENT, message);
});

function ensureSubscriber() {
  if (subscriberStart) return subscriberStart;
  subscriberStart = eventSubscriber.subscribe(EVENT_CHANNEL).then(() => undefined).catch((error) => {
    subscriberStart = undefined;
    console.warn('event subscribe failed', error instanceof Error ? error.message : String(error));
    throw error;
  });
  return subscriberStart;
}

async function publishEvent(envelope: EventEnvelope) {
  const message = JSON.stringify(envelope);
  if (!parseEventEnvelope(message)) throw new TypeError('Invalid app event envelope.');
  try {
    await redisConnection.publish(EVENT_CHANNEL, message);
  } catch (error) {
    // Preserve same-process delivery when Redis is temporarily unavailable.
    eventBus.emit(LOCAL_EVENT, message);
    console.warn('event publish failed', error instanceof Error ? error.message : String(error));
  }
}

type EventDatabase = Pick<typeof db, 'query'>;
const fundingRequirementSchema = z.object({ key: z.string().cuid(), code: z.enum(['INSUFFICIENT_BALANCE', 'OUTSTANDING_DEBT']) }).strict();

export async function listPendingFundingRequirements(userKey: string, database: EventDatabase = db) {
  const cursor = await database.query('FOR message IN conversationMessages FILTER message.userKey == @userKey && message.type == "IMAGE" && message.role == "ASSISTANT" && message.status == "FAILED" && message.fundingRequiredCode IN ["INSUFFICIENT_BALANCE", "OUTSTANDING_DEBT"] && message.fundingRequiredAcknowledgedAt == null SORT message.completedAt DESC, message._key DESC LIMIT 1 RETURN { key: message._key, code: message.fundingRequiredCode }', { userKey });
  return z.array(fundingRequirementSchema).parse(await cursor.all());
}

export async function acknowledgeFundingRequirement(userKey: string, key: string, acknowledgedAt: string, database: EventDatabase = db) {
  const cursor = await database.query('FOR message IN conversationMessages FILTER message._key == @key && message.userKey == @userKey && message.type == "IMAGE" && message.role == "ASSISTANT" && message.status == "FAILED" && message.fundingRequiredCode IN ["INSUFFICIENT_BALANCE", "OUTSTANDING_DEBT"] && message.fundingRequiredAcknowledgedAt == null UPDATE message WITH { fundingRequiredAcknowledgedAt: @acknowledgedAt } IN conversationMessages RETURN true', { userKey, key: z.string().cuid().parse(key), acknowledgedAt: z.string().datetime().parse(acknowledgedAt) });
  return await cursor.next() === true;
}

export async function isPendingFundingRequirement(userKey: string, key: string, database: EventDatabase = db) {
  const cursor = await database.query('LET message = DOCUMENT(conversationMessages, @key) RETURN message != null && message.userKey == @userKey && message.type == "IMAGE" && message.role == "ASSISTANT" && message.status == "FAILED" && message.fundingRequiredCode IN ["INSUFFICIENT_BALANCE", "OUTSTANDING_DEBT"] && message.fundingRequiredAcknowledgedAt == null', { userKey, key: z.string().cuid().parse(key) });
  return await cursor.next() === true;
}

export function publishUserEvent(userKey: string, event: AppEventSlug, code?: SparkBalanceRequiredCode, key?: string) {
  return event === 'spark.balance.required'
    ? publishEvent({ route: 'user', userKey, event, code: code!, key: key! })
    : publishEvent({ route: 'user', userKey, event });
}

export function publishCollectionEvent(collectionKey: string, event: Exclude<AppEventSlug, 'spark.balance.required'>) {
  return publishEvent({ route: 'collection', collectionKey, event });
}

export function publishScopeEvent(scopeKey: string, event: Exclude<AppEventSlug, 'spark.balance.required'>) {
  return publishEvent({ route: 'scope', scopeKey, event });
}

export async function hasScopeEventAccess(userKey: string, scopeKey: string) {
  const cursor = await db.query(aql`
    RETURN LENGTH(
      FOR scope IN scopes
        FILTER scope._key == ${scopeKey}
        FOR membership IN userTeams
          FILTER membership.userId == ${userKey} AND membership.status == "active"
            AND membership.teamKey == scope.teamKey
          LET scopeRole = FIRST(
            FOR member IN scopeMembers
              FILTER member.scopeKey == scope._key
                AND member.userTeamKey == membership._key
                AND member.status == "active"
              LIMIT 1
              RETURN member.role
          )
          FILTER membership.teamRole IN ["owner", "admin"] OR scopeRole != null
          RETURN 1
    ) > 0
  `);
  return Boolean(await cursor.next());
}

export async function hasCollectionEventAccess(userKey: string, collectionKey: string, _event: AppEventSlug) {
  const cursor = await db.query(aql`
    RETURN LENGTH(
      FOR collection IN collections
        FILTER collection._key == ${collectionKey}
        LET scope = DOCUMENT(scopes, collection.scopeKey)
        FILTER scope != null AND collection.scopeKey == scope._key
      FOR membership IN userTeams
        FILTER membership.userId == ${userKey} AND membership.status == "active"
          AND membership.teamKey == scope.teamKey
        LET scopeRole = FIRST(
          FOR member IN scopeMembers
            FILTER member.scopeKey == collection.scopeKey
              AND member.userTeamKey == membership._key
              AND member.status == "active"
            LIMIT 1
            RETURN member.role
        )
        LET manager = membership.teamRole IN ["owner", "admin"]
          OR scopeRole IN ["owner", "admin", "moderator"]
        FILTER manager OR collection.ownerKey == membership._key
        RETURN 1
    ) > 0
  `);
  return Boolean(await cursor.next());
}

export async function streamEvents(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity || identity.identityType !== 'user') {
    c.header('WWW-Authenticate', 'Bearer');
    return c.json({ error: 'authenticated user required' }, 401);
  }

  await ensureSubscriber();
  return streamSSE(c, async (stream) => {
    let active = true;
    const deliveredFundingRequirements = new Set<string>();
    const onEvent = (message: string) => {
      const envelope = parseEventEnvelope(message);
      if (!envelope) return;
      void shouldDeliverEvent(envelope, identity.key, hasCollectionEventAccess, hasScopeEventAccess).then(async (deliver) => {
        if (!active || !deliver) return;
        if (envelope.event === 'spark.balance.required') {
          if (!await isPendingFundingRequirement(identity.key, envelope.key) || !active) return;
          if (deliveredFundingRequirements.has(envelope.key)) return;
          deliveredFundingRequirements.add(envelope.key);
        }
        return stream.writeSSE({ event: envelope.event, data: envelope.event === 'spark.balance.required' ? envelope.code : '', ...(envelope.event === 'spark.balance.required' ? { id: envelope.key } : {}) });
      }).catch((error) => {
        console.warn('event routing failed', error instanceof Error ? error.message : String(error));
      });
    };
    eventBus.on(LOCAL_EVENT, onEvent);
    const heartbeat = setInterval(() => {
      void stream.write(': heartbeat\n\n').catch(() => undefined);
    }, HEARTBEAT_INTERVAL_MS);
    const closed = new Promise<void>((resolve) => stream.onAbort(resolve));

    try {
      await stream.write(': connected\n\n');
      for (const requirement of await listPendingFundingRequirements(identity.key)) {
        if (!active) break;
        if (deliveredFundingRequirements.has(requirement.key)) continue;
        deliveredFundingRequirements.add(requirement.key);
        await stream.writeSSE({ event: 'spark.balance.required', data: requirement.code, id: requirement.key });
      }
      await closed;
    } finally {
      active = false;
      clearInterval(heartbeat);
      eventBus.off(LOCAL_EVENT, onEvent);
    }
  });
}

export async function acknowledgeFundingRequirementHandler(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity || identity.identityType !== 'user') {
    c.header('WWW-Authenticate', 'Bearer');
    return c.json({ error: 'authenticated user required' }, 401);
  }
  await parseJson(c, emptyObject);
  const acknowledged = await acknowledgeFundingRequirement(identity.key, z.string().cuid().parse(c.req.param('messageKey')), new Date().toISOString());
  return c.json({ success: true, data: { acknowledged } });
}
