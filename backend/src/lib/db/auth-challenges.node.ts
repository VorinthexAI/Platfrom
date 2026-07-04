import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const AUTH_CHALLENGES_COLLECTION = 'authChallenges';

export const authChallengeSchema = z.object({
  key: z.string(),
  userId: z.string(),
  kind: z.string(),
  tokenHash: z.string(),
  expiresAt: z.string(),
  consumedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type AuthChallenge = z.infer<typeof authChallengeSchema>;

// A short-lived security artifact — tokenHash is a secret and must never be
// embedded; kind is a low-cardinality enum better handled as an AQL filter.
const helpers = createNodeHelpers(AUTH_CHALLENGES_COLLECTION, authChallengeSchema);

export const insertAuthChallenge = helpers.insert;
export const getAuthChallengeById = helpers.getById;
export const updateAuthChallenge = helpers.updateById;
export const deleteAuthChallenge = helpers.deleteById;
export const getAllAuthChallengesChunked = helpers.getAllChunked;
export const listAuthChallengesPage = helpers.listPage;

export async function getAuthChallengeByTokenHash(tokenHash: string): Promise<AuthChallenge | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER c.tokenHash == ${tokenHash}
      LIMIT 1
      RETURN c
  `);
  const doc = await cursor.next();
  return doc ? authChallengeSchema.parse(withArangoKey(doc)) : null;
}

export async function listAuthChallengesByUserAndKind(userId: string, kind: string): Promise<AuthChallenge[]> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER c.userId == ${userId} && c.kind == ${kind}
      RETURN c
  `);
  const docs = await cursor.all();
  return docs.map((doc) => authChallengeSchema.parse(withArangoKey(doc)));
}
