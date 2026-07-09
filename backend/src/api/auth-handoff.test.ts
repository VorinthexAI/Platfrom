import { describe, expect, test } from 'bun:test';
import { claimHandoff, HANDOFF_CLAIM_WINDOW_MS, isHandoffClaimable } from './auth-handoff';

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

describe('claimHandoff explorer bag adoption', () => {
  // claimHandoff checks claimability against the real clock, so the mock
  // approval must be fresh relative to Date.now(), not the fixed NOW.
  const NOW_ISO = new Date(Date.now() - 60_000).toISOString();

  function makeDeps(overrides: Partial<import('./auth-handoff').ClaimHandoffDeps> = {}) {
    const adoptions: Array<{ explorerId: string; userId: string }> = [];
    let countersDirty = 0;
    const deps: import('./auth-handoff').ClaimHandoffDeps = {
      getAuthChallengeByHandoffTokenHash: (async () => ({
        key: 'chal_test',
        identityKey: 'usr_test',
        identityType: 'user',
        kind: 'email',
        tokenHash: 'x',
        handoffTokenHash: 'y',
        approvedAt: NOW_ISO,
        handoffClaimedAt: null,
        consumedAt: NOW_ISO,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        createdAt: NOW_ISO,
      })) as never,
      updateAuthChallenge: (async () => ({})) as never,
      getUserById: (async () => ({
        key: 'usr_test',
        alias: 'Silent Scout',
        alias_slug: 'silent-scout',
        waitlistNumber: 7,
        emailHash: 'hash',
      })) as never,
      adoptExplorerFragments: (async (explorerId: string, userId: string) => {
        adoptions.push({ explorerId, userId });
        return 3;
      }) as never,
      notifyCountersDirty: (() => {
        countersDirty += 1;
      }) as never,
      issueUserTokens: (async () => ({ accessToken: 'a', refreshToken: 'r' })) as never,
      ...overrides,
    };
    return { deps, adoptions, dirty: () => countersDirty };
  }

  test('adopts the claiming browser explorer bag onto the account', async () => {
    const { deps, adoptions, dirty } = makeDeps();
    const result = await claimHandoff('a'.repeat(64), 'explorer-uuid-1234', deps);
    expect(result?.status).toBe('authenticated');
    expect(adoptions).toEqual([{ explorerId: 'explorer-uuid-1234', userId: 'usr_test' }]);
    expect(dirty()).toBe(1);
  });

  test('claims fine without an explorer id and adopts nothing', async () => {
    const { deps, adoptions } = makeDeps();
    const result = await claimHandoff('a'.repeat(64), undefined, deps);
    expect(result?.status).toBe('authenticated');
    expect(adoptions).toEqual([]);
  });

  test('skips the counters nudge when nothing was adopted', async () => {
    const { deps, dirty } = makeDeps({
      adoptExplorerFragments: (async () => 0) as never,
    });
    await claimHandoff('a'.repeat(64), 'explorer-uuid-1234', deps);
    expect(dirty()).toBe(0);
  });
});
