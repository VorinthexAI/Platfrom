import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const TEAM_MEMBERS_COLLECTION = 'teamMembers';

export const teamMemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const teamMemberStatusSchema = z.enum(['active', 'suspended']);

export const teamMemberSchema = z.object({
  key: z.string(),
  teamId: z.string(),
  userId: z.string(),
  role: teamMemberRoleSchema,
  status: teamMemberStatusSchema.default('active'),
  joinedAt: z.string(),
  invitedByUserId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type TeamMember = z.infer<typeof teamMemberSchema>;

const helpers = createNodeHelpers(TEAM_MEMBERS_COLLECTION, teamMemberSchema, []);

export const insertTeamMember = helpers.insert;
export const getTeamMemberById = helpers.getById;
export const updateTeamMember = helpers.updateById;
export const deleteTeamMember = helpers.deleteById;
export const upsertTeamMemberByKey = helpers.upsertByKey;
export const getAllTeamMembersChunked = helpers.getAllChunked;
export const listTeamMembersPage = helpers.listPage;

export async function getTeamMemberByTeamAndUser(teamId: string, userId: string): Promise<TeamMember | null> {
  const cursor = await db.query(aql`
    FOR member IN ${db.collection(TEAM_MEMBERS_COLLECTION)}
      FILTER member.teamId == ${teamId} && member.userId == ${userId}
      LIMIT 1
      RETURN member
  `);
  const doc = await cursor.next();
  return doc ? teamMemberSchema.parse(withArangoKey(doc)) : null;
}
