import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const MEMBERS_COLLECTION = 'members';

export const memberSchema = z.object({
  key: z.string(),
  userId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  name: z.string().nullable().default(null),
  profileUrl: z.string().nullable().default(null),
  isMfaEnabled: z.boolean().default(false),
  has_request_mfa_reset_link: z.boolean().default(false),
  isSuperAdmin: z.boolean().default(false),
  refreshTokenHash: z.string().nullable().default(null),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  requested_mfa_reset_link_at: z.string().nullable().default(null),
  lastLoginAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Member = z.infer<typeof memberSchema>;

// Access identity text only. MFA secrets/hashes, booleans, and timestamps are
// operational fields and must never be embedded.
export const membersEmbedKeys = z.enum(['email', 'name']);

const helpers = createNodeHelpers(MEMBERS_COLLECTION, memberSchema, membersEmbedKeys.options);

export const insertMember = helpers.insert;
export const getMemberById = helpers.getById;
export const updateMember = helpers.updateById;
export const deleteMember = helpers.deleteById;
export const upsertMemberByKey = helpers.upsertByKey;
export const getAllMembersChunked = helpers.getAllChunked;
export const listMembersPage = helpers.listPage;

export async function getMemberByUserId(userId: string): Promise<Member | null> {
  const cursor = await db.query(aql`
    FOR m IN ${db.collection(MEMBERS_COLLECTION)}
      FILTER m.userId == ${userId}
      LIMIT 1
      RETURN m
  `);
  const doc = await cursor.next();
  return doc ? memberSchema.parse(withArangoKey(doc)) : null;
}

export async function getMemberByEmail(email: string): Promise<Member | null> {
  const cursor = await db.query(aql`
    FOR m IN ${db.collection(MEMBERS_COLLECTION)}
      FILTER m.email == ${email}
      LIMIT 1
      RETURN m
  `);
  const doc = await cursor.next();
  return doc ? memberSchema.parse(withArangoKey(doc)) : null;
}

export async function getMemberByEmailHash(emailHash: string): Promise<Member | null> {
  const cursor = await db.query(aql`
    FOR m IN ${db.collection(MEMBERS_COLLECTION)}
      FILTER m.emailHash == ${emailHash}
      LIMIT 1
      RETURN m
  `);
  const doc = await cursor.next();
  return doc ? memberSchema.parse(withArangoKey(doc)) : null;
}

export async function getMemberByRefreshTokenHash(refreshTokenHash: string): Promise<Member | null> {
  const cursor = await db.query(aql`
    FOR m IN ${db.collection(MEMBERS_COLLECTION)}
      FILTER m.refreshTokenHash == ${refreshTokenHash}
      LIMIT 1
      RETURN m
  `);
  const doc = await cursor.next();
  return doc ? memberSchema.parse(withArangoKey(doc)) : null;
}

