import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const SUPER_ADMINS_COLLECTION = 'superAdmins';

export const superAdminSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  isMfaEnabled: z.boolean().default(false),
  has_request_mfa_reset_link: z.boolean().default(false),
  refreshTokenHash: z.string().nullable().default(null),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  requested_mfa_reset_link_at: z.string().nullable().default(null),
  lastLoginAt: z.string().nullable().default(null),
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
export const upsertSuperAdminByKey = helpers.upsertByKey;
export const getAllSuperAdminsChunked = helpers.getAllChunked;
export const listSuperAdminsPage = helpers.listPage;

export async function getSuperAdminByEmail(email: string): Promise<SuperAdmin | null> {
  const cursor = await db.query(aql`
    FOR admin IN ${db.collection(SUPER_ADMINS_COLLECTION)}
      FILTER admin.email == ${email}
      LIMIT 1
      RETURN admin
  `);
  const doc = await cursor.next();
  return doc ? superAdminSchema.parse(withArangoKey(doc)) : null;
}

export async function getSuperAdminByRefreshTokenHash(refreshTokenHash: string): Promise<SuperAdmin | null> {
  const cursor = await db.query(aql`
    FOR admin IN ${db.collection(SUPER_ADMINS_COLLECTION)}
      FILTER admin.refreshTokenHash == ${refreshTokenHash}
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
