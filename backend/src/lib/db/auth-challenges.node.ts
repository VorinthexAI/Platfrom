import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, isArangoNotFoundError, withArangoKey } from './base';

export const AUTH_CHALLENGES_COLLECTION = 'authChallenges';
export const authIdentityTypeSchema = z.enum(['user', 'member', 'superAdmin']);
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

export const authChallengeSchema = z.object({
  key: z.string(),
  identityKey: z.string(),
  identityType: authIdentityTypeSchema,
  kind: z.string(),
  tokenHash: z.string(),
  expiresAt: z.string(),
  consumedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type AuthChallenge = z.infer<typeof authChallengeSchema>;

export function parseAuthChallenge(doc: Record<string, unknown>): AuthChallenge {
  const legacyUserId = typeof doc.userId === 'string' && doc.userId.length > 0 ? doc.userId : undefined;
  return authChallengeSchema.parse({
    ...doc,
    identityKey: doc.identityKey ?? legacyUserId,
    identityType: doc.identityType ?? (legacyUserId ? 'user' : undefined),
  });
}

// A short-lived security artifact — tokenHash is a secret and must never be
// embedded; kind is a low-cardinality enum better handled as an AQL filter.
const helpers = createNodeHelpers(AUTH_CHALLENGES_COLLECTION, authChallengeSchema);

export const insertAuthChallenge = helpers.insert;
export const deleteAuthChallenge = helpers.deleteById;
export const upsertAuthChallengeByKey = helpers.upsertByKey;

export async function getAuthChallengeById(id: string): Promise<AuthChallenge | null> {
  try {
    const doc = await db.collection(AUTH_CHALLENGES_COLLECTION).document(id);
    return parseAuthChallenge(withArangoKey(doc as Record<string, unknown>));
  } catch (err) {
    if (isArangoNotFoundError(err)) return null;
    throw err;
  }
}

export async function updateAuthChallenge(id: string, patch: Partial<Omit<AuthChallenge, 'embedding' | 'key'>>): Promise<AuthChallenge> {
  const result = await db.collection(AUTH_CHALLENGES_COLLECTION).update(id, patch, { returnNew: true, mergeObjects: true });
  return parseAuthChallenge(withArangoKey(result.new as Record<string, unknown>));
}

export async function* getAllAuthChallengesChunked(chunkSize?: number): AsyncGenerator<AuthChallenge[], void, void> {
  const cursor = await db.query(aql`FOR doc IN ${db.collection(AUTH_CHALLENGES_COLLECTION)} RETURN doc`, { batchSize: chunkSize ?? DEFAULT_CHUNK_SIZE });
  for await (const batch of cursor.batches) {
    yield (batch as Record<string, unknown>[]).map((doc) => parseAuthChallenge(withArangoKey(doc)));
  }
}

export async function listAuthChallengesPage(after?: string, limit: number = DEFAULT_PAGE_SIZE) {
  const cursor = await db.query(aql`
    FOR doc IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER ${after ?? null} == null || doc._key > ${after ?? null}
      SORT doc._key ASC
      LIMIT ${limit}
      RETURN doc
  `);
  const docs = await cursor.all();
  const items = (docs as Record<string, unknown>[]).map((doc) => parseAuthChallenge(withArangoKey(doc)));
  const last = items.at(-1);
  return {
    items,
    nextCursor: items.length === limit && last ? last.key : null,
  };
}

export async function getAuthChallengeByTokenHash(tokenHash: string): Promise<AuthChallenge | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER c.tokenHash == ${tokenHash}
      LIMIT 1
      RETURN c
  `);
  const doc = await cursor.next();
  return doc ? parseAuthChallenge(withArangoKey(doc)) : null;
}

export async function listAuthChallengesByUserAndKind(userId: string, kind: string): Promise<AuthChallenge[]> {
  return listAuthChallengesByIdentityAndKind(userId, 'user', kind);
}

export async function listAuthChallengesByIdentityAndKind(identityKey: string, identityType: z.infer<typeof authIdentityTypeSchema>, kind: string): Promise<AuthChallenge[]> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER (
          c.identityKey == ${identityKey} && c.identityType == ${identityType}
        ) || (
          ${identityType} == "user" && c.userId == ${identityKey} && (!HAS(c, "identityType") || c.identityType == null)
        )
      FILTER c.kind == ${kind}
      RETURN c
  `);
  const docs = await cursor.all();
  return docs.map((doc) => parseAuthChallenge(withArangoKey(doc)));
}

export async function consumeActiveAuthChallengesByUserAndKind(userId: string, kind: string, consumedAt: string): Promise<void> {
  return consumeActiveAuthChallengesByIdentityAndKind(userId, 'user', kind, consumedAt);
}

export async function consumeActiveAuthChallengesByIdentityAndKind(identityKey: string, identityType: z.infer<typeof authIdentityTypeSchema>, kind: string, consumedAt: string): Promise<void> {
  await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER (
          c.identityKey == ${identityKey} && c.identityType == ${identityType}
        ) || (
          ${identityType} == "user" && c.userId == ${identityKey} && (!HAS(c, "identityType") || c.identityType == null)
        )
      FILTER c.kind == ${kind}
        && (!HAS(c, "consumedAt") || c.consumedAt == null)
      UPDATE c WITH { consumedAt: ${consumedAt} } IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
  `);
}
