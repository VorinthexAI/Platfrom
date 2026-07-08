import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const VISITOR_SESSIONS_COLLECTION = 'visitorSessions';

export const presenceSourceSchema = z.enum(['web', 'mobile', 'desktop', 'tv']);

/**
 * One node per anonymous presence session — a sub-node of a `visitors`
 * node, owned by the platform ("this"). Created when an anonymous visitor
 * joins the live galaxy over the presence pub/sub, closed (disconnectedAt
 * stamped) when they leave or their Redis session key expires. Redis is the
 * live truth; these nodes are the durable ledger it syncs into. Authenticated
 * sessions live in the parallel `userSessions` funnel instead.
 */
export const visitorSessionSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  /** Parent visitor node. */
  visitorId: z.string(),
  alias: z.string(),
  source: presenceSourceSchema.default('web'),
  /** Redis presence session this node mirrors. */
  sessionKey: z.string(),
  connectedAt: z.string(),
  disconnectedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type VisitorSession = z.infer<typeof visitorSessionSchema>;

// Presence writes are hot-path: no fields are worth a vector, never embed.
const helpers = createNodeHelpers(VISITOR_SESSIONS_COLLECTION, visitorSessionSchema, []);

export const insertVisitorSession = helpers.insert;
export const getVisitorSessionById = helpers.getById;
export const updateVisitorSession = helpers.updateById;
export const deleteVisitorSession = helpers.deleteById;
export const upsertVisitorSessionByKey = helpers.upsertByKey;
export const getAllVisitorSessionsChunked = helpers.getAllChunked;
export const listVisitorSessionsPage = helpers.listPage;

/** How many anonymous presence sessions are currently open. */
export async function countOpenVisitorSessions(): Promise<number> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(VISITOR_SESSIONS_COLLECTION)}
      FILTER a.disconnectedAt == null
      COLLECT WITH COUNT INTO open
      RETURN open
  `);
  const count = await cursor.next();
  return typeof count === 'number' ? count : 0;
}

/** Open sessions (no disconnect stamp yet), oldest first, bounded. */
export async function listOpenVisitorSessions(limit = 500): Promise<VisitorSession[]> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(VISITOR_SESSIONS_COLLECTION)}
      FILTER a.disconnectedAt == null
      SORT a.connectedAt ASC
      LIMIT ${limit}
      RETURN a
  `);
  const docs = await cursor.all();
  return docs.map((doc) => visitorSessionSchema.parse(withArangoKey(doc)));
}

export async function getOpenVisitorSessionBySessionKey(sessionKey: string): Promise<VisitorSession | null> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(VISITOR_SESSIONS_COLLECTION)}
      FILTER a.sessionKey == ${sessionKey} && a.disconnectedAt == null
      LIMIT 1
      RETURN a
  `);
  const doc = await cursor.next();
  return doc ? visitorSessionSchema.parse(withArangoKey(doc)) : null;
}

/** Stamp a session closed; idempotent (only touches still-open nodes). */
export async function markVisitorSessionDisconnected(key: string, disconnectedAt: string): Promise<void> {
  await db.query(aql`
    FOR a IN ${db.collection(VISITOR_SESSIONS_COLLECTION)}
      FILTER a._key == ${key} && a.disconnectedAt == null
      UPDATE a WITH { disconnectedAt: ${disconnectedAt}, updatedAt: ${disconnectedAt} } IN ${db.collection(VISITOR_SESSIONS_COLLECTION)}
  `);
}
