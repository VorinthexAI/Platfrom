import { describe, expect, test } from 'bun:test';
import { HANDOFF_CLAIM_WINDOW_MS, isHandoffClaimable } from './auth-handoff';

const NOW = Date.parse('2026-07-07T12:00:00.000Z');

function challenge(overrides: Partial<Parameters<typeof isHandoffClaimable>[0]> = {}) {
  return {
    identityType: 'user' as const,
    approvedAt: new Date(NOW - 60_000).toISOString(),
    handoffClaimedAt: null,
    ...overrides,
  };
}

describe('isHandoffClaimable', () => {
  test('accepts a fresh approval for a user identity', () => {
    expect(isHandoffClaimable(challenge(), NOW)).toBe(true);
  });

  test('rejects before the link is tapped', () => {
    expect(isHandoffClaimable(challenge({ approvedAt: null }), NOW)).toBe(false);
  });

  test('rejects a second claim', () => {
    expect(
      isHandoffClaimable(
        challenge({ handoffClaimedAt: new Date(NOW - 1_000).toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  test('rejects once the claim window has passed', () => {
    const approvedAt = new Date(NOW - HANDOFF_CLAIM_WINDOW_MS - 1).toISOString();
    expect(isHandoffClaimable(challenge({ approvedAt }), NOW)).toBe(false);
  });

  test('accepts right up to the edge of the claim window', () => {
    const approvedAt = new Date(NOW - HANDOFF_CLAIM_WINDOW_MS + 1_000).toISOString();
    expect(isHandoffClaimable(challenge({ approvedAt }), NOW)).toBe(true);
  });

  test('never hands a member identity a direct session', () => {
    expect(isHandoffClaimable(challenge({ identityType: 'member' }), NOW)).toBe(false);
  });

  test('rejects malformed approval stamps', () => {
    expect(isHandoffClaimable(challenge({ approvedAt: 'not-a-date' }), NOW)).toBe(false);
  });
});
