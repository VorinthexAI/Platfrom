import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const VISITORS_COLLECTION = 'visitors';

/**
 * One node per distinct explorer of the public galaxy, keyed by whichever
 * identity we have: the hashed email (authed / known visitors) or the
 * 1-day distinct-id cookie (anonymous fallback). The alias is assigned
 * here first — from the user's alias when authed, otherwise rolled from
 * the same 250×250 lists used at signup — and follows the visitor into
 * `users` when they later join the waitlist.
 */
export const visitorSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  /** Client-generated distinct id (1-day cookie); null for token-only visitors. */
  distinctId: z.string().nullable().default(null),
  /** sha256 of the normalized email; null until the visitor is known. */
  emailHash: z.string().nullable().default(null),
  /** Linked user once the visitor authenticates or joins the waitlist. */
  userId: z.string().nullable().default(null),
  alias: z.string(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Visitor = z.infer<typeof visitorSchema>;

// Presence writes are hot-path: no fields are worth a vector, never embed.
const helpers = createNodeHelpers(VISITORS_COLLECTION, visitorSchema, []);

export const insertVisitor = helpers.insert;
export const getVisitorById = helpers.getById;
export const updateVisitor = helpers.updateById;
export const deleteVisitor = helpers.deleteById;
export const upsertVisitorByKey = helpers.upsertByKey;
export const getAllVisitorsChunked = helpers.getAllChunked;
export const listVisitorsPage = helpers.listPage;

export async function getVisitorByEmailHash(emailHash: string): Promise<Visitor | null> {
  const cursor = await db.query(aql`
    FOR v IN ${db.collection(VISITORS_COLLECTION)}
      FILTER v.emailHash == ${emailHash}
      LIMIT 1
      RETURN v
  `);
  const doc = await cursor.next();
  return doc ? visitorSchema.parse(withArangoKey(doc)) : null;
}

export async function getVisitorByDistinctId(distinctId: string): Promise<Visitor | null> {
  const cursor = await db.query(aql`
    FOR v IN ${db.collection(VISITORS_COLLECTION)}
      FILTER v.distinctId == ${distinctId}
      LIMIT 1
      RETURN v
  `);
  const doc = await cursor.next();
  return doc ? visitorSchema.parse(withArangoKey(doc)) : null;
}
