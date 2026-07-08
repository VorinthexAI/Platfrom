import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';
import { teamMemberRoleSchema } from './team-members.node';

export const TEAM_MEMBER_INVITES_COLLECTION = 'teamMemberInvites';

export const teamMemberInviteStatusSchema = z.enum(['pending', 'accepted', 'revoked', 'expired']);

export const teamMemberInviteSchema = z.object({
  key: z.string(),
  teamId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  role: teamMemberRoleSchema,
  invitedByUserId: z.string(),
  tokenHash: z.string(),
  status: teamMemberInviteStatusSchema.default('pending'),
  acceptedByUserId: z.string().nullable().default(null),
  acceptedAt: z.string().nullable().default(null),
  revokedAt: z.string().nullable().default(null),
  expiresAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type TeamMemberInvite = z.infer<typeof teamMemberInviteSchema>;

export const teamMemberInvitesEmbedKeys = z.enum(['email', 'role', 'status']);

const helpers = createNodeHelpers(TEAM_MEMBER_INVITES_COLLECTION, teamMemberInviteSchema, teamMemberInvitesEmbedKeys.options);

export const insertTeamMemberInvite = helpers.insert;
export const getTeamMemberInviteById = helpers.getById;
export const updateTeamMemberInvite = helpers.updateById;
export const deleteTeamMemberInvite = helpers.deleteById;
export const upsertTeamMemberInviteByKey = helpers.upsertByKey;
export const getAllTeamMemberInvitesChunked = helpers.getAllChunked;
export const listTeamMemberInvitesPage = helpers.listPage;

export async function getTeamMemberInviteByTokenHash(tokenHash: string): Promise<TeamMemberInvite | null> {
  const cursor = await db.query(aql`
    FOR invite IN ${db.collection(TEAM_MEMBER_INVITES_COLLECTION)}
      FILTER invite.tokenHash == ${tokenHash}
      LIMIT 1
      RETURN invite
  `);
  const doc = await cursor.next();
  return doc ? teamMemberInviteSchema.parse(withArangoKey(doc)) : null;
}
