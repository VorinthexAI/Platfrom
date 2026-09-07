import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createArangoReferralRepository, ReferralRepositoryError, type ReferralDatabase, type ReferralTransactionRunner } from './repository';

const at = '2026-09-05T10:00:00.000Z';
const rawCode = { _key: 'code-key', ownerUserKey: 'referrer', programVersion: 'v1', code: '0123456789AB', createdAt: at };
const rawAttribution = { _key: 'attribution-key', referralCodeKey: 'code-key', referrerUserKey: 'referrer', referredUserKey: 'referred', programVersion: 'v1', createdAt: at };
const rawReward = { _key: 'reward-key', attributionKey: 'attribution-key', referrerUserKey: 'referrer', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction-key', createdAt: at };
const rawTransaction = { _key: 'transaction-key', userKey: 'referrer', kind: 'referral-reward', deltaMicroSparks: 50_000_000, balanceAfterMicroSparks: 50_000_000, idempotencyKey: 'referral-reward:v1:attribution-key:signup', requestHash: 'a'.repeat(64), metadata: { attributionKey: 'attribution-key', milestone: 'signup', programVersion: 'v1' }, createdAt: at };
const proposed = { referredUserKey: 'referred', normalizedCode: rawCode.code, attribution: { key: 'attribution-key', referredUserKey: 'referred', programVersion: 'v1' as const, createdAt: at }, signup: { rewardKey: 'reward-key', transactionKey: 'transaction-key', microSparks: 50_000_000, createdAt: at } };
const cursor = (next?: unknown, all: unknown[] = []) => ({ next: async () => next, all: async () => all });

describe('referral repository', () => {
  test('reads an existing code and summary without writes and fails clearly when the code invariant is missing', async () => {
    const queries: string[] = [];
    const database: ReferralDatabase = { query: async (query) => {
      queries.push(query);
      return cursor({ code: rawCode, attributionCount: 2, signupRewardCount: 2, paidRewardCount: 1, earnedMicroSparks: 200_000_000 });
    } };
    await expect(createArangoReferralRepository(database).readSummary('referrer')).resolves.toMatchObject({ code: { key: 'code-key' }, attributionCount: 2 });
    expect(queries.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|REMOVE|UPSERT|REPLACE)\b/);

    const missing = createArangoReferralRepository({ query: async () => cursor() });
    await expect(missing.readSummary('referrer')).rejects.toEqual(new ReferralRepositoryError('REFERRAL_CODE_MISSING', 'Referral code invariant is missing for user referrer.'));
  });

  test('atomically persists first attribution, reward, balance, and ledger with public model keys', async () => {
    const declarations: unknown[] = [], queries: Array<{ query: string; bind?: Record<string, unknown> }> = [];
    const transact: ReferralTransactionRunner = async (collections, operation) => {
      declarations.push(collections);
      let call = 0;
      return operation({ query: async (query, bind) => {
        queries.push({ query, bind });
        call += 1;
        if (call === 1) return cursor();
        if (call === 2) return cursor(rawCode);
        if (call === 3) return cursor(true);
        if (call === 4) return cursor(rawAttribution);
        if (call === 5) return cursor();
        return cursor({ ledger: rawTransaction, reward: rawReward });
      } });
    };
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral(proposed)).resolves.toMatchObject({ status: 'applied', attribution: { key: 'attribution-key' }, reward: { key: 'reward-key' } });
    expect(declarations).toEqual([{ read: ['referralCodes'], write: ['users', 'referralAttributions', 'referralRewards', 'sparkTransactions'] }]);
    expect(queries[5]!.query).toContain('UPDATE user WITH { microSparkBalance: nextBalance, microSparkDebt: previousDebt - debtPayment }');
    expect(queries[5]!.query).toContain('INTO sparkTransactions');
    expect(queries[5]!.query).toContain('INTO referralRewards');
    expect(queries[5]!.bind?.sparkTransaction).toMatchObject({ _key: 'transaction-key', kind: 'referral-reward', idempotencyKey: 'referral-reward:v1:attribution-key:signup' });
    expect(queries[5]!.bind?.reward).toMatchObject({ _key: 'reward-key', attributionKey: 'attribution-key' });
  });

  test('keeps the first attribution immutable and replays its reward without resolving a later code', async () => {
    let calls = 0;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++calls === 1 ? rawAttribution : rawReward) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral({ ...proposed, normalizedCode: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF' })).resolves.toMatchObject({ status: 'replayed', attribution: { referrerUserKey: 'referrer' } });
    expect(calls).toBe(2);
  });

  test('rejects self-referral before attribution or Spark writes', async () => {
    let calls = 0;
    const selfCode = { ...rawCode, ownerUserKey: 'referred' };
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++calls === 1 ? undefined : selfCode) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral(proposed)).rejects.toEqual(new ReferralRepositoryError('SELF_REFERRAL', 'A user cannot refer themselves.'));
    expect(calls).toBe(2);
  });

  test('returns a no-attribution result for future settlement callers', async () => {
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor() });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyFirstPaidReward({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', rewardKey: 'reward', transactionKey: 'transaction', createdAt: at, microSparks: 100_000_000 })).resolves.toEqual({ status: 'not-attributed' });
  });

  test('binds the first-paid reward and deterministic Spark identity to the qualifying payment', async () => {
    const paidReward = { ...rawReward, _key: 'paid-reward', milestone: 'first-paid', microSparks: 100_000_000, sparkTransactionKey: 'paid-transaction', qualifyingPaymentKey: 'payment-1' };
    const paidTransaction = { ...rawTransaction, _key: 'paid-transaction', deltaMicroSparks: 100_000_000, balanceAfterMicroSparks: 100_000_000, idempotencyKey: 'referral-reward:v1:attribution-key:first-paid', metadata: { attributionKey: 'attribution-key', milestone: 'first-paid', programVersion: 'v1', qualifyingPaymentKey: 'payment-1' } };
    let call = 0, write: Record<string, unknown> | undefined;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async (_query, bind) => {
      call += 1;
      if (call === 1) return cursor(rawAttribution);
      if (call === 2) return cursor();
      if (call === 3) return cursor();
      write = bind;
      return cursor({ ledger: { ...paidTransaction, requestHash: (bind?.sparkTransaction as Record<string, unknown>).requestHash }, reward: paidReward });
    } });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyFirstPaidReward({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', rewardKey: 'paid-reward', transactionKey: 'paid-transaction', createdAt: at, microSparks: 100_000_000 })).resolves.toMatchObject({ status: 'applied', reward: { milestone: 'first-paid', qualifyingPaymentKey: 'payment-1' } });
    expect(write?.sparkTransaction).toMatchObject({
      idempotencyKey: 'referral-reward:v1:attribution-key:first-paid',
      requestHash: createHash('sha256').update(['attribution-key', 'first-paid', 'v1', 'payment-1', 100_000_000].join('\0')).digest('hex'),
      metadata: { qualifyingPaymentKey: 'payment-1' },
    });
  });

  test('does not allow one qualifying payment to reward multiple attributions', async () => {
    const otherReward = { ...rawReward, milestone: 'first-paid', attributionKey: 'other-attribution', qualifyingPaymentKey: 'payment-1' };
    let call = 0;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++call === 1 ? rawAttribution : otherReward) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyFirstPaidReward({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', rewardKey: 'paid-reward', transactionKey: 'paid-transaction', createdAt: at, microSparks: 100_000_000 })).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_USED' });
    expect(call).toBe(2);
  });
});
