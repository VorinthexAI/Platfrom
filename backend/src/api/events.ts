import { EventEmitter } from 'node:events';
import { aql } from 'arangojs';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { db } from '@/lib/db/client';
import { redisConnection } from '@/lib/redis';
import { parseEventEnvelope, shouldDeliverEvent, type AppEventSlug, type EventEnvelope } from './event-contract';
import { getAuthIdentity } from './security';

export { APP_EVENT_SLUGS } from './event-contract';
export type { AppEventSlug } from './event-contract';

const EVENT_CHANNEL = 'app:events';
const LOCAL_EVENT = 'event';
const HEARTBEAT_INTERVAL_MS = 20_000;
const eventBus = new EventEmitter();
eventBus.setMaxListeners(0);
const eventSubscriber = redisConnection.duplicate();
let subscriberStarted = false;

eventSubscriber.on('error', (error) => {
  console.warn('event subscriber error', error instanceof Error ? error.message : String(error));
});
eventSubscriber.on('message', (_channel, message) => {
  eventBus.emit(LOCAL_EVENT, message);
});

function ensureSubscriber() {
  if (subscriberStarted) return;
  subscriberStarted = true;
  eventSubscriber.subscribe(EVENT_CHANNEL).catch((error) => {
    subscriberStarted = false;
    console.warn('event subscribe failed', error instanceof Error ? error.message : String(error));
  });
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

export function publishUserEvent(userKey: string, event: AppEventSlug) {
  return publishEvent({ route: 'user', userKey, event });
}

export function publishCollectionEvent(collectionKey: string, event: AppEventSlug) {
  return publishEvent({ route: 'collection', collectionKey, event });
}

export function publishScopeEvent(scopeKey: string, event: AppEventSlug) {
  return publishEvent({ route: 'scope', scopeKey, event });
}

export async function hasScopeEventAccess(userKey: string, scopeKey: string) {
  const cursor = await db.query(aql`
    RETURN LENGTH(
      FOR scope IN scopes
        FILTER scope._key == ${scopeKey}
        FOR membership IN userOrganizations
          FILTER membership.userId == ${userKey} AND membership.status == "active"
            AND membership.organizationId == scope.organizationKey
          LET scopeRole = FIRST(
            FOR member IN scopeMembers
              FILTER member.scopeKey == scope._key
                AND member.userOrganizationKey == membership._key
                AND member.status == "active"
              LIMIT 1
              RETURN member.role
          )
          FILTER membership.orgRole IN ["owner", "admin"] OR scopeRole != null
          RETURN 1
    ) > 0
  `);
  return Boolean(await cursor.next());
}

export async function hasCollectionEventAccess(userKey: string, collectionKey: string, event: AppEventSlug) {
  const ownerOnly = event === 'collection.invites.changed' || event === 'collection.shares.changed';
  const cursor = await db.query(aql`
    RETURN LENGTH(
      FOR collection IN collections
        FILTER collection._key == ${collectionKey}
        LET scope = DOCUMENT(scopes, collection.scopeKey)
        FILTER scope != null AND collection.scopeKey == scope._key
      FOR membership IN userOrganizations
        FILTER membership.userId == ${userKey} AND membership.status == "active"
          AND membership.organizationId == scope.organizationKey
        LET scopeRole = FIRST(
          FOR member IN scopeMembers
            FILTER member.scopeKey == collection.scopeKey
              AND member.userOrganizationKey == membership._key
              AND member.status == "active"
            LIMIT 1
            RETURN member.role
        )
        LET collectionMembership = FIRST(
          FOR member IN collectionMembers
            FILTER member.memberKey == membership._key
              AND member.collectionKey == ${collectionKey}
              AND member.scopeKey == collection.scopeKey
            LIMIT 1
            RETURN member
        )
        LET manager = membership.orgRole IN ["owner", "admin"]
          OR scopeRole IN ["owner", "admin", "moderator"]
          OR collectionMembership.role == "owner"
        FILTER ${ownerOnly} ? manager : (manager OR collectionMembership != null)
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

  ensureSubscriber();
  return streamSSE(c, async (stream) => {
    let active = true;
    const onEvent = (message: string) => {
      const envelope = parseEventEnvelope(message);
      if (!envelope) return;
      void shouldDeliverEvent(envelope, identity.key, hasCollectionEventAccess, hasScopeEventAccess).then((deliver) => {
        if (active && deliver) return stream.writeSSE({ event: envelope.event, data: '' });
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
      await closed;
    } finally {
      active = false;
      clearInterval(heartbeat);
      eventBus.off(LOCAL_EVENT, onEvent);
    }
  });
}
