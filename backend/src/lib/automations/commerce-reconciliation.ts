import { z } from 'zod';
import { productIdSchema, subscriptionStatusSchema } from '@/lib/commerce/contracts';
import type { CommerceService } from '@/lib/commerce/service';
import { polarOrderSchema, polarSubscriptionSchema, type PolarReconciliationProvider } from '@/lib/commerce/polar';

export const DAY_MS = 24 * 60 * 60 * 1_000;
const midnightSchema = z.string().datetime().refine((value) => Date.parse(value) % DAY_MS === 0, 'Timestamp must be aligned to UTC midnight.');
export const commerceReconciliationWindowSchema = z.object({ start: midnightSchema, end: midnightSchema }).strict().refine(
  ({ start, end }) => Date.parse(end) - Date.parse(start) === DAY_MS,
  'Commerce reconciliation windows must contain exactly one half-open UTC day.',
);
export type CommerceReconciliationWindow = z.infer<typeof commerceReconciliationWindowSchema>;

export function floorUtcDay(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new TypeError('A valid date is required.');
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function latestClosedCommerceDay(now: Date): CommerceReconciliationWindow {
  const end = floorUtcDay(now);
  return commerceReconciliationWindowSchema.parse({ start: new Date(end.getTime() - DAY_MS).toISOString(), end: end.toISOString() });
}

type ReconciliationService = Pick<CommerceService, 'applyPaidOrderFacts' | 'applyRefundFacts' | 'applySubscriptionFacts'>;

function references(resource: { customer: { external_id: string | null }; product: { id: string; metadata: Record<string, string | number | boolean> } | null; metadata: Record<string, string | number | boolean> }) {
  const userKey = z.string().cuid().parse(resource.customer.external_id);
  const metadataUserKey = resource.metadata.userKey;
  if (metadataUserKey !== undefined && metadataUserKey !== userKey) throw new Error('Polar resource customer and user metadata do not agree.');
  if (!resource.product) throw new Error('Polar resource does not include its product snapshot.');
  const productId = productIdSchema.parse(resource.product.metadata.productId);
  const metadataProductId = resource.metadata.productId;
  if (metadataProductId !== undefined && metadataProductId !== productId) throw new Error('Polar resource product references do not agree.');
  return { userKey, productId, providerProductId: resource.product.id };
}

export async function reconcileCommerceDay(rawWindow: unknown, dependencies: {
  provider: PolarReconciliationProvider;
  service: ReconciliationService;
  now?: () => Date;
}) {
  const window = commerceReconciliationWindowSchema.parse(rawWindow);
  if (Date.parse(window.end) > floorUtcDay((dependencies.now ?? (() => new Date()))()).getTime()) throw new RangeError('Commerce reconciliation only accepts fully closed UTC days.');
  const orders = (await dependencies.provider.listOrders(window.end)).map((value) => polarOrderSchema.parse(value));
  let appliedOrders = 0;
  let refunds = 0;
  for (const order of orders) {
    if (!['paid', 'partially_refunded', 'refunded'].includes(order.status)) continue;
    if (!order.paid) throw new Error(`Polar order ${order.id} has an inconsistent paid status.`);
    if (!['purchase', 'subscription_create', 'subscription_cycle'].includes(order.billing_reason)) continue;
    const reference = references(order);
    const fulfillment = await dependencies.service.applyPaidOrderFacts({
      providerOrderId: order.id,
      ...reference,
      providerSubscriptionId: order.subscription_id,
      billingReason: order.billing_reason,
      amountCents: order.total_amount,
      baseAmountCents: order.subtotal_amount,
      netAmountCents: order.net_amount,
      discountAmountCents: order.discount_amount,
      currency: order.currency,
      paidAt: order.created_at,
    });
    if (fulfillment.status === 'ignored_deleted_user') continue;
    appliedOrders += 1;
    if (order.refunded_amount > 0) {
      await dependencies.service.applyRefundFacts({ providerOrderId: order.id, refundedAmountCents: order.refunded_amount, refundedAt: order.modified_at ?? order.created_at });
      refunds += 1;
    }
  }
  const subscriptions = (await dependencies.provider.listSubscriptions()).map((value) => polarSubscriptionSchema.parse(value));
  for (const subscription of subscriptions) {
    const reference = references(subscription);
    const providerModifiedAt = subscription.modified_at ?? subscription.created_at;
    await dependencies.service.applySubscriptionFacts({
      providerSubscriptionId: subscription.id,
      userKey: reference.userKey,
      productId: reference.productId,
      providerProductId: reference.providerProductId,
      status: subscriptionStatusSchema.parse(subscription.status),
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodStart: subscription.current_period_start,
      currentPeriodEnd: subscription.current_period_end,
      providerModifiedAt,
      occurredAt: subscription.created_at,
    });
  }
  return { orders: orders.length, appliedOrders, refunds, subscriptions: subscriptions.length };
}
