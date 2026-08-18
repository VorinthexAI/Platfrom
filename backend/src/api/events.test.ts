import { describe, expect, test } from 'bun:test';
import { parseEventEnvelope, shouldDeliverEvent } from './event-contract';

describe('app event routing', () => {
  test('accepts only registered strict routing envelopes', () => {
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"collection.changed"}')).toEqual({
      route: 'user', userKey: 'user-1', event: 'collection.changed',
    });
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"unknown"}')).toBeNull();
    expect(parseEventEnvelope('{"route":"user","userKey":"user-1","event":"collection.changed","data":{}}')).toBeNull();
    expect(parseEventEnvelope('not json')).toBeNull();
  });

  test('routes user events only to that identity', async () => {
    const envelope = parseEventEnvelope('{"route":"user","userKey":"user-1","event":"collection.changed"}')!;
    const membership = async () => false;
    expect(await shouldDeliverEvent(envelope, 'user-1', membership)).toBe(true);
    expect(await shouldDeliverEvent(envelope, 'user-2', membership)).toBe(false);
  });

  test('checks current collection membership for every event', async () => {
    const envelope = parseEventEnvelope('{"route":"collection","collectionKey":"collection-1","event":"collection.changed"}')!;
    let member = true;
    let checks = 0;
    const checkMembership = async () => { checks += 1; return member; };
    expect(await shouldDeliverEvent(envelope, 'user-1', checkMembership)).toBe(true);
    member = false;
    expect(await shouldDeliverEvent(envelope, 'user-1', checkMembership)).toBe(false);
    expect(checks).toBe(2);
  });

  test('collection routing query binds membership through the live scope organization', async () => {
    const source = await Bun.file(new URL('./events.ts', import.meta.url)).text();
    expect(source).toContain('membership.organizationId == scope.organizationKey');
    expect(source).toContain('collectionMembership.scopeKey == collection.scopeKey');
    expect(source).toContain('collection.deletedAt == null');
  });
});
