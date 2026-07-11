import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USER_ORGANIZATION_COLLECTION = 'userOrganizations';

export const userOrganizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export const userOrganizationStatusSchema = z.enum(['active', 'suspended']);

export const userOrganizationSchema = z.object({
  key: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  orgRole: userOrganizationRoleSchema,
  orgTitle: z.string().nullable().default(null),
  status: userOrganizationStatusSchema.default('active'),
  joinedAt: z.string(),
  invitedByUserId: z.string().nullable().default(null),
  isMfaEnabled: z.boolean().default(false),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type UserOrganization = z.infer<typeof userOrganizationSchema>;

const helpers = createNodeHelpers(USER_ORGANIZATION_COLLECTION, userOrganizationSchema, []);

export const insertUserOrganization = helpers.insert;
export const getUserOrganizationById = helpers.getById;
export const updateUserOrganization = helpers.updateById;
export const deleteUserOrganization = helpers.deleteById;
export const upsertUserOrganizationByKey = helpers.upsertByKey;
export const getAllUserOrganizationsChunked = helpers.getAllChunked;
export const listUserOrganizationsPage = helpers.listPage;

export async function getUserOrganizationByOrganizationAndUser(
  organizationId: string,
  userId: string,
): Promise<UserOrganization | null> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
      FILTER link.organizationId == ${organizationId} && link.userId == ${userId}
      LIMIT 1
      RETURN link
  `);
  const doc = await cursor.next();
  return doc ? userOrganizationSchema.parse(withArangoKey(doc)) : null;
}

export async function listActiveUserOrganizationsByUser(
  userId: string,
): Promise<UserOrganization[]> {
  const cursor = await db.query(aql`
    FOR link IN ${db.collection(USER_ORGANIZATION_COLLECTION)}
      FILTER link.userId == ${userId} && link.status == "active"
      RETURN link
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userOrganizationSchema.parse(withArangoKey(doc)));
}
