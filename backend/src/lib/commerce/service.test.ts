import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { newId } from '@/lib/ids';
import { COMMERCE_CATALOG } from './catalog';
import { createCommerceService } from './service';
import type { CommerceRepository } from './repository';
import type { PaymentCheckout, PaymentOrder, Subscription } from './contracts';
import { PolarProviderError } from './polar';

function repository(overrides: Partial<CommerceRepository> = {}): CommerceRepository {
  return {
    userExists: async () => true,
    listProducts: async () => [...COMMERCE_CATALOG],
    getProductByProductId: async (productId) => {
      const product = COMMERCE_CATALOG.find((item) => item.productId === productId);
      if (!product) return null;
      if (productId === 'nova.weekly') return { ...product, providerProductId: 'remote-weekly' };
      if (productId === 'topup.small') return { ...product, providerProductId: 'remote-topup' };
      return product;
    },
    getProductByProviderId: async (id) => id === 'remote-weekly' ? { ...COMMERCE_CATALOG[0], providerProductId: id } : id === 'remote-topup' ? { ...COMMERCE_CATALOG[3], providerProductId: id } : null,
    updateProductProviderId: async () => {},
    claimCheckout: async (input) => ({ status: 'claimed', checkout: input }),
    completeCheckout: async (key, providerCheckoutId, checkoutUrl, updatedAt) => ({ key, userKey: newId(), productKey: COMMERCE_CATALOG[3].key, idempotencyKey: 'idem', requestHash: 'a'.repeat(64), status: 'open', providerCheckoutId, checkoutUrl, failureCode: null, createdAt: updatedAt, updatedAt }),
    markCheckoutCompleted: async () => null,
    markCheckoutFailed: async () => null,
    failCheckout: async () => {},
    listRecoverablePendingCheckouts: async () => [],
    getCurrentSubscription: async () => null,
    listSubscriptionsByUser: async () => [],
    upsertSubscription: async (input) => ({ status: 'applied', subscription: input }),
    fulfillPaidOrder: async (input) => ({ status: 'applied', order: { key: newId(), providerOrderId: input.providerOrderId, userKey: input.userKey, productKey: input.productKey, providerSubscriptionId: input.providerSubscriptionId, amountCents: input.amountCents, baseAmountCents: input.baseAmountCents, netAmountCents: input.netAmountCents, grantMicroSparks: input.grantMicroSparks, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: input.paidAt, refundedAt: null, createdAt: input.occurredAt, updatedAt: input.occurredAt } }),
    applyOrderRefund: async () => null,
    ...overrides,
  };
}

const at = '2026-09-05T10:00:00.000Z';
const makeOrderForRefund = (): PaymentOrder => ({ key: newId(), providerOrderId: 'order-1', userKey: newId(), productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: null, amountCents: 799, baseAmountCents: 799, netAmountCents: 799, grantMicroSparks: 200_000_000, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: at, refundedAt: null, createdAt: at, updatedAt: at });

describe('canonical commerce service', () => {
  test('lists active safe products only and creates idempotent provider checkout', async () => {
    const userKey = newId(); let claimed: PaymentCheckout | undefined; let providerInput: unknown;
    const service = createCommerceService({
      repository: repository({ listProducts: async () => COMMERCE_CATALOG.filter((product) => product.active), getProductByProductId: async () => ({ ...COMMERCE_CATALOG[3], providerProductId: 'remote-topup' }), claimCheckout: async (input) => { claimed = input; return { status: 'claimed', checkout: input }; } }),
      provider: { listProducts: async () => [], createCheckout: async (input: Parameters<NonNullable<Parameters<typeof createCommerceService>[0]['provider']>['createCheckout']>[0]) => { providerInput = input; return { id: 'checkout-1', url: 'https://polar.sh/checkout/1', status: 'open' }; }, updateSubscription: async () => { throw new Error('unused'); }, createProduct: async () => { throw new Error('unused'); }, updateProduct: async () => { throw new Error('unused'); } } as never,
      now: () => new Date(at), createKey: newId,
    });
    const products = await service.listProducts();
    expect(products).toHaveLength(3);
    expect(products[0]).not.toHaveProperty('providerProductId');
    await expect(service.createCheckout({ productId: 'topup.small' }, userKey, 'request-1', '203.0.113.7')).resolves.toMatchObject({ status: 'open', url: 'https://polar.sh/checkout/1' });
    expect(claimed).toMatchObject({ userKey, idempotencyKey: 'request-1', status: 'pending' });
    expect(providerInput).toMatchObject({ userKey, productId: 'topup.small', providerProductId: 'remote-topup', idempotencyKey: `checkout:${createHash('sha256').update(`${userKey}\u0000request-1`).digest('hex')}` });
    expect(providerInput).toMatchObject({ successUrl: 'https://vorinthex.com/checkout/success', returnUrl: 'https://vorinthex.com/checkout/error', customerIpAddress: '203.0.113.7' });
  });

  test('replays completed checkout, rejects inactive products, and leaves uncertain provider failures recoverable', async () => {
    const userKey = newId(), checkoutKey = newId();
    const open = { key: checkoutKey, userKey, productKey: COMMERCE_CATALOG[3].key, idempotencyKey: 'idem', requestHash: 'a'.repeat(64), status: 'open', providerCheckoutId: 'remote', checkoutUrl: 'https://polar.sh/x', failureCode: null, createdAt: at, updatedAt: at } satisfies PaymentCheckout;
    const replay = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[3], providerProductId: 'remote' }), claimCheckout: async () => ({ status: 'replayed', checkout: open }) }) });
    await expect(replay.createCheckout({ productId: 'topup.small' }, userKey, 'idem')).resolves.toMatchObject({ key: checkoutKey });
    const inactive = createCommerceService({ repository: repository({ getProductByProductId: async () => COMMERCE_CATALOG[1] }) });
    await expect(inactive.createCheckout({ productId: 'nova.monthly' }, userKey, 'idem')).rejects.toMatchObject({ code: 'PRODUCT_INACTIVE' });
    let failure: string | undefined;
    const failed = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[3], providerProductId: 'remote' }), failCheckout: async (_key, code) => { failure = code; } }), provider: { listProducts: async () => [], createCheckout: async () => { throw new Error('network'); }, updateSubscription: async () => { throw new Error('unused'); }, createProduct: async () => { throw new Error('unused'); }, updateProduct: async () => { throw new Error('unused'); } } as never });
    await expect(failed.createCheckout({ productId: 'topup.small' }, userKey, 'idem')).rejects.toThrow('network');
    expect(failure).toBeUndefined();
    const rejected = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[3], providerProductId: 'remote' }), failCheckout: async (_key, code) => { failure = code; } }), provider: { createCheckout: async () => { throw new PolarProviderError('REJECTED', 'rejected', false, 422); } } as never });
    await expect(rejected.createCheckout({ productId: 'topup.small' }, userKey, 'rejected')).rejects.toThrow('rejected');
    expect(failure).toBe('REJECTED');
  });

  test('recovers stale pending checkout through the canonical provider-idempotent creation path', async () => {
    const userKey = newId();
    const pending = { key: newId(), userKey, productKey: COMMERCE_CATALOG[3].key, idempotencyKey: 'original-key', requestHash: createHash('sha256').update(`${userKey}\u0000topup.small`).digest('hex'), status: 'pending', providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: at, updatedAt: at } satisfies PaymentCheckout;
    const providerKeys: string[] = [];
    const service = createCommerceService({
      repository: repository({ listRecoverablePendingCheckouts: async () => [{ checkout: pending, productId: 'topup.small' }] }),
      provider: { createCheckout: async (input: { idempotencyKey: string }) => { providerKeys.push(input.idempotencyKey); return { id: 'remote-checkout', status: 'open', url: 'https://polar.sh/recovered' }; } } as never,
    });
    await expect(service.recoverUserPendingCheckouts(userKey, '2026-09-06T09:55:00.000Z')).resolves.toEqual({ recovered: 1 });
    expect(providerKeys).toEqual([`checkout:${createHash('sha256').update(`${userKey}\u0000original-key`).digest('hex')}`]);
  });

  test('namespaces the provider idempotency key by trusted user', async () => {
    const keys: string[] = [];
    const service = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[3], providerProductId: 'remote' }) }), provider: { listProducts: async () => [], createCheckout: async (input: { idempotencyKey: string }) => { keys.push(input.idempotencyKey); return { id: newId(), status: 'open', url: 'https://polar.sh/x' }; }, updateSubscription: async () => { throw new Error('unused'); }, createProduct: async () => { throw new Error('unused'); }, updateProduct: async () => { throw new Error('unused'); } } as never });
    await service.createCheckout({ productId: 'topup.small' }, newId(), 'same-client-key');
    await service.createCheckout({ productId: 'topup.small' }, newId(), 'same-client-key');
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  test('rejects a second subscription checkout at the transactional claim boundary', async () => {
    const userKey = newId();
    const service = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[0], providerProductId: 'remote-weekly' }), claimCheckout: async (checkout) => ({ status: 'subscription_exists', checkout }) }) });
    await expect(service.createCheckout({ productId: 'nova.weekly' }, userKey, 'second-subscription')).rejects.toMatchObject({ code: 'SUBSCRIPTION_EXISTS' });
  });

  test('fulfills duplicate and recurring paid orders exactly once at repository boundary and invokes referral idempotently', async () => {
    const userKey = newId(); const calls: string[] = []; let fulfillments = 0;
    const makeOrder = (providerOrderId: string): PaymentOrder => ({ key: newId(), providerOrderId, userKey, productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: 'subscription-1', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, grantMicroSparks: 200_000_000, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: at, refundedAt: null, createdAt: at, updatedAt: at });
    const orders = new Map<string, PaymentOrder>();
    const service = createCommerceService({ repository: repository({ fulfillPaidOrder: async (input) => { fulfillments += 1; const existing = orders.get(input.providerOrderId); if (existing) return { status: 'duplicate', order: existing }; const order = makeOrder(input.providerOrderId); orders.set(input.providerOrderId, order); return { status: 'applied', order }; } }), applyFirstPaidReward: async (user, payment) => { calls.push(`${user}:${payment}`); return { status: 'not-attributed' }; }, now: () => new Date(at) });
    const event = (id: string, billingReason: 'subscription_create' | 'subscription_cycle' = 'subscription_cycle') => ({ type: 'order.paid', timestamp: at, data: { id, product_id: 'remote-weekly', subscription_id: 'subscription-1', billing_reason: billingReason, subtotal_amount: 799, discount_amount: 0, net_amount: 799, total_amount: 863, tax_amount: 64, currency: 'USD', customer: { external_id: userKey }, metadata: { userKey, productId: 'nova.weekly' }, product: { id: 'remote-weekly', metadata: { productId: 'nova.weekly' } } } });
    await service.processWebhook(event('invoice-1', 'subscription_create'));
    await service.processWebhook(event('invoice-1'));
    await service.processWebhook(event('invoice-2'));
    expect(fulfillments).toBe(3);
    expect(orders.size).toBe(2);
    expect(calls).toHaveLength(3);
    expect(orders.get('invoice-1')).toMatchObject({ amountCents: 799 });
  });

  test('canonically grants top-ups and initial, weekly, and monthly subscription orders', async () => {
    const userKey = newId();
    const fulfillments: Array<{ productId: string; billingReason?: string; grantMicroSparks: number; providerSubscriptionId: string | null }> = [];
    const service = createCommerceService({
      repository: repository({ fulfillPaidOrder: async (input) => {
        fulfillments.push({ productId: input.productId, grantMicroSparks: input.grantMicroSparks, providerSubscriptionId: input.providerSubscriptionId });
        return repository().fulfillPaidOrder(input);
      } }),
      applyFirstPaidReward: async () => ({ status: 'not-attributed' }),
    });
    const paid = (overrides: Record<string, unknown>) => ({ providerOrderId: newId(), userKey, productId: 'nova.weekly', providerSubscriptionId: 'sub-1', billingReason: 'subscription_cycle', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, discountAmountCents: 0, currency: 'USD', paidAt: at, ...overrides });

    await service.applyPaidOrderFacts(paid({ providerOrderId: 'topup-1', productId: 'topup.small', providerSubscriptionId: null, billingReason: 'purchase', amountCents: 999, baseAmountCents: 999, netAmountCents: 999 }));
    await service.applyPaidOrderFacts(paid({ providerOrderId: 'weekly-initial', billingReason: 'subscription_create' }));
    await service.applyPaidOrderFacts(paid({ providerOrderId: 'weekly-renewal' }));
    await service.applyPaidOrderFacts(paid({ providerOrderId: 'monthly-renewal', productId: 'nova.monthly', providerSubscriptionId: 'sub-2', amountCents: 2499, baseAmountCents: 2499, netAmountCents: 2499 }));

    expect(fulfillments).toEqual([
      { productId: 'topup.small', grantMicroSparks: 200_000_000, providerSubscriptionId: null },
      { productId: 'nova.weekly', grantMicroSparks: 200_000_000, providerSubscriptionId: 'sub-1' },
      { productId: 'nova.weekly', grantMicroSparks: 200_000_000, providerSubscriptionId: 'sub-1' },
      { productId: 'nova.monthly', grantMicroSparks: 1_000_000_000, providerSubscriptionId: 'sub-2' },
    ]);
  });

  test('rejects unsupported billing reasons and fails closed on a persisted grant mismatch', async () => {
    const userKey = newId(); let writes = 0;
    const service = createCommerceService({ repository: repository({ fulfillPaidOrder: async (input) => { writes += 1; return repository().fulfillPaidOrder(input); } }) });
    const subscription = { providerOrderId: 'order-1', userKey, productId: 'nova.weekly', providerSubscriptionId: 'sub-1', billingReason: 'subscription_cycle', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, discountAmountCents: 0, currency: 'USD', paidAt: at };
    for (const billingReason of ['purchase', 'subscription_update', 'meter', 'subscription_meter_cycle']) {
      await expect(service.applyPaidOrderFacts({ ...subscription, billingReason })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    }
    const topup = { ...subscription, productId: 'topup.small', providerSubscriptionId: null, amountCents: 999, baseAmountCents: 999, netAmountCents: 999 };
    await expect(service.applyPaidOrderFacts({ ...topup, billingReason: 'subscription_cycle' })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    const mismatched = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[0], sparkGrantMicroSparks: 1 }) }) });
    await expect(mismatched.applyPaidOrderFacts(subscription)).rejects.toThrow('does not match the canonical costs rule');
    expect(writes).toBe(0);
  });

  test('rejects disagreement between provider product identity and canonical metadata identity', async () => {
    const service = createCommerceService({ repository: repository({ getProductByProductId: async () => ({ ...COMMERCE_CATALOG[0], providerProductId: 'expected-provider-product' }) }) });
    await expect(service.applyPaidOrderFacts({ providerOrderId: 'order-1', userKey: newId(), productId: 'nova.weekly', providerProductId: 'different-provider-product', providerSubscriptionId: 'sub-1', billingReason: 'subscription_cycle', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, discountAmountCents: 0, currency: 'USD', paidAt: at })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  test('deduplicates a midnight webhook/reconciliation race but grants a later cycle order', async () => {
    const userKey = newId(); const orders = new Map<string, PaymentOrder>(); let grants = 0;
    const service = createCommerceService({ repository: repository({ fulfillPaidOrder: async (input) => {
      const existing = orders.get(input.providerOrderId);
      if (existing) return { status: 'duplicate', order: existing };
      grants += 1;
      const order: PaymentOrder = { key: newId(), providerOrderId: input.providerOrderId, userKey: input.userKey, productKey: input.productKey, providerSubscriptionId: input.providerSubscriptionId, amountCents: input.amountCents, baseAmountCents: input.baseAmountCents, netAmountCents: input.netAmountCents, grantMicroSparks: input.grantMicroSparks, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: input.paidAt, refundedAt: null, createdAt: input.occurredAt, updatedAt: input.occurredAt };
      orders.set(input.providerOrderId, order);
      return { status: 'applied', order };
    } }), applyFirstPaidReward: async () => ({ status: 'not-attributed' }) });
    const midnight = '2026-01-18T00:00:00.000Z';
    const facts = { providerOrderId: 'same-order', userKey, productId: 'nova.weekly', providerSubscriptionId: 'subscription-1', billingReason: 'subscription_cycle', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, discountAmountCents: 0, currency: 'USD', paidAt: midnight };
    const event = { type: 'order.paid', timestamp: midnight, data: { id: 'same-order', product_id: 'remote-weekly', subscription_id: 'subscription-1', billing_reason: 'subscription_cycle', subtotal_amount: 799, discount_amount: 0, net_amount: 799, total_amount: 799, currency: 'USD', customer: { external_id: userKey }, metadata: { userKey, productId: 'nova.weekly' } } };
    const results = await Promise.all([service.processWebhook(event), service.applyPaidOrderFacts(facts)]);
    expect(results.map((result) => 'fulfillment' in result ? result.fulfillment : result.status).sort()).toEqual(['applied', 'duplicate']);
    await service.applyPaidOrderFacts({ ...facts, providerOrderId: 'later-cycle-order' });
    expect(grants).toBe(2);
  });

  test('projects cumulative partial and full refunds and fails unknown critical references retryably', async () => {
    let refunded = 0;
    const order = { ...makeOrderForRefund(), status: 'partially_refunded' as const };
    const service = createCommerceService({ repository: repository({ applyOrderRefund: async () => { refunded += 1; return { status: 'applied', order }; } }), reverseFirstPaidReward: async () => 'not-found' });
    await expect(service.processWebhook({ type: 'order.refunded', timestamp: at, data: { id: 'order-1', status: 'partially_refunded', refunded_amount: 400 } })).resolves.toMatchObject({ refund: 'applied', status: 'partially_refunded' });
    expect(refunded).toBe(1);
    const unknown = createCommerceService({ repository: repository() });
    await expect(unknown.processWebhook({ type: 'order.refunded', timestamp: at, data: { id: 'missing', status: 'refunded', refunded_amount: 799 } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  test('shares canonical cumulative refund handling with reconciliation callers', async () => {
    const calls: unknown[] = [];
    const order = { ...makeOrderForRefund(), status: 'refunded' as const, refundedAmountCents: 799 };
    const service = createCommerceService({ repository: repository({ applyOrderRefund: async (...input) => { calls.push(input); return { status: 'applied', order }; } }), reverseFirstPaidReward: async () => 'applied' });
    await expect(service.applyRefundFacts({ providerOrderId: 'order-1', refundedAmountCents: 799, refundedAt: at })).resolves.toMatchObject({ status: 'applied' });
    expect(calls).toEqual([['order-1', 799, at]]);
  });

  test('completes known checkout lifecycle events and rejects unknown completed checkouts', async () => {
    const checkout = { key: newId() } as PaymentCheckout;
    const failures: string[] = [];
    const service = createCommerceService({ repository: repository({ markCheckoutCompleted: async (id) => id === 'checkout-1' ? checkout : null, markCheckoutFailed: async (id, code) => { failures.push(`${id}:${code}`); return checkout; } }) });
    await expect(service.processWebhook({ type: 'checkout.updated', timestamp: at, data: { id: 'checkout-1', status: 'succeeded' } })).resolves.toEqual({ processed: true, checkout: 'completed' });
    await expect(service.processWebhook({ type: 'checkout.updated', timestamp: at, data: { id: 'checkout-1', status: 'confirmed' } })).resolves.toEqual({ ignored: true });
    await expect(service.processWebhook({ type: 'checkout.expired', timestamp: at, data: { id: 'checkout-1' } })).resolves.toEqual({ processed: true, checkout: 'failed' });
    expect(failures).toEqual(['checkout-1:expired']);
    await expect(service.processWebhook({ type: 'checkout.updated', timestamp: at, data: { id: 'missing', status: 'succeeded' } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });

  test('ignores signed commerce facts for a user that has been hard deleted', async () => {
    let writes = 0;
    const service = createCommerceService({ repository: repository({ userExists: async () => false, fulfillPaidOrder: async (input) => { writes += 1; return repository().fulfillPaidOrder(input); }, upsertSubscription: async (input) => { writes += 1; return { status: 'applied', subscription: input }; } }) });
    const userKey = newId();
    await expect(service.applyPaidOrderFacts({ providerOrderId: 'deleted-order', userKey, productId: 'nova.weekly', providerProductId: 'remote-weekly', providerSubscriptionId: 'sub-1', billingReason: 'subscription_cycle', amountCents: 799, baseAmountCents: 799, netAmountCents: 799, discountAmountCents: 0, currency: 'USD', paidAt: at })).resolves.toEqual({ status: 'ignored_deleted_user' });
    await expect(service.applySubscriptionFacts({ providerSubscriptionId: 'sub-1', userKey, productId: 'nova.weekly', providerProductId: 'remote-weekly', status: 'canceled', cancelAtPeriodEnd: false, currentPeriodStart: null, currentPeriodEnd: null, providerModifiedAt: at, occurredAt: at })).resolves.toEqual({ status: 'ignored_deleted_user' });
    expect(writes).toBe(0);
  });

  test('persists subscription lifecycle and cancel/restore transitions while hiding provider IDs', async () => {
    const userKey = newId(); let current: Subscription = { key: newId(), userKey, productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: 'subscription-1', status: 'active', cancelAtPeriodEnd: false, currentPeriodStart: at, currentPeriodEnd: '2026-09-12T10:00:00.000Z', providerModifiedAt: null, createdAt: at, updatedAt: at };
    const service = createCommerceService({ repository: repository({ getCurrentSubscription: async () => current, upsertSubscription: async (input) => ({ status: 'applied', subscription: current = input }) }), provider: { listProducts: async () => [], createCheckout: async () => { throw new Error('unused'); }, updateSubscription: async (_id: string, cancel: boolean) => ({ id: 'subscription-1', status: 'active', cancel_at_period_end: cancel, current_period_start: current.currentPeriodStart!, current_period_end: current.currentPeriodEnd!, modified_at: '2026-09-05T09:59:59.000Z' }), createProduct: async () => { throw new Error('unused'); }, updateProduct: async () => { throw new Error('unused'); } } as never, now: () => new Date(at) });
    expect(await service.setCancellation(userKey, true)).toMatchObject({ cancelAtPeriodEnd: true });
    expect(current.providerModifiedAt).toBe('2026-09-05T09:59:59.000Z');
    expect(await service.setCancellation(userKey, false)).toMatchObject({ cancelAtPeriodEnd: false });
    expect(await service.getCurrentSubscription(userKey)).not.toHaveProperty('providerSubscriptionId');
    await expect(service.processWebhook({ type: 'subscription.canceled', timestamp: at, data: { id: 'subscription-1', status: 'active', product_id: 'remote-weekly', customer: { external_id: userKey }, cancel_at_period_end: true } })).resolves.toMatchObject({ subscription: 'active' });
    expect(current).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    await expect(service.processWebhook({ type: 'subscription.revoked', timestamp: at, data: { id: 'subscription-1', status: 'unpaid', product_id: 'remote-weekly', customer: { external_id: userKey } } })).resolves.toMatchObject({ subscription: 'unpaid' });
    expect(current.status).toBe('unpaid');
  });

  test('revokes every locally billable subscription before account deletion', async () => {
    const userKey = newId(); const revoked: string[] = [];
    const base: Subscription = { key: newId(), userKey, productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: 'active-subscription', status: 'active', cancelAtPeriodEnd: false, currentPeriodStart: at, currentPeriodEnd: at, providerModifiedAt: at, createdAt: at, updatedAt: at };
    const service = createCommerceService({
      repository: repository({ listSubscriptionsByUser: async () => [base, { ...base, key: newId(), providerSubscriptionId: 'past-due-subscription', status: 'past_due' }, { ...base, key: newId(), providerSubscriptionId: 'canceled-subscription', status: 'canceled' }] }),
      provider: { revokeSubscription: async (id: string) => { revoked.push(id); return null; } } as never,
    });
    await expect(service.revokeUserSubscriptions(userKey)).resolves.toEqual({ revoked: 2 });
    expect(revoked).toEqual(['active-subscription', 'past-due-subscription']);
  });

  test('revokes a provider subscription missed by local webhook projection before account deletion', async () => {
    const userKey = newId(); const revoked: string[] = [];
    const remote = { id: 'remote-only-subscription', status: 'active', customer: { external_id: userKey } };
    const service = createCommerceService({ repository: repository({ listSubscriptionsByUser: async () => [] }), provider: { listSubscriptions: async () => [remote], revokeSubscription: async (id: string) => { revoked.push(id); return null; } } as never });
    await expect(service.revokeUserSubscriptions(userKey)).resolves.toEqual({ revoked: 1 });
    expect(revoked).toEqual(['remote-only-subscription']);
  });

  test('allows account deletion without Polar only when no local subscription needs revocation', async () => {
    const userKey = newId();
    const unavailable = () => { throw new PolarProviderError('NOT_CONFIGURED', 'Polar payment operations are not configured.', false); };
    const empty = createCommerceService({ repository: repository({ listSubscriptionsByUser: async () => [] }), createProvider: unavailable });
    await expect(empty.revokeUserSubscriptions(userKey)).resolves.toEqual({ revoked: 0 });

    const active: Subscription = { key: newId(), userKey, productKey: COMMERCE_CATALOG[0].key, providerSubscriptionId: 'active-subscription', status: 'active', cancelAtPeriodEnd: false, currentPeriodStart: at, currentPeriodEnd: at, providerModifiedAt: at, createdAt: at, updatedAt: at };
    const blocked = createCommerceService({ repository: repository({ listSubscriptionsByUser: async () => [active] }), createProvider: unavailable });
    await expect(blocked.revokeUserSubscriptions(userKey)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  test('rejects conflicting signed order references while accepting provider-adjusted totals', async () => {
    const userKey = newId(); let fulfilled = false;
    const service = createCommerceService({ repository: repository({ fulfillPaidOrder: async (input) => { fulfilled = true; return repository().fulfillPaidOrder(input); } }), applyFirstPaidReward: async () => ({ status: 'not-attributed' }) });
    const base = { type: 'order.paid', timestamp: at, data: { id: 'order-1', status: 'paid', product_id: 'remote-weekly', subscription_id: 'subscription-1', billing_reason: 'subscription_cycle', subtotal_amount: 799, discount_amount: 0, net_amount: 799, total_amount: 799, currency: 'usd', customer: { external_id: userKey }, metadata: { userKey, productId: 'nova.weekly' } } };
    await expect(service.processWebhook({ ...base, data: { ...base.data, discount_amount: 699, net_amount: 100, total_amount: 100 } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    expect(fulfilled).toBe(false);
    await expect(service.processWebhook(base)).resolves.toMatchObject({ processed: true });
    await expect(service.processWebhook({ ...base, data: { ...base.data, metadata: { userKey: newId(), productId: 'topup.small' } } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
    await expect(service.processWebhook({ ...base, data: { ...base.data, product_id: 'unknown-product' } })).rejects.toMatchObject({ code: 'INVALID_REFERENCE' });
  });
});
