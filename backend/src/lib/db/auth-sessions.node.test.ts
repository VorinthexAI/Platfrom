import { describe, expect, test } from 'bun:test';
import { authSessionSchema } from './auth-sessions.node';

describe('auth session persistence contract', () => {
  test('stores only a refresh hash and supports explicit revocation', () => {
    const session = authSessionSchema.parse({
      key: 'session-1',
      userId: 'user-1',
      identityType: 'user',
      refreshTokenHash: 'a'.repeat(64),
      expiresAt: '2027-08-08T00:00:00.000Z',
      revokedAt: null,
      founderMembershipKey: null,
      founderMfaVersion: null,
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(session.refreshTokenHash).toBe('a'.repeat(64));
    expect(session.identityType).toBe('user');
    expect('refreshToken' in session).toBe(false);
    expect(session.revokedAt).toBeNull();
  });

  test('accepts legacy sessions without an identity type during migration', () => {
    const session = authSessionSchema.parse({
      key: 'legacy-session',
      userId: 'user-1',
      refreshTokenHash: 'b'.repeat(64),
      expiresAt: '2027-08-08T00:00:00.000Z',
      createdAt: '2026-08-08T00:00:00.000Z',
      updatedAt: '2026-08-08T00:00:00.000Z',
    });

    expect(session.identityType).toBeUndefined();
  });
});
