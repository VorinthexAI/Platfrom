import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { commerceReconciliationWindowSchema, latestClosedCommerceDay, reconcileCommerceDay } from './commerce-reconciliation';

const createdAt = '2026-01-17T12:00:00.000Z';
const userA = newId();
const userB = newId();
const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'order-weekly-1', status: 'paid', paid: true, billing_reason: 'subscription_cycle', subtotal_amount: 799, discount_amount: 0, net_amount: 799, tax_amount: 64, total_amount: 863, refunded_amount: 0, refunded_tax_amount: 0, currency: 'usd', created_at: createdAt, modified_at: createdAt,
  customer: { id: 'customer-a', external_id: userA }, product: { id: 'polar-weekly', metadata: { productId: 'nova.weekly' } }, subscription_id: 'subscription-a', metadata: { userKey: userA, productId: 'nova.weekly' }, ...overrides,
});
const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'subscription-a', status: 'active', amount: 799, currency: 'usd', recurring_interval: 'week', cancel_at_period_end: false, created_at: createdAt, modified_at: null, started_at: createdAt, current_period_start: createdAt, current_period_end: '2026-01-24T12:00:00.000Z', trial_start: null, trial_end: null, canceled_at: null, ends_at: null, ended_at: null,
  customer: { id: 'customer-a', external_id: userA }, product: { id: 'polar-weekly', metadata: { productId: 'nova.weekly' } }, metadata: { userKey: userA, productId: 'nova.weekly' }, ...overrides,
});

describe('nightly commerce reconciliation', () => {
  test('uses exact fully closed UTC days including January 17', () => {
    expect(latestClosedCommerceDay(new Date('2026-01-18T18:45:00-05:00'))).toEqual({ start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' });
    expect(latestClosedCommerceDay(new Date('2026-01-18T00:00:00.000Z'))).toEqual({ start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' });
    expect(() => commerceReconciliationWindowSchema.parse({ start: '2026-01-17T01:00:00.000Z', end: '2026-01-18T01:00:00.000Z' })).toThrow();
  });

  test('repairs weekly, monthly, top-up, distinct-cycle, and refund facts for multiple users', async () => {
    const paid: unknown[] = [], refunds: unknown[] = [], subscriptions: unknown[] = [];
    const orders = [
      order(),
      order({ id: 'order-weekly-2' }),
      order({ id: 'order-monthly', customer: { id: 'customer-b', external_id: userB }, product: { id: 'polar-monthly', metadata: { productId: 'nova.monthly' } }, metadata: { userKey: userB, productId: 'nova.monthly' }, subscription_id: 'subscription-b', subtotal_amount: 2499, net_amount: 2499, total_amount: 2699 }),
      order({ id: 'order-topup', billing_reason: 'purchase', product: { id: 'polar-topup', metadata: { productId: 'topup.small' } }, metadata: { userKey: userA, productId: 'topup.small' }, subscription_id: null, subtotal_amount: 999, net_amount: 999, total_amount: 999 }),
      order({ id: 'order-refund', status: 'refunded', refunded_amount: 799, modified_at: null }),
      order({ id: 'order-pending', status: 'pending', paid: false }),
      order({ id: 'order-void', status: 'void', paid: false }),
      order({ id: 'order-meter', billing_reason: 'subscription_meter_cycle' }),
    ];
    const provider = { listOrders: async (cutoff: string) => { expect(cutoff).toBe('2026-01-18T00:00:00.000Z'); return orders as never; }, listSubscriptions: async () => [subscription(), subscription({ id: 'subscription-b', customer: { id: 'customer-b', external_id: userB }, product: { id: 'polar-monthly', metadata: { productId: 'nova.monthly' } }, metadata: { userKey: userB, productId: 'nova.monthly' }, recurring_interval: 'month' })] as never };
    const service = { applyPaidOrderFacts: async (value: unknown) => { paid.push(value); return { status: 'applied' }; }, applyRefundFacts: async (value: unknown) => { refunds.push(value); }, applySubscriptionFacts: async (value: unknown) => { subscriptions.push(value); } };
    await expect(reconcileCommerceDay({ start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' }, { provider, service: service as never, now: () => new Date('2026-01-19T00:00:00.000Z') })).resolves.toEqual({ orders: 8, appliedOrders: 5, refunds: 1, subscriptions: 2 });
    expect(paid.map((value) => (value as { providerOrderId: string }).providerOrderId)).toEqual(['order-weekly-1', 'order-weekly-2', 'order-monthly', 'order-topup', 'order-refund']);
    expect(refunds).toEqual([{ providerOrderId: 'order-refund', refundedAmountCents: 799, refundedAt: createdAt }]);
    expect(subscriptions[0]).toMatchObject({ providerModifiedAt: createdAt, productId: 'nova.weekly' });
  });

  test('fails closed on future windows and disagreeing trusted metadata', async () => {
    const service = { applyPaidOrderFacts: async () => ({ status: 'applied' }), applyRefundFacts: async () => {}, applySubscriptionFacts: async () => {} };
    await expect(reconcileCommerceDay({ start: '2026-01-18T00:00:00.000Z', end: '2026-01-19T00:00:00.000Z' }, { provider: { listOrders: async () => [], listSubscriptions: async () => [] }, service: service as never, now: () => new Date('2026-01-18T23:59:59.999Z') })).rejects.toThrow('fully closed');
    await expect(reconcileCommerceDay({ start: '2026-01-17T00:00:00.000Z', end: '2026-01-18T00:00:00.000Z' }, { provider: { listOrders: async () => [order({ metadata: { userKey: userB, productId: 'nova.weekly' } })] as never, listSubscriptions: async () => [] }, service: service as never, now: () => new Date('2026-01-19T00:00:00.000Z') })).rejects.toThrow('do not agree');
  });
});
