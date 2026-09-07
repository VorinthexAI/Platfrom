import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { COMMERCE_CATALOG } from './catalog';
import { createArangoCommerceRepository } from './repository';

const cursor = (next: unknown = undefined, all: unknown[] = []) => ({ async next() { return next; }, async all() { return all; } });

describe('commerce Arango repository', () => {
  test('atomically blocks a second recurring checkout', async () => {
    const at = '2026-09-05T10:00:00.000Z'; const userKey = newId(); let calls = 0;
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (collections, operation) => {
      expect(collections).toEqual({ read: ['products', 'subscriptions', 'users'], write: ['paymentCheckouts'] });
       return operation({ async query() { calls += 1; return calls === 1 || calls === 3 ? cursor(true) : cursor(); } });
    });
    const checkout = { key: newId(), userKey, productKey: COMMERCE_CATALOG[0].key, idempotencyKey: 'checkout-1', requestHash: 'a'.repeat(64), status: 'pending' as const, providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: at, updatedAt: at };
    await expect(repository.claimCheckout(checkout)).resolves.toEqual({ status: 'subscription_exists', checkout });
    expect(calls).toBe(3);
  });

  test('does not create a checkout for an account deleted after authentication', async () => {
    const at = '2026-09-05T10:00:00.000Z'; const userKey = newId(); let calls = 0;
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (_collections, operation) => operation({ async query() { calls += 1; return cursor(false); } }));
    const checkout = { key: newId(), userKey, productKey: COMMERCE_CATALOG[0].key, idempotencyKey: 'checkout-1', requestHash: 'a'.repeat(64), status: 'pending' as const, providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: at, updatedAt: at };
    await expect(repository.claimCheckout(checkout)).resolves.toEqual({ status: 'account_missing', checkout });
    expect(calls).toBe(1);
  });

  test('lists only stale pending checkouts for canonical recovery', async () => {
    const userKey = newId();
    const raw = { _key: newId(), userKey, productKey: COMMERCE_CATALOG[3].key, idempotencyKey: 'idem', requestHash: 'a'.repeat(64), status: 'pending', providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' };
    let query = '';
    const repository = createArangoCommerceRepository({ async query(value: string) { query = value; return cursor(undefined, [{ checkout: raw, productId: 'topup.small' }]); } });
    await expect(repository.listRecoverablePendingCheckouts(userKey, '2026-09-05T10:05:00.000Z')).resolves.toMatchObject([{ productId: 'topup.small', checkout: { key: raw._key } }]);
    expect(query).toContain('checkout.status == "pending" && checkout.updatedAt < @pendingCutoff');
  });

  test('atomically links one paid order, purchase transaction, and user balance update', async () => {
    const queries: string[] = []; const declarations: unknown[] = []; let step = 0;
    const database = { async query() { throw new Error('unexpected non-transaction query'); } };
    const repository = createArangoCommerceRepository(database, async (collections, operation) => {
      declarations.push(collections);
      return operation({ async query(query) { queries.push(query); step += 1; return step === 1 ? cursor() : cursor({ ok: true }); } });
    });
    const userKey = newId();
    const result = await repository.fulfillPaidOrder({ providerOrderId: 'order-1', userKey, productKey: COMMERCE_CATALOG[3].key, productId: 'topup.small', providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999, grantMicroSparks: COMMERCE_CATALOG[3].sparkGrantMicroSparks, currency: 'USD', paidAt: '2026-09-05T10:00:00.000Z', occurredAt: '2026-09-05T10:00:00.000Z' });
    expect(result.status).toBe('applied');
    expect(result.order.sparkTransactionKey).not.toBeNull();
    expect(declarations).toEqual([{ write: ['paymentOrders', 'users', 'sparkTransactions'] }]);
    expect(queries[1]).toContain('UPDATE user WITH { microSparkBalance: nextBalance, microSparkDebt: previousDebt - debtPayment } IN users');
    expect(queries[1]).toContain('INTO sparkTransactions');
    expect(queries[1]).toContain('INTO paymentOrders');
  });

  test('returns an existing order before granting again', async () => {
    const raw = { _key: newId(), providerOrderId: 'order-1', userKey: newId(), productKey: COMMERCE_CATALOG[3].key, providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999, grantMicroSparks: 200_000_000, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: '2026-09-05T10:00:00.000Z', refundedAt: null, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' };
    let queries = 0;
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (_collections, operation) => operation({ async query() { queries += 1; return cursor(raw); } }));
    const facts = { providerOrderId: 'order-1', userKey: raw.userKey, productKey: raw.productKey, productId: 'topup.small', providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999, grantMicroSparks: COMMERCE_CATALOG[3].sparkGrantMicroSparks, currency: 'USD' as const, paidAt: raw.paidAt, occurredAt: raw.createdAt };
    await expect(repository.fulfillPaidOrder(facts)).resolves.toMatchObject({ status: 'duplicate' });
    expect(queries).toBe(1);

    for (const conflict of [
      { userKey: newId() },
      { productKey: COMMERCE_CATALOG[0].key },
      { providerSubscriptionId: 'sub-1' },
      { baseAmountCents: 998 },
      { netAmountCents: 998 },
      { amountCents: 1_000 },
      { currency: 'EUR' as 'USD' },
      { grantMicroSparks: facts.grantMicroSparks + 1 },
    ]) await expect(repository.fulfillPaidOrder({ ...facts, ...conflict })).rejects.toThrow('conflicts with immutable paid-order facts');
    expect(queries).toBe(9);
  });

  test('atomically claws back a cumulative partial refund and records uncollectable debt', async () => {
    const raw = { _key: newId(), providerOrderId: 'order-1', userKey: newId(), productKey: COMMERCE_CATALOG[3].key, providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999, grantMicroSparks: 200_000_000, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: '2026-09-05T10:00:00.000Z', refundedAt: null, createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' };
    const queries: Array<{ query: string; binds?: Record<string, unknown> }> = [];
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (collections, operation) => {
      expect(collections.write).toEqual(['paymentOrders', 'users', 'sparkTransactions']);
      let call = 0;
      return operation({ async query(query, binds) { queries.push({ query, binds }); call += 1; return call === 1 ? cursor(raw) : cursor({ ...raw, status: 'partially_refunded', refundedAmountCents: 500, clawedBackMicroSparks: 100_100_100, refundDebtMicroSparks: 50_000_000, refundedAt: raw.updatedAt }); } });
    });
    await expect(repository.applyOrderRefund('order-1', 500, raw.updatedAt)).resolves.toMatchObject({ status: 'applied', order: { status: 'partially_refunded', refundedAmountCents: 500 } });
    expect(queries[1]!.query).toContain('microSparkDebt: priorDebt + debt');
    expect(queries[1]!.query).toContain('INTO sparkTransactions');
  });

  test('ignores duplicate and out-of-order cumulative refunds without another write', async () => {
    const raw = { _key: newId(), providerOrderId: 'order-1', userKey: newId(), productKey: COMMERCE_CATALOG[3].key, providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999, grantMicroSparks: 200_000_000, currency: 'USD', status: 'partially_refunded', sparkTransactionKey: newId(), refundSparkTransactionKeys: [newId()], refundedAmountCents: 500, clawedBackMicroSparks: 100_100_100, refundDebtMicroSparks: 0, paidAt: '2026-09-05T10:00:00.000Z', refundedAt: '2026-09-05T11:00:00.000Z', createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T11:00:00.000Z' };
    let calls = 0;
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (_collections, operation) => operation({ async query() { calls += 1; return cursor(raw); } }));
    await expect(repository.applyOrderRefund('order-1', 500, raw.updatedAt)).resolves.toMatchObject({ status: 'duplicate' });
    await expect(repository.applyOrderRefund('order-1', 400, raw.updatedAt)).resolves.toMatchObject({ status: 'stale' });
    expect(calls).toBe(2);
  });

  test('keeps a newer subscription projection when an older event arrives', async () => {
    const current = { _key: newId(), userKey: newId(), productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: 'sub-1', status: 'canceled', cancelAtPeriodEnd: true, currentPeriodStart: null, currentPeriodEnd: null, providerModifiedAt: '2026-09-05T12:00:00.000Z', createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z' };
    let calls = 0;
    const repository = createArangoCommerceRepository({ async query() { throw new Error('unexpected'); } }, async (_collections, operation) => operation({ async query() { calls += 1; return cursor(current); } }));
    const { _key, ...subscription } = current;
    await expect(repository.upsertSubscription({ ...subscription, key: _key, status: 'active', providerModifiedAt: '2026-09-05T11:00:00.000Z', updatedAt: '2026-09-05T11:00:00.000Z' })).resolves.toMatchObject({ status: 'stale', subscription: { status: 'canceled' } });
    expect(calls).toBe(1);
  });
});
