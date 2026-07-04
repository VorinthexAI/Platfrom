import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USER_ENTITLEMENTS_COLLECTION = 'userEntitlements';

export const userEntitlementSchema = z.object({
  key: z.string(),
  userId: z.string(),
  productId: z.string(),
  sourceType: z.enum(['order', 'subscription']),
  sourceId: z.string(),
  status: z.enum(['active', 'revoked']).default('active'),
  startsAt: z.string(),
  endsAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type UserEntitlement = z.infer<typeof userEntitlementSchema>;

// Access-control ledger entry (ids, a status enum) — no search text, so this node
// is never embedded.
const helpers = createNodeHelpers(USER_ENTITLEMENTS_COLLECTION, userEntitlementSchema);

export const insertUserEntitlement = helpers.insert;
export const getUserEntitlementById = helpers.getById;
export const updateUserEntitlement = helpers.updateById;
export const deleteUserEntitlement = helpers.deleteById;
export const getAllUserEntitlementsChunked = helpers.getAllChunked;
export const listUserEntitlementsPage = helpers.listPage;

export async function getUserEntitlementBySource(
  sourceType: string,
  sourceId: string,
): Promise<UserEntitlement | null> {
  const cursor = await db.query(aql`
    FOR e IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
      FILTER e.sourceType == ${sourceType} && e.sourceId == ${sourceId}
      LIMIT 1
      RETURN e
  `);
  const doc = await cursor.next();
  return doc ? userEntitlementSchema.parse(withArangoKey(doc)) : null;
}

export async function listActiveEntitlementsByUserAndProduct(
  userId: string,
  productId: string,
): Promise<UserEntitlement[]> {
  const cursor = await db.query(aql`
    FOR e IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
      FILTER e.userId == ${userId} && e.productId == ${productId} && e.status == 'active'
      RETURN e
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userEntitlementSchema.parse(withArangoKey(doc)));
}

export async function listEntitlementsByUserId(userId: string): Promise<UserEntitlement[]> {
  const cursor = await db.query(aql`
    FOR e IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
      FILTER e.userId == ${userId}
      SORT e.createdAt DESC
      RETURN e
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userEntitlementSchema.parse(withArangoKey(doc)));
}

/** Revokes other active subscription-sourced entitlements for this user (used before granting a new one). */
export async function revokeOtherActiveSubscriptionEntitlements(userId: string, excludeSourceId: string): Promise<void> {
  await db.query(aql`
    FOR e IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
      FILTER e.userId == ${userId} && e.sourceType == 'subscription' && e.status == 'active' && e.sourceId != ${excludeSourceId}
      UPDATE e WITH { status: 'revoked', updatedAt: ${new Date().toISOString()} } IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
  `);
}

/**
 * Only one active entitlement per (user, product) is allowed (enforced by a
 * unique index); supersede grants from other sources instead of violating it.
 */
export async function revokeCompetingActiveEntitlements(
  userId: string,
  productId: string,
  sourceType: string,
  sourceId: string,
): Promise<void> {
  await db.query(aql`
    FOR e IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
      FILTER e.userId == ${userId} && e.productId == ${productId} && e.status == 'active'
      FILTER e.sourceType != ${sourceType} || e.sourceId != ${sourceId}
      UPDATE e WITH { status: 'revoked', updatedAt: ${new Date().toISOString()} } IN ${db.collection(USER_ENTITLEMENTS_COLLECTION)}
  `);
}

export async function upsertEntitlementBySource(input: {
  newId: string;
  userId: string;
  productId: string;
  sourceType: 'order' | 'subscription';
  sourceId: string;
  endsAt?: string | null;
}): Promise<UserEntitlement> {
  const now = new Date().toISOString();
  const existing = await getUserEntitlementBySource(input.sourceType, input.sourceId);
  if (existing) {
    return updateUserEntitlement(existing.key, {
      productId: input.productId,
      status: 'active',
      endsAt: input.endsAt ?? null,
      updatedAt: now,
    });
  }
  return insertUserEntitlement({
    key: input.newId,
    userId: input.userId,
    productId: input.productId,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    status: 'active',
    startsAt: now,
    endsAt: input.endsAt ?? null,
    createdAt: now,
    updatedAt: now,
  });
}
