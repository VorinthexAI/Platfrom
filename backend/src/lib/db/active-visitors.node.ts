import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const ACTIVE_VISITORS_COLLECTION = 'activeVisitors';

/**
 * One node per presence session — a sub-node of a `visitors` node, owned
 * by the platform ("this"). Created when a visitor joins the live galaxy
 * over the presence pub/sub, closed (disconnectedAt stamped) when they
 * leave or their Redis session key expires. Redis is the live truth;
 * these nodes are the durable ledger it syncs into.
 */
export const activeVisitorSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  /** Parent visitor node. */
  visitorId: z.string(),
  /** sha256 of the normalized email when known; null for anonymous visitors. */
  emailHash: z.string().nullable().default(null),
  alias: z.string(),
  /** Redis presence session this node mirrors. */
  sessionKey: z.string(),
  connectedAt: z.string(),
  disconnectedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type ActiveVisitor = z.infer<typeof activeVisitorSchema>;

// Presence writes are hot-path: no fields are worth a vector, never embed.
const helpers = createNodeHelpers(ACTIVE_VISITORS_COLLECTION, activeVisitorSchema, []);

export const insertActiveVisitor = helpers.insert;
export const getActiveVisitorById = helpers.getById;
export const updateActiveVisitor = helpers.updateById;
export const deleteActiveVisitor = helpers.deleteById;
export const upsertActiveVisitorByKey = helpers.upsertByKey;
export const getAllActiveVisitorsChunked = helpers.getAllChunked;
export const listActiveVisitorsPage = helpers.listPage;

/** Open sessions (no disconnect stamp yet), oldest first, bounded. */
export async function listOpenActiveVisitors(limit = 500): Promise<ActiveVisitor[]> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(ACTIVE_VISITORS_COLLECTION)}
      FILTER a.disconnectedAt == null
      SORT a.connectedAt ASC
      LIMIT ${limit}
      RETURN a
  `);
  const docs = await cursor.all();
  return docs.map((doc) => activeVisitorSchema.parse(withArangoKey(doc)));
}

export async function getOpenActiveVisitorBySessionKey(sessionKey: string): Promise<ActiveVisitor | null> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(ACTIVE_VISITORS_COLLECTION)}
      FILTER a.sessionKey == ${sessionKey} && a.disconnectedAt == null
      LIMIT 1
      RETURN a
  `);
  const doc = await cursor.next();
  return doc ? activeVisitorSchema.parse(withArangoKey(doc)) : null;
}

/** Stamp a session closed; idempotent (only touches still-open nodes). */
export async function markActiveVisitorDisconnected(key: string, disconnectedAt: string): Promise<void> {
  await db.query(aql`
    FOR a IN ${db.collection(ACTIVE_VISITORS_COLLECTION)}
      FILTER a._key == ${key} && a.disconnectedAt == null
      UPDATE a WITH { disconnectedAt: ${disconnectedAt}, updatedAt: ${disconnectedAt} } IN ${db.collection(ACTIVE_VISITORS_COLLECTION)}
  `);
}
