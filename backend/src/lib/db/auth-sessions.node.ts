import { aql } from 'arangojs';
import { z } from 'zod';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const AUTH_SESSIONS_COLLECTION = 'authSessions';

export const authSessionSchema = z.object({
  key: z.string(),
  userId: z.string(),
  identityType: z.enum(['user', 'member', 'superAdmin']).optional(),
  refreshTokenHash: z.string(),
  expiresAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().default(null),
  founderMembershipKey: z.string().nullable().default(null),
  founderMfaVersion: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number()).default([]),
});

export type AuthSession = z.infer<typeof authSessionSchema>;

const helpers = createNodeHelpers(AUTH_SESSIONS_COLLECTION, authSessionSchema, []);
export const insertAuthSession = helpers.insert;
export const getAuthSessionById = helpers.getById;

export async function getAuthSessionByRefreshTokenHash(refreshTokenHash: string): Promise<AuthSession | null> {
  const cursor = await db.query(aql`
    FOR session IN ${db.collection(AUTH_SESSIONS_COLLECTION)}
      FILTER session.refreshTokenHash == ${refreshTokenHash}
      LIMIT 1
      RETURN session
  `);
  const document = await cursor.next();
  return document ? authSessionSchema.parse(withArangoKey(document)) : null;
}

export async function revokeAuthSession(key: string, userId: string, revokedAt: string): Promise<boolean> {
  const cursor = await db.query(aql`
    FOR session IN ${db.collection(AUTH_SESSIONS_COLLECTION)}
      FILTER session._key == ${key} && session.userId == ${userId} && session.revokedAt == null
      UPDATE session WITH { revokedAt: ${revokedAt}, updatedAt: ${revokedAt} } IN ${db.collection(AUTH_SESSIONS_COLLECTION)}
      RETURN NEW
  `);
  return Boolean(await cursor.next());
}
