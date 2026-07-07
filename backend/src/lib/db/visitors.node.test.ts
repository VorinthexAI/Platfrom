import { describe, expect, test } from 'bun:test';
import { activeVisitorSchema } from './active-visitors.node';
import { visitorSchema } from './visitors.node';

describe('visitor node schemas', () => {
  test('visitor accepts an anonymous distinct-id identity (email hash null)', () => {
    const visitor = visitorSchema.parse({
      key: 'vis_test',
      platformId: 'plt_this',
      distinctId: 'did_1234567890',
      alias: 'Orbit Surfer',
      lastSeenAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(visitor.emailHash).toBeNull();
    expect(visitor.userId).toBeNull();
    expect(visitor.distinctId).toBe('did_1234567890');
  });

  test('visitor accepts an email-hash identity without a distinct id', () => {
    const visitor = visitorSchema.parse({
      key: 'vis_test',
      platformId: 'plt_this',
      emailHash: 'a'.repeat(64),
      alias: 'Nova Cartographer',
      lastSeenAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(visitor.distinctId).toBeNull();
    expect(visitor.emailHash).toBe('a'.repeat(64));
  });

  test('active visitor opens with a null disconnect stamp', () => {
    const active = activeVisitorSchema.parse({
      key: 'avi_test',
      platformId: 'plt_this',
      visitorId: 'vis_test',
      alias: 'Orbit Surfer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(active.disconnectedAt).toBeNull();
    expect(active.emailHash).toBeNull();
    expect(active.connectedAt).toBe('2026-07-07T00:00:00.000Z');
  });

  test('active visitor keeps both timestamps once disconnected', () => {
    const active = activeVisitorSchema.parse({
      key: 'avi_test',
      platformId: 'plt_this',
      visitorId: 'vis_test',
      emailHash: 'b'.repeat(64),
      alias: 'Nova Cartographer',
      sessionKey: 'ses_test',
      connectedAt: '2026-07-07T00:00:00.000Z',
      disconnectedAt: '2026-07-07T00:10:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:10:00.000Z',
    });

    expect(active.connectedAt).toBe('2026-07-07T00:00:00.000Z');
    expect(active.disconnectedAt).toBe('2026-07-07T00:10:00.000Z');
  });
});
