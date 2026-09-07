import { createHash } from 'node:crypto';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { resolvePurchaseGrantMicroSparks } from '@/lib/costs';
import { referralService } from '@/lib/referrals/service';
import { checkoutCreateInputSchema, checkoutCreateResultSchema, currentSubscriptionResultSchema, productIdSchema, publicProductSchema, subscriptionSchema, subscriptionStatusSchema } from './contracts';
import { createArangoCommerceRepository, type CommerceRepository } from './repository';
import { createPolarProvider, PolarProviderError, type PolarProvider } from './polar';

export class CommerceError extends Error {
  constructor(public readonly code: 'PRODUCT_NOT_FOUND' | 'PRODUCT_INACTIVE' | 'PRODUCT_NOT_SYNCED' | 'CHECKOUT_CONFLICT' | 'CHECKOUT_PENDING' | 'SUBSCRIPTION_EXISTS' | 'SUBSCRIPTION_NOT_FOUND' | 'ACCOUNT_NOT_FOUND' | 'INVALID_REFERENCE', message: string) { super(message); this.name = 'CommerceError'; }
}

const timestamp = z.string().datetime({ offset: true });
const webhookDataSchema = z.object({
  id: z.string().trim().min(1),
  status: z.string().optional(),
  modified_at: timestamp.nullable().optional(),
  product_id: z.string().trim().min(1).optional(),
  subscription_id: z.string().trim().min(1).nullable().optional(),
  total_amount: z.number().int().nonnegative().optional(),
  subtotal_amount: z.number().int().nonnegative().optional(),
  discount_amount: z.number().int().nonnegative().optional(),
  net_amount: z.number().int().nonnegative().optional(),
  refunded_amount: z.number().int().nonnegative().optional(),
  refunded_tax_amount: z.number().int().nonnegative().optional(),
  currency: z.string().optional(),
  created_at: timestamp.optional(),
  current_period_start: timestamp.nullable().optional(),
  current_period_end: timestamp.nullable().optional(),
  cancel_at_period_end: z.boolean().optional(),
  customer: z.object({ external_id: z.string().trim().min(1).nullable().optional() }).passthrough().optional(),
  product: z.object({ id: z.string().trim().min(1), metadata: z.record(z.unknown()).optional() }).passthrough().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  billing_reason: z.string().trim().min(1).optional(),
}).passthrough();
export const polarWebhookEventSchema = z.object({ type: z.string().trim().min(1), timestamp: timestamp.optional(), data: webhookDataSchema }).passthrough();

export const authoritativePaidOrderFactsSchema = z.object({
  providerOrderId: z.string().trim().min(1).max(200),
  userKey: z.string().cuid(),
  productId: productIdSchema,
  providerSubscriptionId: z.string().trim().min(1).max(200).nullable(),
  billingReason: z.enum(['purchase', 'subscription_create', 'subscription_cycle', 'subscription_update', 'meter', 'subscription_meter_cycle']),
  amountCents: z.number().int().safe().nonnegative(),
  baseAmountCents: z.number().int().safe().positive(),
  netAmountCents: z.number().int().safe().positive(),
  discountAmountCents: z.number().int().safe().nonnegative(),
  currency: z.string().trim().min(1),
  paidAt: timestamp,
  providerProductId: z.string().trim().min(1).max(200).optional(),
}).strict();

export const authoritativeRefundFactsSchema = z.object({
  providerOrderId: z.string().trim().min(1).max(200),
  refundedAmountCents: z.number().int().safe().nonnegative(),
  refundedAt: timestamp,
}).strict();

export const authoritativeSubscriptionFactsSchema = z.object({
  providerSubscriptionId: z.string().trim().min(1).max(200),
  userKey: z.string().cuid(),
  productId: productIdSchema,
  providerProductId: z.string().trim().min(1).max(200).optional(),
  status: subscriptionStatusSchema,
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodStart: timestamp.nullable(),
  currentPeriodEnd: timestamp.nullable(),
  providerModifiedAt: timestamp,
  occurredAt: timestamp,
}).strict();

export interface CommerceServiceDependencies {
  repository: CommerceRepository;
  provider?: PolarProvider;
  createProvider?: () => PolarProvider;
  applyFirstPaidReward?: typeof referralService.applyFirstPaidReward;
  reverseFirstPaidReward?: typeof referralService.reverseFirstPaidReward;
  createKey?: () => string;
  now?: () => Date;
}

const CHECKOUT_SUCCESS_URL = 'https://vorinthex.com/checkout/success';
const CHECKOUT_RETURN_URL = 'https://vorinthex.com/checkout/error';

export function createCommerceService({ repository, provider, createProvider = createPolarProvider, applyFirstPaidReward = referralService.applyFirstPaidReward, reverseFirstPaidReward = referralService.reverseFirstPaidReward, createKey = newId, now = () => new Date() }: CommerceServiceDependencies) {
  const polar = () => provider ?? createProvider();
  async function productReference(data: z.infer<typeof webhookDataSchema>) {
    const providerIds = [data.product_id, data.product?.id].filter((value): value is string => Boolean(value));
    const metadataIds = [data.metadata?.productId, data.product?.metadata?.productId].filter((value): value is string => typeof value === 'string');
    if (new Set(providerIds).size > 1 || new Set(metadataIds).size > 1) throw new CommerceError('INVALID_REFERENCE', 'Webhook contains conflicting product references.');
    const byProvider = providerIds[0] ? await repository.getProductByProviderId(providerIds[0]) : null;
    const metadataId = productIdSchema.safeParse(metadataIds[0]);
    const byMetadata = metadataId.success ? await repository.getProductByProductId(metadataId.data) : null;
    if (providerIds[0] && !byProvider) throw new CommerceError('INVALID_REFERENCE', 'Webhook references an unknown provider product.');
    if (metadataIds[0] && (!metadataId.success || !byMetadata)) throw new CommerceError('INVALID_REFERENCE', 'Webhook references invalid product metadata.');
    if (!byProvider && !byMetadata) throw new CommerceError('INVALID_REFERENCE', 'Webhook references an unknown product.');
    if (byProvider && byMetadata && byProvider.key !== byMetadata.key) throw new CommerceError('INVALID_REFERENCE', 'Webhook contains conflicting product references.');
    return byProvider ?? byMetadata!;
  }
  function userReference(data: z.infer<typeof webhookDataSchema>) {
    const references = [data.customer?.external_id, data.metadata?.userKey].filter((value): value is string => typeof value === 'string');
    if (new Set(references).size > 1) throw new CommerceError('INVALID_REFERENCE', 'Webhook contains conflicting user identities.');
    const value = references[0];
    const parsed = z.string().cuid().safeParse(value);
    if (!parsed.success) throw new CommerceError('INVALID_REFERENCE', 'Webhook references an unknown user identity.');
    return parsed.data;
  }
  async function applyPaidOrderFacts(rawFacts: unknown) {
    const facts = authoritativePaidOrderFactsSchema.parse(rawFacts);
    const product = await repository.getProductByProductId(facts.productId);
    if (!product) throw new CommerceError('INVALID_REFERENCE', 'Paid order references an unknown product.');
    if (!await repository.userExists(facts.userKey)) return { status: 'ignored_deleted_user' as const };
    if (facts.providerProductId !== undefined && product.providerProductId !== facts.providerProductId) throw new CommerceError('INVALID_REFERENCE', 'Paid order provider product does not match its product metadata.');
    const grantMicroSparks = resolvePurchaseGrantMicroSparks(product.productId);
    if (product.sparkGrantMicroSparks !== grantMicroSparks) throw new CommerceError('INVALID_REFERENCE', 'Persisted product grant does not match the canonical costs rule.');
    if (product.type === 'one_time') {
      if (facts.billingReason !== 'purchase' || facts.providerSubscriptionId !== null) throw new CommerceError('INVALID_REFERENCE', 'One-time orders require a purchase billing reason without a subscription.');
    } else if (!['subscription_create', 'subscription_cycle'].includes(facts.billingReason) || facts.providerSubscriptionId === null) {
      throw new CommerceError('INVALID_REFERENCE', 'Subscription orders require a create or cycle billing reason and a subscription.');
    }
    const effectivePrice = product.discountedPriceCents ?? product.priceCents;
    if (facts.currency.toUpperCase() !== 'USD' || facts.baseAmountCents !== effectivePrice || facts.discountAmountCents !== 0 || facts.netAmountCents < effectivePrice || facts.amountCents < facts.netAmountCents) {
      throw new CommerceError('INVALID_REFERENCE', 'Paid order does not match the immutable catalog price.');
    }
    const result = await repository.fulfillPaidOrder({ ...facts, productKey: product.key, productId: product.productId, currency: 'USD', grantMicroSparks, occurredAt: facts.paidAt });
    await applyFirstPaidReward(facts.userKey, result.order.key);
    return result;
  }
  async function applySubscriptionFacts(rawFacts: unknown) {
    const facts = authoritativeSubscriptionFactsSchema.parse(rawFacts);
    const product = await repository.getProductByProductId(facts.productId);
    if (!product || product.type !== 'subscription') throw new CommerceError('INVALID_REFERENCE', 'Subscription facts reference an invalid product.');
    if (!await repository.userExists(facts.userKey)) return { status: 'ignored_deleted_user' as const };
    if (facts.providerProductId !== undefined && product.providerProductId !== facts.providerProductId) throw new CommerceError('INVALID_REFERENCE', 'Subscription provider product does not match its product metadata.');
    const existing = await repository.getCurrentSubscription(facts.userKey);
    return repository.upsertSubscription(subscriptionSchema.parse({
      key: existing?.providerSubscriptionId === facts.providerSubscriptionId ? existing.key : createKey(),
      userKey: facts.userKey,
      productKey: product.key,
      providerSubscriptionId: facts.providerSubscriptionId,
      status: facts.status,
      cancelAtPeriodEnd: facts.cancelAtPeriodEnd,
      currentPeriodStart: facts.currentPeriodStart,
      currentPeriodEnd: facts.currentPeriodEnd,
      providerModifiedAt: facts.providerModifiedAt,
      createdAt: existing?.providerSubscriptionId === facts.providerSubscriptionId ? existing.createdAt : facts.occurredAt,
      updatedAt: facts.providerModifiedAt,
    }));
  }
  async function applyRefundFacts(rawFacts: unknown) {
    const facts = authoritativeRefundFactsSchema.parse(rawFacts);
    const result = await repository.applyOrderRefund(facts.providerOrderId, facts.refundedAmountCents, facts.refundedAt);
    if (!result) throw new CommerceError('INVALID_REFERENCE', 'Refund references an unknown paid order.');
    if (result.order.status === 'refunded') await reverseFirstPaidReward(result.order.key, facts.refundedAt);
    return result;
  }
  return Object.freeze({
    async listProducts() {
      return z.array(publicProductSchema).parse((await repository.listProducts(true)).map(({ providerProductId: _providerProductId, ...product }) => product));
    },
    async getCheckoutProduct(rawProductId: unknown) {
      const productId = productIdSchema.parse(rawProductId);
      const product = await repository.getProductByProductId(productId);
      if (!product) throw new CommerceError('PRODUCT_NOT_FOUND', 'Product was not found.');
      if (!product.active) throw new CommerceError('PRODUCT_INACTIVE', 'Product is not active.');
      if (!product.providerProductId) throw new CommerceError('PRODUCT_NOT_SYNCED', 'Product is unavailable for checkout.');
      const { providerProductId: _providerProductId, ...safe } = product;
      return publicProductSchema.parse(safe);
    },
    async createCheckout(rawInput: unknown, trustedUserKey: string, idempotencyKey: string, customerIpAddress?: string) {
      const input = checkoutCreateInputSchema.parse(rawInput);
      const product = await repository.getProductByProductId(input.productId);
      if (!product) throw new CommerceError('PRODUCT_NOT_FOUND', 'Product was not found.');
      if (!product.active) throw new CommerceError('PRODUCT_INACTIVE', 'Product is not active.');
      if (!product.providerProductId) throw new CommerceError('PRODUCT_NOT_SYNCED', 'Product is unavailable for checkout.');
      const at = now().toISOString();
      const requestHash = createHash('sha256').update(`${trustedUserKey}\u0000${input.productId}`).digest('hex');
      const claimed = await repository.claimCheckout({ key: createKey(), userKey: trustedUserKey, productKey: product.key, idempotencyKey, requestHash, status: 'pending', providerCheckoutId: null, checkoutUrl: null, failureCode: null, createdAt: at, updatedAt: at });
      if (claimed.status === 'conflict') throw new CommerceError('CHECKOUT_CONFLICT', 'The idempotency key was used for a different checkout.');
      if (claimed.status === 'pending') throw new CommerceError('CHECKOUT_PENDING', 'Checkout creation is already in progress.');
      if (claimed.status === 'subscription_exists') throw new CommerceError('SUBSCRIPTION_EXISTS', 'A subscription or subscription checkout is already active.');
      if (claimed.status === 'account_missing') throw new CommerceError('ACCOUNT_NOT_FOUND', 'The account is no longer available for checkout.');
      if (claimed.status === 'replayed') return checkoutCreateResultSchema.parse({ key: claimed.checkout.key, status: claimed.checkout.status, url: claimed.checkout.checkoutUrl });
      try {
        const providerIdempotencyKey = `checkout:${createHash('sha256').update(`${trustedUserKey}\u0000${idempotencyKey}`).digest('hex')}`;
        const checkout = await polar().createCheckout({ providerProductId: product.providerProductId, userKey: trustedUserKey, productId: product.productId, idempotencyKey: providerIdempotencyKey, successUrl: CHECKOUT_SUCCESS_URL, returnUrl: CHECKOUT_RETURN_URL, customerIpAddress });
        const saved = await repository.completeCheckout(claimed.checkout.key, checkout.id, checkout.url, now().toISOString());
        return checkoutCreateResultSchema.parse({ key: saved.key, status: saved.status, url: saved.checkoutUrl });
      } catch (error) {
        if (error instanceof PolarProviderError && !error.retryable) await repository.failCheckout(claimed.checkout.key, error.code, now().toISOString());
        throw error;
      }
    },
    async getCurrentSubscription(trustedUserKey: string) {
      const subscription = await repository.getCurrentSubscription(trustedUserKey);
      if (!subscription) return null;
      const { providerSubscriptionId: _providerSubscriptionId, ...safe } = subscription;
      return currentSubscriptionResultSchema.parse(safe);
    },
    async setCancellation(trustedUserKey: string, cancelAtPeriodEnd: boolean) {
      const current = await repository.getCurrentSubscription(trustedUserKey);
      if (!current) throw new CommerceError('SUBSCRIPTION_NOT_FOUND', 'Current subscription was not found.');
      const response = await polar().updateSubscription(current.providerSubscriptionId, cancelAtPeriodEnd);
      const projectedAt = now().toISOString();
      const saved = (await repository.upsertSubscription({ ...current, status: response.status, cancelAtPeriodEnd: response.cancel_at_period_end, currentPeriodStart: response.current_period_start ?? current.currentPeriodStart, currentPeriodEnd: response.current_period_end ?? current.currentPeriodEnd, providerModifiedAt: response.modified_at ?? current.providerModifiedAt, updatedAt: projectedAt })).subscription;
      const { providerSubscriptionId: _providerSubscriptionId, ...safe } = saved;
      return currentSubscriptionResultSchema.parse(safe);
    },
    async revokeUserSubscriptions(trustedUserKey: string) {
      const subscriptions = await repository.listSubscriptionsByUser(trustedUserKey);
      const revocable = subscriptions.filter((subscription) => !['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status));
      let provider: PolarProvider;
      try {
        provider = polar();
      } catch (error) {
        if (error instanceof PolarProviderError && error.code === 'NOT_CONFIGURED' && revocable.length === 0) return { revoked: 0 };
        throw error;
      }
      const providerSubscriptions = provider.listSubscriptions ? await provider.listSubscriptions() : [];
      const providerIds = new Set(revocable.map((subscription) => subscription.providerSubscriptionId));
      for (const subscription of providerSubscriptions) {
        if (subscription.customer.external_id === trustedUserKey && !['canceled', 'unpaid', 'incomplete_expired'].includes(subscription.status)) providerIds.add(subscription.id);
      }
      for (const providerSubscriptionId of providerIds) await provider.revokeSubscription(providerSubscriptionId);
      return { revoked: providerIds.size };
    },
    async recoverUserPendingCheckouts(trustedUserKey: string, pendingCutoff: string) {
      const pending = await repository.listRecoverablePendingCheckouts(trustedUserKey, pendingCutoff);
      for (const { checkout, productId } of pending) {
        await this.createCheckout({ productId }, trustedUserKey, checkout.idempotencyKey);
      }
      return { recovered: pending.length };
    },
    applyPaidOrderFacts,
    applyRefundFacts,
    applySubscriptionFacts,
    async processWebhook(rawEvent: unknown) {
      const event = polarWebhookEventSchema.parse(rawEvent);
      const occurredAt = event.timestamp ?? event.data.created_at ?? now().toISOString();
      if (event.type === 'checkout.updated' && event.data.status === 'succeeded') {
        const checkout = await repository.markCheckoutCompleted(event.data.id, occurredAt);
        if (!checkout) throw new CommerceError('INVALID_REFERENCE', 'Checkout event references an unknown checkout.');
        return { processed: true, checkout: 'completed' };
      }
      if ((event.type === 'checkout.expired' || event.type === 'checkout.updated') && ['expired', 'failed'].includes(event.data.status ?? (event.type === 'checkout.expired' ? 'expired' : ''))) {
        const checkout = await repository.markCheckoutFailed(event.data.id, event.data.status ?? 'expired', occurredAt);
        if (!checkout) throw new CommerceError('INVALID_REFERENCE', 'Checkout event references an unknown checkout.');
        return { processed: true, checkout: 'failed' };
      }
      if (['order.created', 'order.paid', 'order.updated'].includes(event.type) && (event.type === 'order.paid' || event.data.status === 'paid')) {
        const product = await productReference(event.data);
        const userKey = userReference(event.data);
        const result = await applyPaidOrderFacts({ providerOrderId: event.data.id, userKey, productId: product.productId, providerProductId: event.data.product_id ?? event.data.product?.id, providerSubscriptionId: event.data.subscription_id ?? null, billingReason: event.data.billing_reason, amountCents: event.data.total_amount, baseAmountCents: event.data.subtotal_amount, netAmountCents: event.data.net_amount, discountAmountCents: event.data.discount_amount, currency: event.data.currency, paidAt: occurredAt });
        return { processed: true, fulfillment: result.status };
      }
      if (['order.refunded', 'order.updated'].includes(event.type) && ['refunded', 'partially_refunded'].includes(event.data.status ?? '')) {
        if (event.data.refunded_amount === undefined) throw new CommerceError('INVALID_REFERENCE', 'Refund is missing its cumulative net amount.');
        const result = await applyRefundFacts({ providerOrderId: event.data.id, refundedAmountCents: event.data.refunded_amount, refundedAt: event.data.modified_at ?? occurredAt });
        return { processed: true, refund: result.status, status: result.order.status };
      }
      if (event.type.startsWith('subscription.')) {
        const product = await productReference(event.data);
        const userKey = userReference(event.data);
        const status = subscriptionStatusSchema.safeParse(event.data.status);
        if (!status.success) return { ignored: true };
        const providerModifiedAt = event.data.modified_at ?? occurredAt;
        const result = await applySubscriptionFacts({ providerSubscriptionId: event.data.id, userKey, productId: product.productId, providerProductId: event.data.product_id ?? event.data.product?.id, status: status.data, cancelAtPeriodEnd: event.data.cancel_at_period_end ?? status.data === 'canceled', currentPeriodStart: event.data.current_period_start ?? null, currentPeriodEnd: event.data.current_period_end ?? null, providerModifiedAt, occurredAt });
        if (result.status === 'ignored_deleted_user') return { ignored: true };
        return { processed: true, subscription: result.subscription.status, projection: result.status };
      }
      return { ignored: true };
    },
  });
}

export const commerceService = createCommerceService({ repository: createArangoCommerceRepository() });
export type CommerceService = ReturnType<typeof createCommerceService>;
