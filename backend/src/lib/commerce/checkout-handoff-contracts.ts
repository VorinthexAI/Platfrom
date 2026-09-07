import { z } from 'zod';
import { polarCheckoutUrlSchema, productIdSchema, publicProductSchema } from './contracts';

export const CHECKOUT_HANDOFF_PURPOSE = 'payment-checkout' as const;
export const checkoutHandoffTokenSchema = z.string().regex(/^vch_[A-Za-z0-9_-]{43}$/);
const timestamp = z.string().datetime({ offset: true });

export const checkoutHandoffSchema = z.object({
  key: z.string().cuid(),
  tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  issuanceKey: z.string().regex(/^[a-f0-9]{64}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  purpose: z.literal(CHECKOUT_HANDOFF_PURPOSE),
  userKey: z.string().cuid(),
  productId: productIdSchema,
  checkoutIdempotencyKey: z.string().trim().min(1).max(200),
  expiresAt: timestamp,
  claimLeaseKey: z.string().cuid().nullable(),
  claimLeaseExpiresAt: timestamp.nullable(),
  consumedAt: timestamp.nullable(),
  checkoutKey: z.string().cuid().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
}).strict().superRefine((handoff, context) => {
  if ((handoff.claimLeaseKey === null) !== (handoff.claimLeaseExpiresAt === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['claimLeaseKey'], message: 'Claim lease fields must both be set or null.' });
  if ((handoff.consumedAt === null) !== (handoff.checkoutKey === null)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['consumedAt'], message: 'Consumption fields must both be set or null.' });
});

export const checkoutHandoffInputSchema = z.object({ token: checkoutHandoffTokenSchema }).strict();
export const checkoutHandoffIssueResultSchema = z.object({ url: z.string().url(), expiresAt: timestamp }).strict();
export const checkoutHandoffInspectResultSchema = z.object({ product: publicProductSchema, expiresAt: timestamp }).strict();
export const checkoutHandoffContinueResultSchema = z.object({ url: polarCheckoutUrlSchema }).strict();
export type CheckoutHandoff = z.infer<typeof checkoutHandoffSchema>;
