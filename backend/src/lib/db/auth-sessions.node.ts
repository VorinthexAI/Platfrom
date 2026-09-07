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
  teamMembershipKey: z.string().nullable().default(null),
  teamMfaVersion: z.number().int().nonnegative().nullable().default(null),
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

export async function getSelectedTeamMfaState(userId: string): Promise<{
  teamMembershipKey: string;
  mfaEnabled: boolean;
  membershipMfaEnabled: boolean;
  teamMfaVersion: number;
} | null> {
  const cursor = await db.query<{
    teamMembershipKey: string;
    mfaEnabled: boolean;
    membershipMfaEnabled: boolean;
    teamMfaVersion: number;
  }>(aql`
    LET user = DOCUMENT(users, ${userId})
    LET scope = user == null ? null : DOCUMENT(scopes, user.currentScopeKey)
    LET team = scope == null ? null : DOCUMENT(teams, scope.teamKey)
    LET membership = team == null ? null : FIRST(
      FOR link IN userTeams
        FILTER link.userId == ${userId} && link.teamKey == team._key && link.status == "active"
        LIMIT 1 RETURN link
    )
    FILTER team != null && team.isActive == true && membership != null
    RETURN {
      teamMembershipKey: membership._key,
      mfaEnabled: team.mfa_enabled == true,
      membershipMfaEnabled: membership.isMfaEnabled == true,
      teamMfaVersion: HAS(membership, "teamMfaVersion") ? membership.teamMfaVersion : 0
    }
  `);
  return await cursor.next() ?? null;
}
