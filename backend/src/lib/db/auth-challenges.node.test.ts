import { describe, expect, test } from 'bun:test';
import { parseAuthChallenge } from './auth-challenges.node';

describe('auth challenge node schema', () => {
  test('parses purpose-bound founder challenges', () => {
    const challenge = parseAuthChallenge({
      key: 'ach_founder',
      identityKey: 'usr_founder',
      identityType: 'superAdmin',
      teamMembershipKey: 'uteam_root',
      kind: 'founder_recovery',
      tokenHash: 'hash',
      expiresAt: '2026-07-07T00:05:00.000Z',
      createdAt: '2026-07-07T00:00:00.000Z',
    });

    expect(challenge.teamMembershipKey).toBe('uteam_root');
    expect(challenge.kind).toBe('founder_recovery');
  });

  test('preserves team-bound recovery scope without identity input', () => {
    const challenge = parseAuthChallenge({
      key: 'ach_recovery', identityKey: 'usr_member', identityType: 'member', teamMembershipKey: 'uteam_team',
      scopeKey: 'cm1234567890123456789012345', kind: 'team_recovery', tokenHash: 'hash',
      expiresAt: '2026-07-07T00:15:00.000Z', createdAt: '2026-07-07T00:00:00.000Z',
    });
    expect(challenge).toMatchObject({ teamMembershipKey: 'uteam_team', scopeKey: 'cm1234567890123456789012345', kind: 'team_recovery' });
  });

  test('strictly parses and preserves a referral code', () => {
    const challenge = parseAuthChallenge({ key: 'ach_referral', identityKey: 'usr_new', identityType: 'user', kind: 'email', tokenHash: 'hash', expiresAt: '2026-07-07T00:15:00.000Z', createdAt: '2026-07-07T00:00:00.000Z', referralCode: ' referral-code ' });
    expect(challenge.referralCode).toBe('referral-code');
    expect(() => parseAuthChallenge({ ...challenge, referralCode: '' })).toThrow();
  });
});
