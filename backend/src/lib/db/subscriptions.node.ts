import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const SUBSCRIPTIONS_COLLECTION = 'subscriptions';

export const subscriptionSchema = z.object({
  key: z.string(),
  userId: z.string(),
  productId: z.string(),
  provider: z.literal('polar').default('polar'),
  providerSubscriptionId: z.string(),
  status: z.enum(['active', 'trialing', 'past_due', 'canceled', 'revoked']),
  currentPeriodStart: z.string().nullable().default(null),
  currentPeriodEnd: z.string().nullable().default(null),
  cancelAtPeriodEnd: z.boolean().default(false),
  canceledAt: z.string().nullable().default(null),
  gracePeriodEnd: z.string().nullable().default(null),
  rawEvent: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Subscription = z.infer<typeof subscriptionSchema>;

// Operational billing state (ids, a status enum, timestamps) — no search text, so
// this node is never embedded.
const helpers = createNodeHelpers(SUBSCRIPTIONS_COLLECTION, subscriptionSchema);

export const insertSubscription = helpers.insert;
export const getSubscriptionById = helpers.getById;
export const updateSubscription = helpers.updateById;
export const deleteSubscription = helpers.deleteById;
export const getAllSubscriptionsChunked = helpers.getAllChunked;
export const listSubscriptionsPage = helpers.listPage;

export async function getSubscriptionByProviderSubscriptionId(
  provider: string,
  providerSubscriptionId: string,
): Promise<Subscription | null> {
  const cursor = await db.query(aql`
    FOR s IN ${db.collection(SUBSCRIPTIONS_COLLECTION)}
      FILTER s.provider == ${provider} && s.providerSubscriptionId == ${providerSubscriptionId}
      LIMIT 1
      RETURN s
  `);
  const doc = await cursor.next();
  return doc ? subscriptionSchema.parse(withArangoKey(doc)) : null;
}

export async function listSubscriptionsByUserId(userId: string): Promise<Subscription[]> {
  const cursor = await db.query(aql`
    FOR s IN ${db.collection(SUBSCRIPTIONS_COLLECTION)}
      FILTER s.userId == ${userId}
      RETURN s
  `);
  const docs = await cursor.all();
  return docs.map((doc) => subscriptionSchema.parse(withArangoKey(doc)));
}

export async function hasSubscriptionInStatuses(userId: string, statuses: string[]): Promise<boolean> {
  const cursor = await db.query(aql`
    FOR s IN ${db.collection(SUBSCRIPTIONS_COLLECTION)}
      FILTER s.userId == ${userId} && s.status IN ${statuses}
      LIMIT 1
      RETURN 1
  `);
  return (await cursor.next()) !== undefined;
}
