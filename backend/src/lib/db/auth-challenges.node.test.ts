import { describe, expect, test } from 'bun:test';
import { parseAuthChallenge } from './auth-challenges.node';

describe('auth challenge node schema', () => {
  test('maps legacy userId challenges to user identity fields', () => {
    const challenge = parseAuthChallenge({
      _key: 'ach_test',
      key: 'ach_test',
      userId: 'usr_test',
      kind: 'email',
      tokenHash: 'hash',
      expiresAt: '2026-07-07T00:15:00.000Z',
      consumedAt: null,
      createdAt: '2026-07-07T00:00:00.000Z',
      embedding: [],
    });

    expect(challenge.identityKey).toBe('usr_test');
    expect(challenge.identityType).toBe('user');
  });
});
