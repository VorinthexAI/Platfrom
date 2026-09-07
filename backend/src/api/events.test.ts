import { describe, expect, test } from 'bun:test';
import { APP_EVENT_SLUGS, parseEventEnvelope, shouldDeliverEvent } from './event-contract';

describe('app event routing', () => {
  test('accepts only registered strict routing envelopes', () => {
    for (const event of APP_EVENT_SLUGS) expect(parseEventEnvelope(JSON.stringify({ route: 'user', userKey: 'user-1', event }))).toEqual({ route: 'user', userKey: 'user-1', event });
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"collection.changed"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"unknown"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"image.changed","data":{}}')).toBeNull();
    expect(parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"image.changed","imageKey":"secret"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"trip.changed"}')).toEqual({ route: 'scope', scopeKey: 'scope-1', event: 'trip.changed' });
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"place.reference.changed"}')).toEqual({ route: 'scope', scopeKey: 'scope-1', event: 'place.reference.changed' });
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"inbox.changed"}')).toEqual({ route: 'scope', scopeKey: 'scope-1', event: 'inbox.changed' });
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"book.changed"}')).toEqual({ route: 'scope', scopeKey: 'scope-1', event: 'book.changed' });
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"conversation.changed"}')).toEqual({ route: 'user', userKey: 'user-1', event: 'conversation.changed' });
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"referral.reward.created"}')).toEqual({ route: 'user', userKey: 'user-1', event: 'referral.reward.created' });
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"inbox.changed","credentials":"no"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"trip.changed","tripKey":"secret"}')).toBeNull();
    expect(parseEventEnvelope('not json')).toBeNull();
  });

  test('routes user events only to that identity', async () => {
    const envelope = parseEventEnvelope('{"route":"user","userKey":"user-1","event":"upload.changed"}')!;
    const membership = async () => false;
    expect(await shouldDeliverEvent(envelope, 'user-1', membership)).toBe(true);
    expect(await shouldDeliverEvent(envelope, 'user-2', membership)).toBe(false);
  });

  test('checks current collection access for every event', async () => {
    const envelope = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.content.changed"}')!;
    let accessible = true;
    let checks = 0;
    const checkAccess = async () => { checks += 1; return accessible; };
    expect(await shouldDeliverEvent(envelope, 'user-1', checkAccess)).toBe(true);
    accessible = false;
    expect(await shouldDeliverEvent(envelope, 'user-1', checkAccess)).toBe(false);
    expect(checks).toBe(2);
  });

  test('checks current scope membership for scope events', async () => {
    const envelope = parseEventEnvelope('{"route":"scope","scopeKey":"scope-1","event":"trip.changed"}')!;
    expect(await shouldDeliverEvent(envelope, 'member', async () => false, async (userKey, scopeKey) => userKey === 'member' && scopeKey === 'scope-1')).toBe(true);
    expect(await shouldDeliverEvent(envelope, 'outsider', async () => false, async () => false)).toBe(false);
  });

  test('delivers highlight changes while collection access remains authorized', async () => {
    const envelope = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"highlight.changed"}')!;
    let active = true;
    const access = async () => active;
    expect(await shouldDeliverEvent(envelope, 'owner', access)).toBe(true);
    expect(await shouldDeliverEvent(envelope, 'manager', access)).toBe(true);
    active = false;
    expect(await shouldDeliverEvent(envelope, 'former-owner', access)).toBe(false);
  });

  test('collection routing query binds membership through the live scope team', async () => {
    const source = await Bun.file(new URL('./events.ts', import.meta.url)).text();
    expect(source).toContain('membership.teamKey == scope.teamKey');
    expect(source).toContain('member.scopeKey == collection.scopeKey');
    expect(source).toContain('membership.teamRole IN ["owner", "admin"]');
    expect(source).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(source).toContain('member.status == "active"');
    expect(source).toContain('manager OR collection.ownerKey == membership._key');
    expect(source).not.toContain('collectionMembers');
    expect(source).toContain('export async function hasScopeEventAccess');
  });
});
