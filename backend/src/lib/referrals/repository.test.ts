import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createArangoReferralRepository, ReferralRepositoryError, type ReferralDatabase, type ReferralTransactionRunner } from './repository';

const at = '2026-09-05T10:00:00.000Z';
const rawCode = { _key: 'code-key', ownerUserKey: 'referrer', programVersion: 'v1', code: '0123456789AB', createdAt: at };
const rawAttribution = { _key: 'attribution-key', referralCodeKey: 'code-key', referrerUserKey: 'referrer', referredUserKey: 'referred', programVersion: 'v1', createdAt: at };
const rawReward = { _key: 'reward-key', attributionKey: 'attribution-key', referrerUserKey: 'referrer', referredUserKey: 'referred', milestone: 'signup', programVersion: 'v1', microSparks: 50_000_000, sparkTransactionKey: 'transaction-key', createdAt: at };
const rawTransaction = { _key: 'transaction-key', userKey: 'referrer', kind: 'referral-reward', deltaMicroSparks: 50_000_000, balanceAfterMicroSparks: 50_000_000, idempotencyKey: 'referral-reward:v1:attribution-key:signup', requestHash: 'a'.repeat(64), metadata: { attributionKey: 'attribution-key', milestone: 'signup', programVersion: 'v1' }, createdAt: at };
const proposed = { referredUserKey: 'referred', normalizedCode: rawCode.code, attribution: { key: 'attribution-key', referredUserKey: 'referred', programVersion: 'v1' as const, createdAt: at }, signup: { rewardKey: 'reward-key', transactionKey: 'transaction-key', microSparks: 50_000_000, createdAt: at }, firstPaid: { rewardKey: 'paid-reward-key', transactionKey: 'paid-transaction-key', microSparks: 100_000_000, createdAt: at } };
const cursor = (next?: unknown, all: unknown[] = []) => ({ next: async () => next, all: async () => all });

describe('referral repository', () => {
  test('reads an existing code and summary without writes and fails clearly when the code invariant is missing', async () => {
    const queries: string[] = [];
    const database: ReferralDatabase = { query: async (query) => {
      queries.push(query);
      return cursor({ code: rawCode, attributionCount: 2, signupRewardCount: 2, paidRewardCount: 1, earnedMicroSparks: 200_000_000, invitees: [{ displayName: 'Invited Friend', signupRewardEarned: true, firstPaidRewardStatus: 'earned' }] });
    } };
    await expect(createArangoReferralRepository(database).readSummary('referrer')).resolves.toMatchObject({ code: { key: 'code-key' }, attributionCount: 2, invitees: [{ displayName: 'Invited Friend', signupRewardEarned: true, firstPaidRewardStatus: 'earned' }] });
    expect(queries.join('\n')).not.toMatch(/\b(?:INSERT|UPDATE|REMOVE|UPSERT|REPLACE)\b/);
    expect(queries.join('\n')).not.toContain('user.email');
    expect(queries.join('\n')).not.toContain('user.name');
    expect(queries.join('\n')).toContain('item.milestone == "first-paid" && item.reversedAt == null');

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
        if (call === 1) return cursor(rawCode);
        if (call === 2) return cursor(true);
        if (call === 3) return cursor();
        if (call === 4) return cursor(rawAttribution);
        if (call === 5) return cursor();
        if (call === 6) return cursor({ ledger: rawTransaction, reward: rawReward });
        return cursor();
      } });
    };
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral(proposed)).resolves.toMatchObject({ status: 'applied', attribution: { key: 'attribution-key' }, reward: { key: 'reward-key' } });
    expect(declarations).toEqual([{ read: ['referralCodes'], write: ['users', 'referralAttributions', 'referralRewards', 'sparkTransactions', 'paymentOrders'] }]);
    expect(queries[5]!.query).toContain('UPDATE user WITH { microSparkBalance: nextBalance, microSparkDebt: previousDebt - debtPayment }');
    expect(queries[5]!.query).toContain('INTO sparkTransactions');
    expect(queries[5]!.query).toContain('INTO referralRewards');
    expect(queries[5]!.bind?.sparkTransaction).toMatchObject({ _key: 'transaction-key', kind: 'referral-reward', idempotencyKey: 'referral-reward:v1:attribution-key:signup' });
    expect(queries[5]!.bind?.reward).toMatchObject({ _key: 'reward-key', attributionKey: 'attribution-key' });
  });

  test('keeps the first attribution immutable and replays only the same code', async () => {
    let calls = 0;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++calls === 1 ? rawCode : calls === 2 ? true : calls === 3 ? rawAttribution : calls === 4 ? rawReward : undefined) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral(proposed)).resolves.toMatchObject({ status: 'replayed', attribution: { referrerUserKey: 'referrer' } });
    expect(calls).toBe(5);
  });

  test('rejects replacing an existing attribution with another valid code', async () => {
    const otherCode = { ...rawCode, _key: 'other-code-key', code: 'ABCDEF012345', ownerUserKey: 'other-referrer' };
    let calls = 0;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++calls === 1 ? otherCode : calls === 2 ? true : rawAttribution) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);

    await expect(repository.completeVerifiedReferral({ ...proposed, normalizedCode: otherCode.code })).rejects.toEqual(new ReferralRepositoryError('ALREADY_ATTRIBUTED', 'A different referral code is already applied to this account.'));
  });

  test('backfills the first-paid milestone when subscription settlement preceded attribution', async () => {
    const paidReward = { ...rawReward, _key: 'paid-reward-key', milestone: 'first-paid', microSparks: 100_000_000, sparkTransactionKey: 'paid-transaction-key', qualifyingPaymentKey: 'payment-1' };
    let calls = 0;
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async (_query, bind) => {
      calls += 1;
      if (calls === 1) return cursor(rawCode);
      if (calls === 2) return cursor(true);
      if (calls === 3) return cursor(rawAttribution);
      if (calls === 4) return cursor(rawReward);
      if (calls === 5) return cursor('payment-1');
      if (calls === 6) return cursor();
      const transaction = bind?.sparkTransaction as Record<string, unknown>;
      return cursor({ ledger: { ...rawTransaction, ...transaction, _key: transaction._key, balanceAfterMicroSparks: 150_000_000 }, reward: paidReward });
    } });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);

    await expect(repository.completeVerifiedReferral(proposed)).resolves.toMatchObject({ status: 'replayed', reward: { milestone: 'signup' } });
    expect(calls).toBe(7);
  });

  test('rejects self-referral before attribution or Spark writes', async () => {
    let calls = 0;
    const selfCode = { ...rawCode, ownerUserKey: 'referred' };
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => { calls += 1; return cursor(selfCode); } });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.completeVerifiedReferral(proposed)).rejects.toEqual(new ReferralRepositoryError('SELF_REFERRAL', 'A user cannot refer themselves.'));
    expect(calls).toBe(1);
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
      if (call === 2) return cursor(true);
      if (call === 3) return cursor();
      if (call === 4) return cursor();
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
    const transact: ReferralTransactionRunner = async (_collections, operation) => operation({ query: async () => cursor(++call === 1 ? rawAttribution : call === 2 ? true : otherReward) });
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyFirstPaidReward({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', rewardKey: 'paid-reward', transactionKey: 'paid-transaction', createdAt: at, microSparks: 100_000_000 })).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_USED' });
    expect(call).toBe(3);
  });

  test('rejects a first-paid reward when the payment is missing, belongs to another user, or is fully refunded', async () => {
    const transact: ReferralTransactionRunner = async (collections, operation) => {
      expect(collections).toEqual({ write: ['users', 'referralAttributions', 'referralRewards', 'sparkTransactions', 'paymentOrders'] });
      let call = 0;
      return operation({ query: async () => cursor(++call === 1 ? rawAttribution : undefined) });
    };
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);
    await expect(repository.applyFirstPaidReward({ referredUserKey: 'referred', qualifyingPaymentKey: 'payment-1', rewardKey: 'reward', transactionKey: 'transaction', createdAt: at, microSparks: 100_000_000 })).resolves.toEqual({ status: 'not-eligible' });
  });

  test('atomically reverses a first-paid reward and returns its referrer for invalidation', async () => {
    const paidReward = { ...rawReward, _key: 'paid-reward', milestone: 'first-paid', microSparks: 100_000_000, qualifyingPaymentKey: 'payment-1' };
    const queries: Array<{ query: string; bind?: Record<string, unknown> }> = [];
    let call = 0;
    const transact: ReferralTransactionRunner = async (collections, operation) => {
      expect(collections).toEqual({ write: ['users', 'referralRewards', 'sparkTransactions'] });
      return operation({ query: async (query, bind) => {
        queries.push({ query, bind });
        call += 1;
        return cursor(call === 1 ? paidReward : true);
      } });
    };
    const repository = createArangoReferralRepository({ query: async () => cursor() }, transact);

    await expect(repository.reverseFirstPaidReward('payment-1', at)).resolves.toEqual({ status: 'applied', referrerUserKey: 'referrer' });
    expect(queries[1]!.query).toContain('microSparkDebt: priorDebt + debt');
    expect(queries[1]!.query).toContain('INTO sparkTransactions');
    expect(queries[1]!.query).toContain('IN referralRewards');
  });
});
