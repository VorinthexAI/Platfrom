import { describe, expect, test } from 'bun:test';
import { insertUserSessionUnlessDeleting } from './user-sessions.node';

const session = {
  key: 'session-node', teamKey: 'team-1', userId: 'user-1', alias: 'Nova', source: 'mobile' as const,
  sessionKey: 'session-1', connectedAt: '2026-09-06T10:00:00.000Z', disconnectedAt: null,
  createdAt: '2026-09-06T10:00:00.000Z', updatedAt: '2026-09-06T10:00:00.000Z',
};

describe('authenticated presence session insertion', () => {
  test('shares exclusive user/session lock ordering with deletion and rejects a fenced user atomically', async () => {
    let declaration: unknown; let query = '';
    const result = await insertUserSessionUnlessDeleting(session, (async (collections: unknown, operation: (transaction: unknown) => Promise<boolean>) => {
      declaration = collections;
      return operation({ query: async (value: string) => { query = value; return { next: async () => undefined }; } } as never);
    }) as never);
    expect(result).toBe(false);
    expect(declaration).toEqual(['users', 'userSessions']);
    expect(query).toContain('user.deletionRequestedAt == null');
    expect(query.indexOf('FILTER user')).toBeLessThan(query.indexOf('INSERT @session'));
  });
});
