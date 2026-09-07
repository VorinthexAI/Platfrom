import { createHash } from 'node:crypto';
import { db, withDatabaseTransaction } from '@/lib/db/client';
import { newId } from '@/lib/ids';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { sparkTransactionSchema } from '@/lib/sparks/contracts';
import { paymentCheckoutSchema, paymentOrderSchema, productSchema, subscriptionSchema, type PaymentCheckout, type PaymentOrder, type Product, type Subscription } from './contracts';

interface Cursor { next(): Promise<unknown>; all(): Promise<unknown[]> }
export interface CommerceDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
export type CommerceTransactionRunner = <T>(collections: { read?: string[]; write: string[] }, operation: (transaction: CommerceDatabase) => Promise<T>) => Promise<T>;

export type PaidOrderFulfillment = Readonly<{
  providerOrderId: string;
  userKey: string;
  productKey: string;
  productId: string;
  providerSubscriptionId: string | null;
  amountCents: number;
  baseAmountCents: number;
  netAmountCents: number;
  currency: 'USD';
  grantMicroSparks: number;
  paidAt: string;
  occurredAt: string;
}>;

const parse = <T>(schema: { parse(value: unknown): T }, value: unknown) => schema.parse(withArangoKey(value as Record<string, unknown>));

export interface CommerceRepository {
  userExists(userKey: string): Promise<boolean>;
  listProducts(activeOnly?: boolean): Promise<Product[]>;
  getProductByProductId(productId: string): Promise<Product | null>;
  getProductByProviderId(providerProductId: string): Promise<Product | null>;
  updateProductProviderId(productKey: string, providerProductId: string | null, updatedAt: string): Promise<void>;
  claimCheckout(input: PaymentCheckout): Promise<{ status: 'claimed' | 'replayed' | 'pending' | 'conflict' | 'subscription_exists' | 'account_missing'; checkout: PaymentCheckout }>;
  completeCheckout(key: string, providerCheckoutId: string, checkoutUrl: string, updatedAt: string): Promise<PaymentCheckout>;
  markCheckoutCompleted(providerCheckoutId: string, updatedAt: string): Promise<PaymentCheckout | null>;
  markCheckoutFailed(providerCheckoutId: string, failureCode: string, updatedAt: string): Promise<PaymentCheckout | null>;
  failCheckout(key: string, failureCode: string, updatedAt: string): Promise<void>;
  listRecoverablePendingCheckouts(userKey: string, pendingCutoff: string): Promise<Array<{ checkout: PaymentCheckout; productId: string }>>;
  getCurrentSubscription(userKey: string): Promise<Subscription | null>;
  listSubscriptionsByUser(userKey: string): Promise<Subscription[]>;
  upsertSubscription(input: Subscription): Promise<{ status: 'applied' | 'stale'; subscription: Subscription }>;
  fulfillPaidOrder(input: PaidOrderFulfillment): Promise<{ status: 'applied' | 'duplicate'; order: PaymentOrder }>;
  applyOrderRefund(providerOrderId: string, refundedAmountCents: number, refundedAt: string): Promise<{ status: 'applied' | 'duplicate' | 'stale'; order: PaymentOrder } | null>;
}

export function createArangoCommerceRepository(database: CommerceDatabase = db as unknown as CommerceDatabase, transact: CommerceTransactionRunner = (collections, operation) => withDatabaseTransaction(database as never, collections, operation as never)): CommerceRepository {
  const repository: CommerceRepository = {
    async userExists(userKey) {
      const cursor = await database.query('LET user = DOCUMENT(users, @userKey) RETURN user != null && user.deletionRequestedAt == null', { userKey });
      return await cursor.next() === true;
    },
    async listProducts(activeOnly = false) {
      const cursor = await database.query('FOR product IN products FILTER !@activeOnly || product.active == true SORT product.productId ASC, product._key ASC RETURN product', { activeOnly });
      return (await cursor.all()).map((value) => parse(productSchema, value));
    },
    async getProductByProductId(productId) {
      const cursor = await database.query('FOR product IN products FILTER product.productId == @productId LIMIT 1 RETURN product', { productId });
      const value = await cursor.next();
      return value ? parse(productSchema, value) : null;
    },
    async getProductByProviderId(providerProductId) {
      const cursor = await database.query('FOR product IN products FILTER product.providerProductId == @providerProductId LIMIT 1 RETURN product', { providerProductId });
      const value = await cursor.next();
      return value ? parse(productSchema, value) : null;
    },
    async updateProductProviderId(productKey, providerProductId, updatedAt) {
      await database.query('UPDATE @productKey WITH { providerProductId: @providerProductId, updatedAt: @updatedAt } IN products', { productKey, providerProductId, updatedAt });
    },
    async claimCheckout(input) {
      const valid = paymentCheckoutSchema.parse(input);
      return transact({ read: ['products', 'subscriptions', 'users'], write: ['paymentCheckouts'] }, async (transaction) => {
        const userCursor = await transaction.query('LET user = DOCUMENT(users, @userKey) RETURN user != null && user.deletionRequestedAt == null', { userKey: valid.userKey });
        if (await userCursor.next() !== true) return { status: 'account_missing' as const, checkout: valid };
        const cursor = await transaction.query('FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout.idempotencyKey == @idempotencyKey LIMIT 1 RETURN checkout', valid);
        const existingValue = await cursor.next();
        if (existingValue) {
          const existing = parse(paymentCheckoutSchema, existingValue);
          if (existing.requestHash !== valid.requestHash) return { status: 'conflict' as const, checkout: existing };
          if (existing.status === 'open' || existing.status === 'completed') return { status: 'replayed' as const, checkout: existing };
          if (existing.status === 'pending' && existing.updatedAt >= new Date(new Date(valid.updatedAt).getTime() - 5 * 60_000).toISOString()) return { status: 'pending' as const, checkout: existing };
          const blocker = await transaction.query('LET product = DOCUMENT(products, @productKey) LET activeSubscription = product != null && product.type == "subscription" ? LENGTH(FOR subscription IN subscriptions FILTER subscription.userKey == @userKey && subscription.status NOT IN ["canceled", "unpaid", "incomplete_expired"] LIMIT 1 RETURN 1) > 0 : false LET openCheckout = product != null && product.type == "subscription" ? LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout._key != @excludedCheckoutKey && checkout.status IN ["pending", "open"] LET checkoutProduct = DOCUMENT(products, checkout.productKey) FILTER checkoutProduct != null && checkoutProduct.type == "subscription" LIMIT 1 RETURN 1) > 0 : false RETURN activeSubscription || openCheckout', { userKey: valid.userKey, productKey: valid.productKey, excludedCheckoutKey: existing.key });
          if (await blocker.next()) return { status: 'subscription_exists' as const, checkout: existing };
          await transaction.query('REPLACE @key WITH @checkout IN paymentCheckouts', { key: existing.key, checkout: toArangoDoc({ ...valid, key: existing.key }) });
          return { status: 'claimed' as const, checkout: { ...valid, key: existing.key } };
        }
        const blocker = await transaction.query('LET product = DOCUMENT(products, @productKey) LET activeSubscription = product != null && product.type == "subscription" ? LENGTH(FOR subscription IN subscriptions FILTER subscription.userKey == @userKey && subscription.status NOT IN ["canceled", "unpaid", "incomplete_expired"] LIMIT 1 RETURN 1) > 0 : false LET openCheckout = product != null && product.type == "subscription" ? LENGTH(FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout.status IN ["pending", "open"] LET checkoutProduct = DOCUMENT(products, checkout.productKey) FILTER checkoutProduct != null && checkoutProduct.type == "subscription" LIMIT 1 RETURN 1) > 0 : false RETURN activeSubscription || openCheckout', { userKey: valid.userKey, productKey: valid.productKey });
        if (await blocker.next()) return { status: 'subscription_exists' as const, checkout: valid };
        await transaction.query('INSERT @checkout INTO paymentCheckouts', { checkout: toArangoDoc(valid) });
        return { status: 'claimed' as const, checkout: valid };
      });
    },
    async completeCheckout(key, providerCheckoutId, checkoutUrl, updatedAt) {
      const cursor = await database.query('UPDATE @key WITH { status: "open", providerCheckoutId: @providerCheckoutId, checkoutUrl: @checkoutUrl, failureCode: null, updatedAt: @updatedAt } IN paymentCheckouts RETURN NEW', { key, providerCheckoutId, checkoutUrl, updatedAt });
      return parse(paymentCheckoutSchema, await cursor.next());
    },
    async markCheckoutCompleted(providerCheckoutId, updatedAt) {
      const cursor = await database.query('FOR checkout IN paymentCheckouts FILTER checkout.providerCheckoutId == @providerCheckoutId UPDATE checkout WITH { status: "completed", updatedAt: @updatedAt } IN paymentCheckouts RETURN NEW', { providerCheckoutId, updatedAt });
      const value = await cursor.next();
      return value ? parse(paymentCheckoutSchema, value) : null;
    },
    async markCheckoutFailed(providerCheckoutId, failureCode, updatedAt) {
      const cursor = await database.query('FOR checkout IN paymentCheckouts FILTER checkout.providerCheckoutId == @providerCheckoutId UPDATE checkout WITH { status: "failed", failureCode: @failureCode, updatedAt: @updatedAt } IN paymentCheckouts RETURN NEW', { providerCheckoutId, failureCode, updatedAt });
      const value = await cursor.next();
      return value ? parse(paymentCheckoutSchema, value) : null;
    },
    async failCheckout(key, failureCode, updatedAt) {
      await database.query('UPDATE @key WITH { status: "failed", failureCode: @failureCode, updatedAt: @updatedAt } IN paymentCheckouts', { key, failureCode, updatedAt });
    },
    async listRecoverablePendingCheckouts(userKey, pendingCutoff) {
      const cursor = await database.query('FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey && checkout.status == "pending" && checkout.updatedAt < @pendingCutoff LET product = DOCUMENT(products, checkout.productKey) FILTER product != null RETURN { checkout, productId: product.productId }', { userKey, pendingCutoff });
      return (await cursor.all()).map((value) => {
        const item = value as { checkout: Record<string, unknown>; productId: string };
        return { checkout: parse(paymentCheckoutSchema, item.checkout), productId: item.productId };
      });
    },
    async getCurrentSubscription(userKey) {
      const cursor = await database.query('FOR subscription IN subscriptions FILTER subscription.userKey == @userKey SORT subscription.createdAt DESC, subscription._key DESC LIMIT 1 RETURN subscription', { userKey });
      const value = await cursor.next();
      return value ? parse(subscriptionSchema, value) : null;
    },
    async listSubscriptionsByUser(userKey) {
      const cursor = await database.query('FOR subscription IN subscriptions FILTER subscription.userKey == @userKey SORT subscription.createdAt ASC, subscription._key ASC RETURN subscription', { userKey });
      return (await cursor.all()).map((value) => parse(subscriptionSchema, value));
    },
    async upsertSubscription(input) {
      const valid = subscriptionSchema.parse(input);
      return transact({ write: ['subscriptions'] }, async (transaction) => {
        const existingCursor = await transaction.query('FOR item IN subscriptions FILTER item.providerSubscriptionId == @providerSubscriptionId LIMIT 1 RETURN item', { providerSubscriptionId: valid.providerSubscriptionId });
        const value = await existingCursor.next();
        if (value) {
          const existing = parse(subscriptionSchema, value);
          if (existing.providerModifiedAt && valid.providerModifiedAt && valid.providerModifiedAt <= existing.providerModifiedAt) return { status: 'stale' as const, subscription: existing };
          const cursor = await transaction.query('UPDATE @key WITH UNSET(@subscription, "_key", "createdAt") IN subscriptions RETURN NEW', { key: existing.key, subscription: toArangoDoc(valid) });
          return { status: 'applied' as const, subscription: parse(subscriptionSchema, await cursor.next()) };
        }
        const cursor = await transaction.query('INSERT @subscription INTO subscriptions RETURN NEW', { subscription: toArangoDoc(valid) });
        return { status: 'applied' as const, subscription: parse(subscriptionSchema, await cursor.next()) };
      });
    },
    async fulfillPaidOrder(input) {
      return transact({ write: ['paymentOrders', 'users', 'sparkTransactions'] }, async (transaction) => {
        const replayCursor = await transaction.query('FOR order IN paymentOrders FILTER order.providerOrderId == @providerOrderId LIMIT 1 RETURN order', { providerOrderId: input.providerOrderId });
        const replay = await replayCursor.next();
        if (replay) {
          const existing = parse(paymentOrderSchema, replay);
          const immutableFactsMatch = existing.userKey === input.userKey
            && existing.productKey === input.productKey
            && existing.providerSubscriptionId === input.providerSubscriptionId
            && existing.baseAmountCents === input.baseAmountCents
            && existing.netAmountCents === input.netAmountCents
            && existing.amountCents === input.amountCents
            && existing.currency === input.currency
            && existing.grantMicroSparks === input.grantMicroSparks;
          if (!immutableFactsMatch) throw new Error('Provider order ID conflicts with immutable paid-order facts.');
          return { status: 'duplicate' as const, order: existing };
        }
        const orderKey = newId();
        const transactionKey = newId();
        const requestHash = createHash('sha256').update(`purchase\u0000${input.providerOrderId}\u0000${input.productKey}\u0000${input.userKey}\u0000${input.grantMicroSparks}`).digest('hex');
        const ledger = sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse({ key: transactionKey, userKey: input.userKey, kind: 'purchase', deltaMicroSparks: input.grantMicroSparks, idempotencyKey: `purchase:${input.providerOrderId}`, requestHash, metadata: { providerOrderId: input.providerOrderId, productId: input.productId }, createdAt: input.occurredAt });
        const order = paymentOrderSchema.parse({ key: orderKey, providerOrderId: input.providerOrderId, userKey: input.userKey, productKey: input.productKey, providerSubscriptionId: input.providerSubscriptionId, amountCents: input.amountCents, baseAmountCents: input.baseAmountCents, netAmountCents: input.netAmountCents, grantMicroSparks: input.grantMicroSparks, currency: input.currency, status: 'paid', sparkTransactionKey: transactionKey, refundSparkTransactionKeys: [], refundedAmountCents: 0, clawedBackMicroSparks: 0, refundDebtMicroSparks: 0, paidAt: input.paidAt, refundedAt: null, createdAt: input.occurredAt, updatedAt: input.occurredAt });
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          FILTER user != null
          LET previousBalance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
          LET previousDebt = IS_NUMBER(user.microSparkDebt) ? user.microSparkDebt : 0
          LET debtPayment = MIN([previousDebt, @grant])
          LET nextBalance = previousBalance + @grant - debtPayment
          FILTER nextBalance <= @maxSafeInteger
          UPDATE user WITH { microSparkBalance: nextBalance, microSparkDebt: previousDebt - debtPayment } IN users
          INSERT MERGE(@ledger, { balanceAfterMicroSparks: nextBalance }) INTO sparkTransactions
          INSERT @order INTO paymentOrders
          RETURN @order
        `, { userKey: input.userKey, grant: input.grantMicroSparks, maxSafeInteger: Number.MAX_SAFE_INTEGER, ledger: toArangoDoc(ledger), order: toArangoDoc(order) });
        if (!await cursor.next()) throw new Error('Paid order references an unknown user or would overflow the Spark balance.');
        return { status: 'applied' as const, order };
      });
    },
    async applyOrderRefund(providerOrderId, refundedAmountCents, refundedAt) {
      return transact({ write: ['paymentOrders', 'users', 'sparkTransactions'] }, async (transaction) => {
        const orderCursor = await transaction.query('FOR item IN paymentOrders FILTER item.providerOrderId == @providerOrderId LIMIT 1 RETURN item', { providerOrderId });
        const value = await orderCursor.next();
        if (!value) return null;
        const order = parse(paymentOrderSchema, value);
        if (refundedAmountCents < order.refundedAmountCents) return { status: 'stale' as const, order };
        if (refundedAmountCents === order.refundedAmountCents) return { status: 'duplicate' as const, order };
        if (refundedAmountCents > order.netAmountCents) throw new Error('Refund exceeds the immutable paid net amount.');
        const targetClawback = refundedAmountCents === order.netAmountCents
          ? order.grantMicroSparks
          : Number(BigInt(order.grantMicroSparks) * BigInt(refundedAmountCents) / BigInt(order.netAmountCents));
        const remaining = targetClawback - order.clawedBackMicroSparks;
        if (remaining < 0) return { status: 'stale' as const, order };
        const transactionKey = newId();
        const requestHash = createHash('sha256').update(`purchase-refund\u0000${providerOrderId}\u0000${refundedAmountCents}\u0000${targetClawback}`).digest('hex');
        const ledger = remaining > 0 ? sparkTransactionSchema.omit({ balanceAfterMicroSparks: true }).parse({ key: transactionKey, userKey: order.userKey, kind: 'adjustment', deltaMicroSparks: -remaining, idempotencyKey: `purchase-refund:${providerOrderId}:${refundedAmountCents}`, requestHash, metadata: { providerOrderId, refundedAmountCents, category: 'purchase-refund' }, createdAt: refundedAt }) : null;
        const cursor = await transaction.query(`
          LET user = DOCUMENT(users, @userKey)
          FILTER user != null
          LET balance = IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0
          LET priorDebt = IS_NUMBER(user.microSparkDebt) ? user.microSparkDebt : 0
          LET recovered = MIN([balance, @remaining])
          LET debt = @remaining - recovered
          UPDATE user WITH { microSparkBalance: balance - recovered, microSparkDebt: priorDebt + debt } IN users
          LET ledger = @ledger == null || recovered == 0 ? null : FIRST(INSERT MERGE(@ledger, { deltaMicroSparks: -recovered, balanceAfterMicroSparks: balance - recovered }) INTO sparkTransactions RETURN NEW)
          UPDATE @orderKey WITH {
            status: @refundedAmountCents == @netAmountCents ? "refunded" : "partially_refunded",
            refundedAmountCents: @refundedAmountCents,
            clawedBackMicroSparks: @targetClawback,
            refundDebtMicroSparks: @priorRefundDebt + debt,
            refundSparkTransactionKeys: ledger == null ? @priorRefundTransactionKeys : APPEND(@priorRefundTransactionKeys, ledger._key),
            refundedAt: @refundedAt,
            updatedAt: @refundedAt
          } IN paymentOrders
          RETURN NEW
        `, { userKey: order.userKey, remaining, ledger: ledger ? toArangoDoc(ledger) : null, orderKey: order.key, refundedAmountCents, netAmountCents: order.netAmountCents, targetClawback, priorRefundDebt: order.refundDebtMicroSparks, priorRefundTransactionKeys: order.refundSparkTransactionKeys, refundedAt });
        return { status: 'applied' as const, order: parse(paymentOrderSchema, await cursor.next()) };
      });
    },
  };
  return Object.freeze(repository);
}
