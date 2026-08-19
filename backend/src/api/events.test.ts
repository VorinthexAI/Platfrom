import { describe, expect, test } from 'bun:test';
import { APP_EVENT_SLUGS, parseEventEnvelope, shouldDeliverEvent } from './event-contract';

describe('app event routing', () => {
  test('accepts only registered strict routing envelopes', () => {
    for (const event of APP_EVENT_SLUGS) expect(parseEventEnvelope(JSON.stringify({ route: 'user', userKey: 'user-1', event }))).toEqual({ route: 'user', userKey: 'user-1', event });
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"collection.changed"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"unknown"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"image.changed","data":{}}')).toBeNull();
    expect(parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"image.changed","imageKey":"secret"}')).toBeNull();
    expect(parseEventEnvelope('not json')).toBeNull();
  });

  test('routes user events only to that identity', async () => {
    const envelope = parseEventEnvelope('{"route":"user","userKey":"user-1","event":"upload.changed"}')!;
    const membership = async () => false;
    expect(await shouldDeliverEvent(envelope, 'user-1', membership)).toBe(true);
    expect(await shouldDeliverEvent(envelope, 'user-2', membership)).toBe(false);
  });

  test('checks current collection membership for every event', async () => {
    const envelope = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.content.changed"}')!;
    let member = true;
    let checks = 0;
    const checkMembership = async () => { checks += 1; return member; };
    expect(await shouldDeliverEvent(envelope, 'user-1', checkMembership)).toBe(true);
    member = false;
    expect(await shouldDeliverEvent(envelope, 'user-1', checkMembership)).toBe(false);
    expect(checks).toBe(2);
  });

  test('delivers highlight changes to current collaborators', async () => {
    const envelope = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"highlight.changed"}')!;
    const collaborator = async () => true;
    expect(await shouldDeliverEvent(envelope, 'collaborator', collaborator)).toBe(true);
  });

  test('passes the slug to authorization so owner-only cache families deny readers', async () => {
    const viewer = async (_userKey: string, _collectionKey: string, event: string) => !event.endsWith('invites.changed') && !event.endsWith('shares.changed');
    const content = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.content.changed"}')!;
    const invites = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.invites.changed"}')!;
    const shares = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.shares.changed"}')!;
    expect(await shouldDeliverEvent(content, 'viewer', viewer)).toBe(true);
    expect(await shouldDeliverEvent(invites, 'viewer', viewer)).toBe(false);
    expect(await shouldDeliverEvent(shares, 'collaborator', viewer)).toBe(false);
  });

  test('collection routing query binds membership through the live scope organization', async () => {
    const source = await Bun.file(new URL('./events.ts', import.meta.url)).text();
    expect(source).toContain('membership.organizationId == scope.organizationKey');
    expect(source).toContain('member.scopeKey == collection.scopeKey');
    expect(source).toContain('membership.orgRole IN ["owner", "admin"]');
    expect(source).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(source).toContain('member.status == "active"');
    expect(source).toContain('collectionMembership.role == "owner"');
    expect(source).toContain('ownerOnly');
  });
});
