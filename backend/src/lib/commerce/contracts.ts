import { z } from 'zod';

const cuid = z.string().cuid();
const timestamp = z.string().datetime({ offset: true });
const boundedProviderId = z.string().trim().min(1).max(200);
const money = z.number().int().safe().positive();

export const polarCheckoutUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['polar.sh', 'www.polar.sh', 'checkout.polar.sh', 'sandbox.polar.sh'].includes(url.hostname)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Checkout URL must use an allowed Polar HTTPS host.' });
});

export const productIdSchema = z.enum([
  'nova.weekly',
  'nova.monthly',
  'nova.monthly.discounted',
  'topup.small',
]);
export const productTypeSchema = z.enum(['subscription', 'one_time']);
export const billingPeriodSchema = z.enum(['week', 'month']);

const productObjectSchema = z.object({
  key: cuid,
  productId: productIdSchema,
  type: productTypeSchema,
  priceCents: money,
  discountedPriceCents: money.nullable(),
  currency: z.literal('USD'),
  billingPeriod: billingPeriodSchema.nullable(),
  sparkGrantMicroSparks: z.number().int().safe().positive(),
  active: z.boolean(),
  providerProductId: boundedProviderId.nullable().default(null),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const productSchema = productObjectSchema.superRefine((product, context) => {
  if ((product.type === 'subscription') !== (product.billingPeriod !== null)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingPeriod'], message: 'Subscription products require a billing period and one-time products forbid one.' });
  }
  if (product.discountedPriceCents !== null && product.discountedPriceCents >= product.priceCents) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['discountedPriceCents'], message: 'A discounted price must be lower than the regular price.' });
  }
});

export const publicProductSchema = productObjectSchema.omit({ providerProductId: true }).superRefine((product, context) => {
  if ((product.type === 'subscription') !== (product.billingPeriod !== null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['billingPeriod'], message: 'Invalid billing period.' });
  if (product.discountedPriceCents !== null && product.discountedPriceCents >= product.priceCents) context.addIssue({ code: z.ZodIssueCode.custom, path: ['discountedPriceCents'], message: 'Invalid discounted price.' });
});

export const paymentCheckoutSchema = z.object({
  key: cuid,
  userKey: cuid,
  productKey: cuid,
  idempotencyKey: z.string().trim().min(1).max(200),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(['pending', 'open', 'completed', 'failed']),
  providerCheckoutId: boundedProviderId.nullable(),
  checkoutUrl: polarCheckoutUrlSchema.nullable(),
  failureCode: z.string().trim().min(1).max(100).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const paymentOrderSchema = z.object({
  key: cuid,
  providerOrderId: boundedProviderId,
  userKey: cuid,
  productKey: cuid,
  providerSubscriptionId: boundedProviderId.nullable(),
  amountCents: z.number().int().safe().nonnegative(),
  baseAmountCents: z.number().int().safe().positive(),
  netAmountCents: z.number().int().safe().positive(),
  grantMicroSparks: z.number().int().safe().positive(),
  currency: z.literal('USD'),
  status: z.enum(['paid', 'partially_refunded', 'refunded']),
  sparkTransactionKey: cuid.nullable(),
  refundSparkTransactionKeys: z.array(cuid).default([]),
  refundedAmountCents: z.number().int().safe().nonnegative().default(0),
  clawedBackMicroSparks: z.number().int().safe().nonnegative().default(0),
  refundDebtMicroSparks: z.number().int().safe().nonnegative().default(0),
  paidAt: timestamp,
  refundedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const subscriptionStatusSchema = z.enum(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']);
export const subscriptionSchema = z.object({
  key: cuid,
  userKey: cuid,
  productKey: cuid,
  providerSubscriptionId: boundedProviderId,
  status: subscriptionStatusSchema,
  cancelAtPeriodEnd: z.boolean(),
  currentPeriodStart: timestamp.nullable(),
  currentPeriodEnd: timestamp.nullable(),
  providerModifiedAt: timestamp.nullable().default(null),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict();

export const checkoutCreateInputSchema = z.object({ productId: productIdSchema }).strict();
export const checkoutCreateResultSchema = z.object({ key: cuid, status: z.enum(['open', 'completed']), url: polarCheckoutUrlSchema }).strict();
export const subscriptionMutationInputSchema = z.object({}).strict();
export const currentSubscriptionResultSchema = subscriptionSchema.omit({ providerSubscriptionId: true }).nullable();

export type Product = z.infer<typeof productSchema>;
export type PublicProduct = z.infer<typeof publicProductSchema>;
export type PaymentCheckout = z.infer<typeof paymentCheckoutSchema>;
export type PaymentOrder = z.infer<typeof paymentOrderSchema>;
export type Subscription = z.infer<typeof subscriptionSchema>;
