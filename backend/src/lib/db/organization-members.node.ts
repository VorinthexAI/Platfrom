import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const ORGANIZATION_MEMBERS_COLLECTION = 'organizationMembers';

export const organizationMemberRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const organizationMemberStatusSchema = z.enum(['active', 'suspended']);

export const organizationMemberSchema = z.object({
  key: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: organizationMemberRoleSchema,
  status: organizationMemberStatusSchema.default('active'),
  joinedAt: z.string(),
  invitedByUserId: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

const helpers = createNodeHelpers(ORGANIZATION_MEMBERS_COLLECTION, organizationMemberSchema, []);

export const insertOrganizationMember = helpers.insert;
export const getOrganizationMemberById = helpers.getById;
export const updateOrganizationMember = helpers.updateById;
export const deleteOrganizationMember = helpers.deleteById;
export const upsertOrganizationMemberByKey = helpers.upsertByKey;
export const getAllOrganizationMembersChunked = helpers.getAllChunked;
export const listOrganizationMembersPage = helpers.listPage;

export async function getOrganizationMemberByOrganizationAndUser(
  organizationId: string,
  userId: string,
): Promise<OrganizationMember | null> {
  const cursor = await db.query(aql`
    FOR member IN ${db.collection(ORGANIZATION_MEMBERS_COLLECTION)}
      FILTER member.organizationId == ${organizationId} && member.userId == ${userId}
      LIMIT 1
      RETURN member
  `);
  const doc = await cursor.next();
  return doc ? organizationMemberSchema.parse(withArangoKey(doc)) : null;
}
