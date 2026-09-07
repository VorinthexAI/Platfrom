import { describe, expect, test } from 'bun:test';
import { referralAttributionSchema } from './referral-attributions.node';
import { referralCodeSchema } from './referral-codes.node';
import { referralRewardSchema } from './referral-rewards.node';

const at = '2026-09-05T10:00:00.000Z';

describe('referral persistence schemas', () => {
  test('uses public keys, strips database metadata, and enforces reward milestones without tombstones', () => {
    const code = referralCodeSchema.parse({ key: 'code-key', ownerUserKey: 'owner', programVersion: 'v1', code: '0123456789AB', createdAt: at, databaseMetadata: true });
    const attribution = referralAttributionSchema.parse({ key: 'attribution-key', referralCodeKey: code.key, referrerUserKey: 'owner', referredUserKey: 'referred', programVersion: 'v1', createdAt: at });
    const reward = referralRewardSchema.parse({ key: 'reward-key', attributionKey: attribution.key, referrerUserKey: 'owner', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction-key', createdAt: at });

    expect({ code, attribution, reward }).not.toHaveProperty('_key');
    expect(reward).not.toHaveProperty('deletedAt');
    expect(code).not.toHaveProperty('databaseMetadata');
    expect(referralAttributionSchema.parse({ ...attribution, _rev: 'revision' })).not.toHaveProperty('_rev');
    expect(referralRewardSchema.parse({ ...reward, internal: true })).not.toHaveProperty('internal');
    expect(() => referralRewardSchema.parse({ ...reward, microSparks: 0 })).toThrow();
    expect(() => referralRewardSchema.parse({ ...reward, qualifyingPaymentKey: 'payment-key' })).toThrow();
    expect(() => referralRewardSchema.parse({ ...reward, milestone: 'first-paid' })).toThrow();
    expect(referralRewardSchema.parse({ ...reward, milestone: 'first-paid', qualifyingPaymentKey: 'payment-key' })).toMatchObject({ milestone: 'first-paid', qualifyingPaymentKey: 'payment-key' });
  });
});
