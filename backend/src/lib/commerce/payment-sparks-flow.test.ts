import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { processPolarWebhookJob } from '@/lib/automations/polar-webhook-queue';
import { reconcileCommerceDay } from '@/lib/automations/commerce-reconciliation';
import { COMMERCE_CATALOG } from './catalog';
import type { PaymentOrder, Subscription } from './contracts';
import type { CommerceRepository } from './repository';
import { createCommerceService } from './service';

describe('payment to Sparks integration', () => {
  test('grants paid orders once across webhooks and reconciliation, ignores cycles, and claws back refunds', async () => {
    const userKey = newId(); const orders = new Map<string, PaymentOrder>(); let balance = 0; let subscription: Subscription | null = null;
    const product = { ...COMMERCE_CATALOG[0], providerProductId: 'polar-weekly' };
    const repository: CommerceRepository = {
      userExists: async () => true,
      listProducts: async () => [product],
      getProductByProductId: async (productId) => productId === product.productId ? product : null,
      getProductByProviderId: async (providerId) => providerId === product.providerProductId ? product : null,
      updateProductProviderId: async () => {},
      claimCheckout: async (checkout) => ({ status: 'claimed', checkout }),
      completeCheckout: async () => { throw new Error('unused'); },
      markCheckoutCompleted: async () => null,
      markCheckoutFailed: async () => null,
      failCheckout: async () => {},
      listRecoverablePendingCheckouts: async () => [],
      getCurrentSubscription: async () => subscription,
      listSubscriptionsByUser: async () => subscription ? [subscription] : [],
      upsertSubscription: async (input) => { subscription = input; return { status: 'applied', subscription: input }; },
      fulfillPaidOrder: async (input) => {
        const existing = orders.get(input.providerOrderId);
        if (existing) return { status: 'duplicate', order: existing };
        balance += input.grantMicroSparks;
        const order: PaymentOrder = { key: newId(), providerOrderId: input.providerOrderId, userKey: input.userKey, productKey: input.productKey, providerSubscriptionId: input.providerSubscriptionId, amountCents: input.amountCents, baseAmountCents: input.baseAmountCents, netAmountCents: input.netAmountCents, grantMicroSparks: input.grantMicroSparks, currency: 'USD', status: 'paid', sparkTransactionKey: newId(), refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: input.paidAt, refundedAt: null, createdAt: input.occurredAt, updatedAt: input.occurredAt };
        orders.set(input.providerOrderId, order);
        return { status: 'applied', order };
      },
      applyOrderRefund: async (providerOrderId, refundedAmountCents, refundedAt) => {
        const order = orders.get(providerOrderId);
        if (!order) return null;
        if (refundedAmountCents === order.refundedAmountCents) return { status: 'duplicate', order };
        const target = refundedAmountCents === order.netAmountCents ? order.grantMicroSparks : Math.floor(order.grantMicroSparks * refundedAmountCents / order.netAmountCents);
        balance -= target - order.clawedBackMicroSparks;
        const updated: PaymentOrder = { ...order, status: refundedAmountCents === order.netAmountCents ? 'refunded' : 'partially_refunded', refundedAmountCents, clawedBackMicroSparks: target, refundedAt, updatedAt: refundedAt };
        orders.set(providerOrderId, updated);
        return { status: 'applied', order: updated };
      },
    };
    const service = createCommerceService({ repository, applyFirstPaidReward: async () => ({ status: 'not-attributed' }), reverseFirstPaidReward: async () => ({ status: 'not-found' }), getEmailRecipient: async () => null });
    const at = '2026-01-17T12:00:00.000Z';
    const paidOrder = (id: string) => ({ id, status: 'paid' as const, paid: true, billing_reason: 'subscription_cycle' as const, subtotal_amount: 799, discount_amount: 0, net_amount: 799, tax_amount: 64, total_amount: 863, refunded_amount: 0, refunded_tax_amount: 0, currency: 'usd', created_at: at, modified_at: at, customer: { id: 'customer-1', external_id: userKey }, product: { id: 'polar-weekly', metadata: { productId: 'nova.weekly' } }, subscription_id: 'subscription-1', metadata: { userKey, productId: 'nova.weekly' } });
    const event = (id: string) => ({ type: 'order.paid', timestamp: at, data: { ...paidOrder(id), product_id: 'polar-weekly' } });
    const complete = async () => null;

    await processPolarWebhookJob({ schemaVersion: 1, kind: 'process', webhookId: 'webhook-1', event: event('order-1') }, { service, complete });
    await processPolarWebhookJob({ schemaVersion: 1, kind: 'process', webhookId: 'webhook-duplicate', event: event('order-1') }, { service, complete });
    expect(balance).toBe(200_000_000);

    await reconcileCommerceDay({ start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' }, { provider: { listOrders: async () => [paidOrder('order-1')], listSubscriptions: async () => [] }, service, now: () => new Date('2026-01-19T00:00:00.000Z') });
    expect(balance).toBe(200_000_000);

    await service.processWebhook({ type: 'subscription.cycled', timestamp: at, data: { id: 'subscription-1', status: 'active', product_id: 'polar-weekly', customer: { external_id: userKey }, current_period_start: at, current_period_end: '2026-01-24T12:00:00.000Z' } });
    expect(balance).toBe(200_000_000);

    await processPolarWebhookJob({ schemaVersion: 1, kind: 'process', webhookId: 'webhook-2', event: event('order-2') }, { service, complete });
    expect(balance).toBe(400_000_000);

    await service.processWebhook({ type: 'order.refunded', timestamp: at, data: { id: 'order-1', status: 'refunded', refunded_amount: 799 } });
    expect(balance).toBe(200_000_000);
  });
});
