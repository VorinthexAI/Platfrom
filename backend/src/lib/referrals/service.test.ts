import { describe, expect, test } from 'bun:test';
import { referralAttributionSchema } from '@/lib/db/referral-attributions.node';
import { referralRewardSchema } from '@/lib/db/referral-rewards.node';
import { createReferralService, normalizeReferralCode } from './service';
import type { ReferralRepository } from './repository';

const at = '2026-09-05T10:00:00.000Z';

describe('referral service', () => {
  test('provisions codes explicitly and keeps summary reads free of writes', async () => {
    let stored: Parameters<ReferralRepository['ensureCode']>[0] | undefined;
    let ensureCalls = 0;
    const repository: ReferralRepository = {
      async ensureCode(input) { ensureCalls += 1; return stored ??= input; },
      async readSummary(userKey) {
        if (!stored) throw new Error('Referral code invariant is missing.');
        return { code: { ...stored, ownerUserKey: userKey }, attributionCount: 0, signupRewardCount: 0, paidRewardCount: 0, earnedMicroSparks: 0, invitees: [] };
      },
      async readRedemptionStatus() { return { attributed: false, referrerName: null, signupRewardIssued: false, firstPaidRewardStatus: null }; },
      async completeVerifiedReferral() { throw new Error('unused'); },
      async applyFirstPaidReward() { return { status: 'not-attributed' }; },
      async reverseFirstPaidReward() { return { status: 'not-found' as const }; },
    };
    const service = createReferralService({ repository, createKey: () => 'code-key', createCode: () => 'abcdef012345', now: () => new Date(at), publishReward: async () => undefined });
    await expect(service.readSummary('user')).rejects.toThrow('invariant is missing');
    await expect(service.ensurePersonalCode('user')).resolves.toMatchObject({ code: 'ABCDEF012345', programVersion: 'v1' });
    await expect(service.readSummary('user')).resolves.toMatchObject({ code: { code: 'ABCDEF012345', programVersion: 'v1' } });
    expect(ensureCalls).toBe(1);
    expect(normalizeReferralCode(' abcdef012345 ')).toBe('ABCDEF012345');
    expect(() => normalizeReferralCode('short')).toThrow();
  });

  test('awards only the referrer and publishes best-effort after signup commit, including replay', async () => {
    const calls: Array<{ referredUserKey: string; normalizedCode: string }> = [], events: string[] = [];
    const attribution = referralAttributionSchema.parse({ key: 'attribution', referralCodeKey: 'code', referrerUserKey: 'referrer', referredUserKey: 'referred', programVersion: 'v1', createdAt: at });
    const reward = referralRewardSchema.parse({ key: 'reward', attributionKey: attribution.key, referrerUserKey: 'referrer', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction', createdAt: at });
    let replay = false;
    const repository: ReferralRepository = {
      async ensureCode() { throw new Error('unused'); },
      async readSummary() { throw new Error('unused'); },
      async readRedemptionStatus() { return { attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }; },
      async completeVerifiedReferral(input) { calls.push(input); return { status: replay ? 'replayed' : 'applied', attribution, reward }; },
      async applyFirstPaidReward() { return { status: 'not-attributed' }; },
      async reverseFirstPaidReward() { return { status: 'not-found' as const }; },
    };
    let key = 0;
    const service = createReferralService({ repository, createKey: () => `key-${++key}`, now: () => new Date(at), publishReward: async (userKey, event) => { events.push(`${userKey}:${event}`); throw new Error('offline'); } });
    await expect(service.completeVerifiedReferral('referred', '0123456789ab')).resolves.toMatchObject({ status: 'applied' });
    replay = true;
    await expect(service.completeVerifiedReferral('referred', '0123456789ab')).resolves.toMatchObject({ status: 'replayed' });
    expect(calls.every((call) => call.referredUserKey === 'referred' && call.normalizedCode === '0123456789AB')).toBe(true);
    expect(events).toEqual(['referrer:referral.reward.created', 'referrer:referral.reward.created']);
  });

  test('provides an explicit trusted settlement operation without publishing when unattributed', async () => {
    let received: Parameters<ReferralRepository['applyFirstPaidReward']>[0] | undefined;
    const repository: ReferralRepository = {
      async ensureCode() { throw new Error('unused'); },
      async readSummary() { throw new Error('unused'); },
      async readRedemptionStatus() { return { attributed: false, referrerName: null, signupRewardIssued: false, firstPaidRewardStatus: null }; },
      async completeVerifiedReferral() { throw new Error('unused'); },
      async applyFirstPaidReward(input) { received = input; return { status: 'not-attributed' }; },
      async reverseFirstPaidReward() { return { status: 'not-found' as const }; },
    };
    let published = false;
    const service = createReferralService({ repository, createKey: () => 'key', now: () => new Date(at), publishReward: async () => { published = true; } });
    await expect(service.applyFirstPaidReward('referred', 'payment-1')).resolves.toEqual({ status: 'not-attributed' });
    expect(received).toMatchObject({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', microSparks: 100_000_000 });
    expect(published).toBe(false);
  });

  test('redeems a normalized code and returns safe dynamic reward status', async () => {
    const attribution = referralAttributionSchema.parse({ key: 'attribution', referralCodeKey: 'code', referrerUserKey: 'referrer', referredUserKey: 'referred', programVersion: 'v1', createdAt: at });
    const reward = referralRewardSchema.parse({ key: 'reward', attributionKey: attribution.key, referrerUserKey: 'referrer', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction', createdAt: at });
    const repository = {
      ensureCode: async () => { throw new Error('unused'); },
      readSummary: async () => { throw new Error('unused'); },
      readRedemptionStatus: async () => ({ attributed: true as const, referrerName: 'Inviting Friend', signupRewardIssued: true, firstPaidRewardStatus: 'earned' as const }),
      completeVerifiedReferral: async (input: Parameters<ReferralRepository['completeVerifiedReferral']>[0]) => { expect(input.normalizedCode).toBe('0123456789AB'); return { status: 'applied' as const, attribution, reward }; },
      applyFirstPaidReward: async () => ({ status: 'not-attributed' as const }),
      reverseFirstPaidReward: async () => ({ status: 'not-found' as const }),
    } satisfies ReferralRepository;
    const service = createReferralService({ repository, createKey: () => 'key', now: () => new Date(at), publishReward: async () => undefined });

    await expect(service.redeem('referred', ' 0123456789ab ')).resolves.toEqual({ status: 'applied', attributed: true, referrerName: 'Inviting Friend', signupRewardIssued: true, firstPaidRewardStatus: 'earned' });
  });

  test('replays a redemption after its first-paid reward was reversed', async () => {
    const attribution = referralAttributionSchema.parse({ key: 'attribution', referralCodeKey: 'code', referrerUserKey: 'referrer', referredUserKey: 'referred', programVersion: 'v1', createdAt: at });
    const reward = referralRewardSchema.parse({ key: 'reward', attributionKey: attribution.key, referrerUserKey: 'referrer', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction', createdAt: at });
    const repository = {
      ensureCode: async () => { throw new Error('unused'); },
      readSummary: async () => { throw new Error('unused'); },
      readRedemptionStatus: async () => ({ attributed: true as const, referrerName: 'Inviting Friend', signupRewardIssued: true, firstPaidRewardStatus: 'reversed' as const }),
      completeVerifiedReferral: async () => ({ status: 'replayed' as const, attribution, reward }),
      applyFirstPaidReward: async () => ({ status: 'not-attributed' as const }),
      reverseFirstPaidReward: async () => ({ status: 'not-found' as const }),
    } satisfies ReferralRepository;
    const service = createReferralService({ repository, createKey: () => 'key', now: () => new Date(at), publishReward: async () => undefined });

    await expect(service.redeem('referred', '0123456789ab')).resolves.toMatchObject({ status: 'replayed', firstPaidRewardStatus: 'reversed' });
  });

  test('publishes referral invalidation after a first-paid reward reversal', async () => {
    const events: string[] = [];
    const repository = {
      ensureCode: async () => { throw new Error('unused'); },
      readSummary: async () => { throw new Error('unused'); },
      readRedemptionStatus: async () => ({ attributed: false, referrerName: null, signupRewardIssued: false, firstPaidRewardStatus: null }),
      completeVerifiedReferral: async () => { throw new Error('unused'); },
      applyFirstPaidReward: async () => ({ status: 'not-attributed' as const }),
      reverseFirstPaidReward: async () => ({ status: 'applied' as const, referrerUserKey: 'referrer' }),
    } satisfies ReferralRepository;
    const service = createReferralService({ repository, publishReward: async (userKey, event) => { events.push(`${userKey}:${event}`); } });

    await expect(service.reverseFirstPaidReward('payment-1', at)).resolves.toEqual({ status: 'applied', referrerUserKey: 'referrer' });
    expect(events).toEqual(['referrer:referral.reward.created']);
  });
});
