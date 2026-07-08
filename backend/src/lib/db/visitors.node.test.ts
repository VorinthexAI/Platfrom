import { describe, expect, test } from 'bun:test';
import { visitorSchema } from './visitors.node';

describe('visitor node schema', () => {
  test('visitor is an anonymous distinct-id identity with its own alias', () => {
    const visitor = visitorSchema.parse({
      key: 'vis_test',
      platformId: 'plt_this',
      distinctId: 'did_1234567890',
      alias: 'Orbit Surfer',
      lastSeenAt: '2026-07-07T00:00:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
    });

    expect(visitor.distinctId).toBe('did_1234567890');
    expect(visitor.alias).toBe('Orbit Surfer');
  });
});
