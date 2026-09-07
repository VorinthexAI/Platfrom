import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USER_TEAM_COLLECTION = 'userTeams';

export const userTeamRoleSchema = z.enum(['owner', 'admin', 'moderator', 'member', 'viewer']);
export const userTeamStatusSchema = z.enum(['active', 'inactive', 'suspended']);

export const userTeamSchema = z.object({
  key: z.string(),
  teamKey: z.string(),
  userId: z.string(),
  teamRole: userTeamRoleSchema,
  teamTitle: z.string().nullable().default(null),
  orchestratorKey: z.string().nullable().default(null),
  status: userTeamStatusSchema.default('active'),
  environmentSeeded: z.boolean().default(false),
  joinedAt: z.string(),
  isMfaEnabled: z.boolean().default(false),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  teamMfaVersion: z.number().int().nonnegative().default(0),
  teamMfaRecoveryPending: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type UserTeam = z.infer<typeof userTeamSchema>;

const helpers = createNodeHelpers(USER_TEAM_COLLECTION, userTeamSchema, []);

export const insertUserTeam = helpers.insert;
export const getUserTeamById = helpers.getById;
export const updateUserTeam = helpers.updateById;
export const deleteUserTeam = helpers.deleteById;
export const upsertUserTeamByKey = helpers.upsertByKey;
export const getAllUserTeamsChunked = helpers.getAllChunked;
export const listUserTeamsPage = helpers.listPage;

export async function getUserTeamByTeamAndUser(
  teamKey: string,
  userId: string,
): Promise<UserTeam | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(USER_TEAM_COLLECTION)}
      FILTER link.teamKey == ${teamKey} && link.userId == ${userId}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? userTeamSchema.parse(withArangoKey(doc)) : null;
}

export async function listActiveUserTeamsByUser(
  userId: string,
): Promise<UserTeam[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(USER_TEAM_COLLECTION)}
      FILTER link.userId == ${userId} && link.status == "active"
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userTeamSchema.parse(withArangoKey(doc)));
}

export async function hasActiveEnvironmentSeededMembership(userId: string): Promise<boolean> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(USER_TEAM_COLLECTION)}
      FILTER link.userId == ${userId} && link.status == "active" && link.environmentSeeded == true
      LIMIT 1 RETURN true
  `);
  return Boolean(await cursor.next());
}
