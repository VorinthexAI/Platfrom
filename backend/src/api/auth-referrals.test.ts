import { describe, expect, test } from 'bun:test';
import { completeReferralForNewlyVerifiedUser } from './auth-referrals';

describe('verified auth referral completion', () => {
  test('applies a carried code only for a newly verified user', async () => {
    const calls: unknown[][] = [];
    const pending = new Map<string, string | null>();
    const completeReferral = async (...args: unknown[]) => { calls.push(args); return {} as never; };
    const dependencies = { completeReferral, getUser: async (key: string) => ({ pendingReferralCode: pending.get(key) ?? null }) as never, updateUser: async (key: string, patch: { pendingReferralCode?: string | null }) => { if ('pendingReferralCode' in patch) pending.set(key, patch.pendingReferralCode ?? null); return {} as never; } };

    await completeReferralForNewlyVerifiedUser({ userKey: 'new-user', wasVerified: false, referralCode: '0123456789ab' }, dependencies);
    await completeReferralForNewlyVerifiedUser({ userKey: 'existing-user', wasVerified: true, referralCode: '0123456789ab' }, dependencies);
    await completeReferralForNewlyVerifiedUser({ userKey: 'new-without-code', wasVerified: false, referralCode: null }, dependencies);

    expect(calls).toEqual([['new-user', '0123456789AB']]);
  });

  test('does not revoke verified auth when referral completion fails', async () => {
    const warnings: unknown[][] = [];
    await expect(completeReferralForNewlyVerifiedUser(
      { userKey: 'new-user', wasVerified: false, referralCode: '0123456789ab' },
      { completeReferral: async () => { throw new Error('transient'); }, getUser: async () => ({ pendingReferralCode: '0123456789AB' }) as never, updateUser: async () => ({}) as never, warn: (...args) => warnings.push(args) },
    )).resolves.toBeUndefined();
    expect(warnings).toEqual([['verified referral completion failed', 'transient']]);
  });

  test('retries a persisted pending referral for an already verified user', async () => {
    const calls: unknown[][] = [];
    await completeReferralForNewlyVerifiedUser({ userKey: 'user', wasVerified: true, referralCode: null }, { getUser: async () => ({ pendingReferralCode: '0123456789AB' }) as never, updateUser: async () => ({}) as never, completeReferral: async (...args) => { calls.push(args); return {} as never; } });
    expect(calls).toEqual([['user', '0123456789AB']]);
  });

  test('does not fail verified authentication for a malformed referral code', async () => {
    const warnings: unknown[][] = [];
    await expect(completeReferralForNewlyVerifiedUser({ userKey: 'user', wasVerified: false, referralCode: 'bad' }, { warn: (...args) => warnings.push(args) })).resolves.toBeUndefined();
    expect(warnings).toHaveLength(1);
  });
});
