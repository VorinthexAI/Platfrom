import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USER_SESSIONS_COLLECTION = 'userSessions';

/**
 * One node per authenticated presence session — the authed twin of a
 * `visitorSessions` node, owned by the platform ("this"). Created when a
 * signed-in user joins the live galaxy over the presence pub/sub, closed
 * (disconnectedAt stamped) when they leave or their Redis session key
 * expires. A new entry is written per session, exactly like visitorSessions;
 * Redis is the live truth, these nodes are the durable ledger it syncs into.
 */
export const userSessionSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  /** The signed-in user this session belongs to. */
  userId: z.string(),
  alias: z.string(),
  /** Redis presence session this node mirrors. */
  sessionKey: z.string(),
  connectedAt: z.string(),
  disconnectedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type UserSession = z.infer<typeof userSessionSchema>;

// Presence writes are hot-path: no fields are worth a vector, never embed.
const helpers = createNodeHelpers(USER_SESSIONS_COLLECTION, userSessionSchema, []);

export const insertUserSession = helpers.insert;
export const getUserSessionById = helpers.getById;
export const updateUserSession = helpers.updateById;
export const deleteUserSession = helpers.deleteById;
export const upsertUserSessionByKey = helpers.upsertByKey;
export const getAllUserSessionsChunked = helpers.getAllChunked;
export const listUserSessionsPage = helpers.listPage;

/** How many authenticated presence sessions are currently open. */
export async function countOpenUserSessions(): Promise<number> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(USER_SESSIONS_COLLECTION)}
      FILTER a.disconnectedAt == null
      COLLECT WITH COUNT INTO open
      RETURN open
  `);
  const count = await cursor.next();
  return typeof count === 'number' ? count : 0;
}

/** Open sessions (no disconnect stamp yet), oldest first, bounded. */
export async function listOpenUserSessions(limit = 500): Promise<UserSession[]> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(USER_SESSIONS_COLLECTION)}
      FILTER a.disconnectedAt == null
      SORT a.connectedAt ASC
      LIMIT ${limit}
      RETURN a
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userSessionSchema.parse(withArangoKey(doc)));
}

export async function getOpenUserSessionBySessionKey(sessionKey: string): Promise<UserSession | null> {
  const cursor = await db.query(aql`
    FOR a IN ${db.collection(USER_SESSIONS_COLLECTION)}
      FILTER a.sessionKey == ${sessionKey} && a.disconnectedAt == null
      LIMIT 1
      RETURN a
  `);
  const doc = await cursor.next();
  return doc ? userSessionSchema.parse(withArangoKey(doc)) : null;
}

/** Stamp a session closed; idempotent (only touches still-open nodes). */
export async function markUserSessionDisconnected(key: string, disconnectedAt: string): Promise<void> {
  await db.query(aql`
    FOR a IN ${db.collection(USER_SESSIONS_COLLECTION)}
      FILTER a._key == ${key} && a.disconnectedAt == null
      UPDATE a WITH { disconnectedAt: ${disconnectedAt}, updatedAt: ${disconnectedAt} } IN ${db.collection(USER_SESSIONS_COLLECTION)}
  `);
}
