import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const PAYMENT_CHECKOUTS_COLLECTION = 'paymentCheckouts';

export const paymentCheckoutSchema = z.object({
  key: z.string(),
  userId: z.string(),
  productId: z.string(),
  idempotencyKey: z.string(),
  provider: z.literal('polar').default('polar'),
  providerCheckoutId: z.string().nullable().default(null),
  checkoutUrl: z.string().nullable().default(null),
  status: z.enum(['pending', 'created', 'paid', 'expired', 'failed']).default('pending'),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type PaymentCheckout = z.infer<typeof paymentCheckoutSchema>;

// Purely transactional/operational (ids, an opaque idempotency key, a status enum
// better handled as an AQL filter) — no field here is meaningful search text, so
// this node is never embedded.
const helpers = createNodeHelpers(PAYMENT_CHECKOUTS_COLLECTION, paymentCheckoutSchema);

export const insertPaymentCheckout = helpers.insert;
export const getPaymentCheckoutById = helpers.getById;
export const updatePaymentCheckout = helpers.updateById;
export const deletePaymentCheckout = helpers.deleteById;
export const upsertPaymentCheckoutByKey = helpers.upsertByKey;
export const getAllPaymentCheckoutsChunked = helpers.getAllChunked;
export const listPaymentCheckoutsPage = helpers.listPage;

export async function getPaymentCheckoutByUserAndIdempotencyKey(
  userId: string,
  idempotencyKey: string,
): Promise<PaymentCheckout | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(PAYMENT_CHECKOUTS_COLLECTION)}
      FILTER c.userId == ${userId} && c.idempotencyKey == ${idempotencyKey}
      LIMIT 1
      RETURN c
  `);
  const doc = await cursor.next();
  return doc ? paymentCheckoutSchema.parse(withArangoKey(doc)) : null;
}

export async function getPaymentCheckoutByProviderCheckoutId(
  provider: string,
  providerCheckoutId: string,
): Promise<PaymentCheckout | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(PAYMENT_CHECKOUTS_COLLECTION)}
      FILTER c.provider == ${provider} && c.providerCheckoutId == ${providerCheckoutId}
      LIMIT 1
      RETURN c
  `);
  const doc = await cursor.next();
  return doc ? paymentCheckoutSchema.parse(withArangoKey(doc)) : null;
}
