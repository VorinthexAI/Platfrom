import { z } from 'zod';
import { publishUserEvent } from '@/api/events';
import { newId } from '@/lib/ids';
import { resolvePurchaseGrantMicroSparks } from '@/lib/costs';
import { referralService } from '@/lib/referrals/service';
import { getUserById } from '@/lib/db/users.node';
import { sendSubscriptionPurchaseEmail, sendSubscriptionRenewalEmail, sendTopUpPurchaseEmail } from '@/lib/email/lifecycle';
import { productIdSchema, publicProductSchema, subscriptionSchema } from './contracts';
import { currentSubscriptionResponseSchema } from './public-subscription';
import { createArangoCommerceRepository, type CommerceRepository } from './repository';

export class CommerceError extends Error {
  constructor(public readonly code: 'INVALID_REFERENCE' | 'PRODUCT_NOT_FOUND', message: string) { super(message); this.name = 'CommerceError'; }
}

const eventSchema = z.object({
  id: z.string().trim().min(1),
  type: z.string().trim().min(1),
  app_user_id: z.string().cuid().optional(),
  product_id: z.string().trim().min(1).optional(),
  new_product_id: z.string().trim().min(1).optional(),
  transaction_id: z.string().trim().min(1).optional(),
  original_transaction_id: z.string().trim().min(1).optional(),
  purchased_at_ms: z.number().int().nonnegative().optional(),
  expiration_at_ms: z.number().int().nonnegative().nullable().optional(),
  event_timestamp_ms: z.number().int().nonnegative(),
  price: z.number().finite().nullable().optional(),
  cancel_reason: z.string().optional(),
  environment: z.enum(['SANDBOX', 'PRODUCTION']).optional(),
  store: z.string().optional(),
}).passthrough();

export const purchaseEventSchema = z.object({ api_version: z.string(), event: eventSchema }).strict();
type PurchaseEvent = z.infer<typeof eventSchema>;

export function createCommerceService({ repository = createArangoCommerceRepository(), publishBalance = publishUserEvent, now = () => new Date() }: { repository?: CommerceRepository; publishBalance?: typeof publishUserEvent; now?: () => Date } = {}) {
  const productForEvent = async (event: PurchaseEvent) => {
    if (!event.product_id) throw new CommerceError('INVALID_REFERENCE', 'Purchase event is missing a product.');
    const productId = event.product_id.split(':')[0];
    const parsed = productIdSchema.safeParse(productId);
    if (!parsed.success) throw new CommerceError('INVALID_REFERENCE', 'Purchase event references an unknown product.');
    const product = await repository.getProductByProductId(parsed.data);
    if (!product || !product.active) throw new CommerceError('PRODUCT_NOT_FOUND', 'Purchase product is unavailable.');
    return product;
  };
  const subscriptionId = (event: PurchaseEvent) => `rc:${event.store ?? 'store'}:${event.original_transaction_id ?? event.transaction_id}`;
  const projectSubscription = async (event: PurchaseEvent, status: 'active' | 'past_due' | 'canceled', cancelAtPeriodEnd: boolean) => {
    const userKey = event.app_user_id;
    if (!userKey || !await repository.userExists(userKey)) return;
    const product = await productForEvent(event);
    if (product.type !== 'subscription' || !(event.original_transaction_id ?? event.transaction_id)) return;
    const existing = await repository.getCurrentSubscription(userKey);
    const at = new Date(event.event_timestamp_ms).toISOString();
    const providerSubscriptionId = subscriptionId(event);
    await repository.upsertSubscription(subscriptionSchema.parse({
      key: existing?.providerSubscriptionId === providerSubscriptionId ? existing.key : newId(),
      userKey, productKey: product.key, providerSubscriptionId, status, cancelAtPeriodEnd,
      currentPeriodStart: event.purchased_at_ms ? new Date(event.purchased_at_ms).toISOString() : null,
      currentPeriodEnd: event.expiration_at_ms ? new Date(event.expiration_at_ms).toISOString() : null,
      providerModifiedAt: at, createdAt: existing?.providerSubscriptionId === providerSubscriptionId ? existing.createdAt : at, updatedAt: at,
    }));
  };
  return Object.freeze({
    async listProducts() { return z.array(publicProductSchema).parse(await repository.listProducts(true)); },
    async getCurrentSubscription(userKey: string) {
      const current = await repository.getCurrentSubscription(userKey);
      if (!current) return null;
      const { providerSubscriptionId: _providerSubscriptionId, providerModifiedAt: _providerModifiedAt, ...safe } = current;
      return currentSubscriptionResponseSchema.parse(safe);
    },
    async processPurchaseEvent(raw: unknown) {
      const { event } = purchaseEventSchema.parse(raw);
      if (event.type === 'TEST') return { ignored: true };
      if (!event.app_user_id || !await repository.userExists(event.app_user_id)) return { ignored: true };
      if (event.environment === 'SANDBOX' && process.env.NODE_ENV === 'production') return { ignored: true };
      if (event.type === 'INITIAL_PURCHASE' || event.type === 'RENEWAL' || event.type === 'NON_RENEWING_PURCHASE') {
        const product = await productForEvent(event);
        if (!event.transaction_id || !event.purchased_at_ms) throw new CommerceError('INVALID_REFERENCE', 'Purchase event is missing its transaction.');
        if ((event.type === 'NON_RENEWING_PURCHASE') !== (product.type === 'one_time')) throw new CommerceError('INVALID_REFERENCE', 'Purchase type does not match the product.');
        // Free trials do not grant prepaid Sparks until a paid transaction arrives.
        if (event.price === 0) { if (product.type === 'subscription') await projectSubscription(event, 'active', false); return { ignored: true }; }
        const amountCents = event.price == null ? product.priceCents : Math.round(event.price * 100);
        if (amountCents <= 0) throw new CommerceError('INVALID_REFERENCE', 'Purchase has no paid amount.');
        const result = await repository.fulfillPaidOrder({
          providerOrderId: `rc:${event.store ?? 'store'}:${event.transaction_id}`, userKey: event.app_user_id, productKey: product.key, productId: product.productId,
          providerSubscriptionId: product.type === 'subscription' ? subscriptionId(event) : null,
          amountCents, baseAmountCents: amountCents, netAmountCents: amountCents, currency: 'USD',
          grantMicroSparks: resolvePurchaseGrantMicroSparks(product.productId),
          paidAt: new Date(event.purchased_at_ms).toISOString(), occurredAt: new Date(event.event_timestamp_ms).toISOString(),
        });
        if (product.type === 'subscription') {
          await projectSubscription(event, 'active', false);
          if (result.order.status !== 'refunded') await referralService.applyFirstPaidReward(event.app_user_id, result.order.key);
        }
        if (result.status === 'applied') {
          await publishBalance(event.app_user_id, 'spark.balance.changed').catch(() => undefined);
          const recipient = await getUserById(event.app_user_id).catch(() => null);
          if (recipient?.email && !recipient.email.endsWith('@guest.vorinthex.com')) {
            const input = { email: recipient.email, name: recipient.name, amountCents, billingPeriod: product.billingPeriod, grantMicroSparks: product.sparkGrantMicroSparks };
            void (product.type === 'one_time' ? sendTopUpPurchaseEmail(input) : event.type === 'RENEWAL' ? sendSubscriptionRenewalEmail(input) : sendSubscriptionPurchaseEmail(input)).catch((error) => console.error('purchase email delivery failed', { error }));
          }
        }
        return { processed: true, fulfillment: result.status };
      }
      if (event.type === 'CANCELLATION' && event.cancel_reason === 'CUSTOMER_SUPPORT' && event.transaction_id) {
        const orderId = `rc:${event.store ?? 'store'}:${event.transaction_id}`;
        const paid = await repository.getOrderByProviderId(orderId);
        if (!paid) throw new CommerceError('INVALID_REFERENCE', 'Refund arrived before its paid purchase.');
        const refunded = await repository.applyOrderRefund(orderId, paid.netAmountCents, now().toISOString());
        if (refunded?.status === 'applied') {
          await referralService.reverseFirstPaidReward(refunded.order.key, now().toISOString());
          await publishBalance(event.app_user_id, 'spark.balance.changed').catch(() => undefined);
        }
      }
      if (['CANCELLATION', 'UNCANCELLATION', 'EXPIRATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE', 'SUBSCRIPTION_EXTENDED'].includes(event.type)) {
        await projectSubscription(event, event.type === 'EXPIRATION' ? 'canceled' : event.type === 'BILLING_ISSUE' ? 'past_due' : 'active', event.type === 'CANCELLATION');
        return { processed: true };
      }
      return { ignored: true };
    },
  });
}

export const commerceService = createCommerceService();
export type CommerceService = ReturnType<typeof createCommerceService>;
