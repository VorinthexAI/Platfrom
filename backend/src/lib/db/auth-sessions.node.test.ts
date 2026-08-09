import { describe, expect, test } from 'bun:test';
import { authSessionSchema } from './auth-sessions.node';

describe('auth session persistence contract', () => {
  test('stores only a refresh hash and supports explicit revocation', () => {
    const session = authSessionSchema.parse({
      key: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'a'.repeat(64),
      expiresAt: '2027-08-08T00:00:00.000Z',
      revokedAt: null,
      founderMembershipKey: null,
      founderMfaVersion: null,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(session.refreshTokenHash).toBe('a'.repeat(64));
    expect('refreshToken' in session).toBe(false);
    expect(session.revokedAt).toBeNull();
  });
});
