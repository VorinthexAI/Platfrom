import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const PAYMENT_ORDERS_COLLECTION = 'paymentOrders';

export const paymentOrderSchema = z.object({
  key: z.string(),
  userId: z.string().nullable().default(null),
  productId: z.string().nullable().default(null),
  checkoutId: z.string().nullable().default(null),
  provider: z.literal('polar').default('polar'),
  providerOrderId: z.string(),
  providerSubscriptionId: z.string().nullable().default(null),
  amountCents: z.number().int().min(0),
  currency: z.string(),
  status: z.enum(['paid', 'partially_refunded', 'refunded']),
  paidAt: z.string().nullable().default(null),
  refundedAt: z.string().nullable().default(null),
  rawEvent: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type PaymentOrder = z.infer<typeof paymentOrderSchema>;

// Financial ledger entry — ids, amounts, and a status enum are all filter fields,
// not search text, so this node is never embedded.
const helpers = createNodeHelpers(PAYMENT_ORDERS_COLLECTION, paymentOrderSchema);

export const insertPaymentOrder = helpers.insert;
export const getPaymentOrderById = helpers.getById;
export const updatePaymentOrder = helpers.updateById;
export const deletePaymentOrder = helpers.deleteById;
export const upsertPaymentOrderByKey = helpers.upsertByKey;
export const getAllPaymentOrdersChunked = helpers.getAllChunked;
export const listPaymentOrdersPage = helpers.listPage;

export async function getPaymentOrderByProviderOrderId(
  provider: string,
  providerOrderId: string,
): Promise<PaymentOrder | null> {
  const cursor = await db.query(aql`
    FOR o IN ${db.collection(PAYMENT_ORDERS_COLLECTION)}
      FILTER o.provider == ${provider} && o.providerOrderId == ${providerOrderId}
      LIMIT 1
      RETURN o
  `);
  const doc = await cursor.next();
  return doc ? paymentOrderSchema.parse(withArangoKey(doc)) : null;
}
