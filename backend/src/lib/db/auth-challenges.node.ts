import { z } from 'zod';
import { aql } from 'arangojs';
import { db, withTransaction } from './client';
import { createNodeHelpers, isArangoNotFoundError, withArangoKey } from './base';
import { USER_ORGANIZATION_COLLECTION } from './user-organization.node';
import { USERS_COLLECTION } from './users.node';

export const AUTH_CHALLENGES_COLLECTION = 'authChallenges';
export const authIdentityTypeSchema = z.enum(['user', 'member', 'superAdmin']);
export const authChallengeKindSchema = z.enum([
  'email',
  'totp',
  'founder_email',
  'founder_totp',
  'founder_setup',
  'founder_recovery',
]);
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_PAGE_SIZE = 50;

export const authChallengeSchema = z.object({
  key: z.string(),
  identityKey: z.string(),
  identityType: authIdentityTypeSchema,
  membershipKey: z.string().nullable().default(null),
  kind: authChallengeKindSchema,
  tokenHash: z.string(),
  expiresAt: z.string(),
  consumedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  embedding: z.array(z.number()).default([]),
  // Cross-device handoff: the requesting browser parks a second secret and
  // claims a session once the emailed link is tapped anywhere. Double
  // hashed at rest exactly like tokenHash.
  handoffTokenHash: z.string().nullable().default(null),
  approvedAt: z.string().nullable().default(null),
  handoffClaimedAt: z.string().nullable().default(null),
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

/** Atomically claims an unexpired challenge so concurrent requests cannot replay it. */
export async function consumeAuthChallengeByTokenHash(
  tokenHash: string,
  kind: string,
  consumedAt: string,
): Promise<AuthChallenge | null> {
  const cursor = await db.query(aql`
    FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER challenge.tokenHash == ${tokenHash}
        && challenge.kind == ${kind}
        && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
        && DATE_TIMESTAMP(challenge.expiresAt) > DATE_TIMESTAMP(${consumedAt})
      LIMIT 1
      UPDATE challenge WITH { consumedAt: ${consumedAt} }
        IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      RETURN NEW
  `);
  const doc = await cursor.next();
  return doc ? parseAuthChallenge(withArangoKey(doc)) : null;
}

/** Atomically consumes a TOTP challenge and advances membership replay protection. */
export async function consumeTotpChallengeAndAdvanceMembership(input: {
  tokenHash: string;
  kind: z.infer<typeof authChallengeKindSchema>;
  membershipKey: string;
  timeStep: number;
  consumedAt: string;
  completeSetup?: boolean;
}): Promise<boolean> {
  return withTransaction([AUTH_CHALLENGES_COLLECTION, USER_ORGANIZATION_COLLECTION], async (transaction) => {
    const membershipCursor = await transaction.query(aql`
      FOR link IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
        FILTER link._key == ${input.membershipKey}
          && link.status == "active"
          && (!HAS(link, "lastTotpTimeStep") || link.lastTotpTimeStep == null || link.lastTotpTimeStep < ${input.timeStep})
        LIMIT 1
        UPDATE link WITH MERGE(
          { lastTotpTimeStep: ${input.timeStep}, updatedAt: ${input.consumedAt} },
          ${input.completeSetup === true} ? { isMfaEnabled: true, mfaRecoveryPending: false } : {}
        )
          IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
        RETURN NEW
    `);
    if (!await membershipCursor.next()) return false;

    const challengeCursor = await transaction.query(aql`
      FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        FILTER challenge.tokenHash == ${input.tokenHash}
          && challenge.kind == ${input.kind}
          && challenge.membershipKey == ${input.membershipKey}
          && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
          && DATE_TIMESTAMP(challenge.expiresAt) > DATE_TIMESTAMP(${input.consumedAt})
        LIMIT 1
        UPDATE challenge WITH { consumedAt: ${input.consumedAt} }
          IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        RETURN NEW
    `);
    if (!await challengeCursor.next()) throw new Error('TOTP challenge is no longer usable');
    return true;
  }).catch((error) => {
    if (error instanceof Error && error.message === 'TOTP challenge is no longer usable') return false;
    throw error;
  });
}

export async function exchangeFounderTotpForRecovery(input: {
  sourceTokenHash: string;
  identityKey: string;
  identityType: z.infer<typeof authIdentityTypeSchema>;
  membershipKey: string;
  exchangedAt: string;
  recoveryChallenge: Omit<AuthChallenge, 'embedding' | 'consumedAt' | 'handoffTokenHash' | 'approvedAt' | 'handoffClaimedAt'>;
}): Promise<boolean> {
  return withTransaction([AUTH_CHALLENGES_COLLECTION], async (transaction) => {
    const sourceCursor = await transaction.query(aql`
      FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        FILTER challenge.tokenHash == ${input.sourceTokenHash}
          && challenge.kind == "founder_totp"
          && challenge.identityKey == ${input.identityKey}
          && challenge.identityType == ${input.identityType}
          && challenge.membershipKey == ${input.membershipKey}
          && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
          && DATE_TIMESTAMP(challenge.expiresAt) > DATE_TIMESTAMP(${input.exchangedAt})
        LIMIT 1
        UPDATE challenge WITH { consumedAt: ${input.exchangedAt} }
          IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        RETURN NEW
    `);
    if (!await sourceCursor.next()) return false;
    await transaction.query(aql`
      FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        FILTER challenge.identityKey == ${input.identityKey}
          && challenge.identityType == ${input.identityType}
          && challenge.kind == "founder_recovery"
          && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
        UPDATE challenge WITH { consumedAt: ${input.exchangedAt} }
          IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
    `);
    const insertCursor = await transaction.query(aql`
      INSERT ${input.recoveryChallenge} INTO ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      RETURN NEW
    `);
    if (!await insertCursor.next()) throw new Error('MFA recovery challenge was not created');
    return true;
  });
}

export async function consumeFounderRecoveryAndStartSetup(input: {
  recoveryTokenHash: string;
  identityKey: string;
  identityType: z.infer<typeof authIdentityTypeSchema>;
  membershipKey: string;
  expectedMfaVersion: number;
  encryptedSecret: string;
  startedAt: string;
  setupChallenge: Omit<AuthChallenge, 'embedding' | 'consumedAt' | 'handoffTokenHash' | 'approvedAt' | 'handoffClaimedAt'>;
}): Promise<boolean> {
  return withTransaction(
    [AUTH_CHALLENGES_COLLECTION, USER_ORGANIZATION_COLLECTION, USERS_COLLECTION],
    async (transaction) => {
      const recoveryCursor = await transaction.query(aql`
        FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
          FILTER challenge.tokenHash == ${input.recoveryTokenHash}
            && challenge.kind == "founder_recovery"
            && challenge.identityKey == ${input.identityKey}
            && challenge.identityType == ${input.identityType}
            && challenge.membershipKey == ${input.membershipKey}
            && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
            && DATE_TIMESTAMP(challenge.expiresAt) > DATE_TIMESTAMP(${input.startedAt})
          LIMIT 1
          UPDATE challenge WITH { consumedAt: ${input.startedAt} }
            IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
          RETURN NEW
      `);
      if (!await recoveryCursor.next()) return false;

      const membershipCursor = await transaction.query(aql`
        FOR membership IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
          FILTER membership._key == ${input.membershipKey}
            && membership.userId == ${input.identityKey}
            && membership.status == "active"
            && (membership.isMfaEnabled == true || membership.mfaRecoveryPending == true)
            && (HAS(membership, "mfaVersion") ? membership.mfaVersion : 0) == ${input.expectedMfaVersion}
          LIMIT 1
          UPDATE membership WITH {
            isMfaEnabled: false,
            mfaRecoveryPending: true,
            totpSecret: ${input.encryptedSecret},
            lastTotpTimeStep: null,
            mfaVersion: ${input.expectedMfaVersion + 1},
            updatedAt: ${input.startedAt}
          } IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
          RETURN NEW
      `);
      if (!await membershipCursor.next()) throw new Error('MFA membership is no longer recoverable');

      await transaction.query(aql`
        FOR user IN ${db.collection(USERS_COLLECTION)}
          FILTER user._key == ${input.identityKey}
          LIMIT 1
          UPDATE user WITH {
            refreshTokenHash: null,
            refreshTokenExpiresAt: null,
            refreshFounderMembershipKey: null,
            refreshFounderMfaVersion: null,
            updatedAt: ${input.startedAt}
          } IN ${db.collection(USERS_COLLECTION)}
      `);
      const insertCursor = await transaction.query(aql`
        INSERT ${input.setupChallenge} INTO ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        RETURN NEW
      `);
      if (!await insertCursor.next()) throw new Error('MFA setup challenge was not created');
      return true;
    },
  );
}

export async function consumeSetupAuthorizationAndStartSetup(input: {
  sourceTokenHash: string;
  sourceKind: 'totp' | 'founder_setup';
  identityKey: string;
  identityType: z.infer<typeof authIdentityTypeSchema>;
  membershipKey: string;
  encryptedSecret: string;
  startedAt: string;
  setupChallenge: Omit<AuthChallenge, 'embedding' | 'consumedAt' | 'handoffTokenHash' | 'approvedAt' | 'handoffClaimedAt'>;
}): Promise<boolean> {
  return withTransaction([AUTH_CHALLENGES_COLLECTION, USER_ORGANIZATION_COLLECTION], async (transaction) => {
    const sourceCursor = await transaction.query(aql`
      FOR challenge IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        FILTER challenge.tokenHash == ${input.sourceTokenHash}
          && challenge.kind == ${input.sourceKind}
          && challenge.identityKey == ${input.identityKey}
          && challenge.identityType == ${input.identityType}
          && challenge.membershipKey == ${input.membershipKey}
          && (!HAS(challenge, "consumedAt") || challenge.consumedAt == null)
          && DATE_TIMESTAMP(challenge.expiresAt) > DATE_TIMESTAMP(${input.startedAt})
        LIMIT 1
        UPDATE challenge WITH { consumedAt: ${input.startedAt} }
          IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
        RETURN NEW
    `);
    if (!await sourceCursor.next()) return false;

    const membershipCursor = await transaction.query(aql`
      FOR membership IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
        FILTER membership._key == ${input.membershipKey}
          && membership.userId == ${input.identityKey}
          && membership.status == "active"
          && membership.isMfaEnabled != true
          && membership.mfaRecoveryPending != true
        LIMIT 1
        UPDATE membership WITH {
          isMfaEnabled: false,
          mfaRecoveryPending: false,
          totpSecret: ${input.encryptedSecret},
          lastTotpTimeStep: null,
          updatedAt: ${input.startedAt}
        } IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
        RETURN NEW
    `);
    if (!await membershipCursor.next()) throw new Error('MFA membership is no longer available for setup');

    const insertCursor = await transaction.query(aql`
      INSERT ${input.setupChallenge} INTO ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      RETURN NEW
    `);
    if (!await insertCursor.next()) throw new Error('MFA setup challenge was not created');
    return true;
  });
}

export async function getAuthChallengeByHandoffTokenHash(handoffTokenHash: string): Promise<AuthChallenge | null> {
  const cursor = await db.query(aql`
    FOR c IN ${db.collection(AUTH_CHALLENGES_COLLECTION)}
      FILTER c.handoffTokenHash == ${handoffTokenHash}
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
