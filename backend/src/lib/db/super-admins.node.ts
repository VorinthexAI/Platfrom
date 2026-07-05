import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const SUPER_ADMINS_COLLECTION = 'superAdmins';

export const superAdminSchema = z.object({
  key: z.string(),
  userId: z.string(),
  memberId: z.string().nullable().default(null),
  email: z.string(),
  emailHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type SuperAdmin = z.infer<typeof superAdminSchema>;

export const superAdminsEmbedKeys = z.enum(['email']);

const helpers = createNodeHelpers(SUPER_ADMINS_COLLECTION, superAdminSchema, superAdminsEmbedKeys.options);

export const insertSuperAdmin = helpers.insert;
export const getSuperAdminById = helpers.getById;
export const updateSuperAdmin = helpers.updateById;
export const deleteSuperAdmin = helpers.deleteById;
export const getAllSuperAdminsChunked = helpers.getAllChunked;
export const listSuperAdminsPage = helpers.listPage;

export async function getSuperAdminByUserId(userId: string): Promise<SuperAdmin | null> {
  const cursor = await db.query(aql`
    FOR admin IN ${db.collection(SUPER_ADMINS_COLLECTION)}
      FILTER admin.userId == ${userId}
      LIMIT 1
      RETURN admin
  `);
  const doc = await cursor.next();
  return doc ? superAdminSchema.parse(withArangoKey(doc)) : null;
}

export async function getSuperAdminByEmailHash(emailHash: string): Promise<SuperAdmin | null> {
  const cursor = await db.query(aql`
    FOR admin IN ${db.collection(SUPER_ADMINS_COLLECTION)}
      FILTER admin.emailHash == ${emailHash}
      LIMIT 1
      RETURN admin
  `);
  const doc = await cursor.next();
  return doc ? superAdminSchema.parse(withArangoKey(doc)) : null;
}
