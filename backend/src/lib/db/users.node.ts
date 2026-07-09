import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, withArangoKey } from './base';

export const USERS_COLLECTION = 'users';

export const platformRoleSchema = z.enum(['owner', 'admin', 'viewer']);

export const userSchema = z.object({
  key: z.string(),
  platformId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  name: z.string().nullable().default(null),
  profileUrl: z.string().nullable().default(null),
  alias: z.string().nullable().default(null),
  alias_slug: z.string().regex(/^[a-z]{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().default(null),
  platform_role: platformRoleSchema.nullable().default(null),
  /** Display title inside the platform, e.g. "Atlas CEO" — null for everyone else. */
  platform_title: z.string().nullable().default(null),
  waitlistNumber: z.number().int().nullable().default(null),
  isVerified: z.boolean().default(false),
  is_subscribed_to_updates: z.boolean().default(true),
  is_subscribed_to_updates_unsubscribe_token_hash: z.string().nullable().default(null),
  is_subscribed_to_updates_unsubscribe_requested_at: z.string().nullable().default(null),
  isMfaEnabled: z.boolean().default(false),
  has_request_mfa_reset_link: z.boolean().default(false),
  totpSecret: z.string().nullable().default(null),
  lastTotpTimeStep: z.number().nullable().default(null),
  requested_mfa_reset_link_at: z.string().nullable().default(null),
  refreshTokenHash: z.string().nullable().default(null),
  lastLoginAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type User = z.infer<typeof userSchema>;

// Identity text only: profileUrl (URL), booleans, hashes, and timestamps are excluded — they add
// no semantic search value and belong in an AQL FILTER instead.
export const usersEmbedKeys = z.enum(['email', 'name']);

const helpers = createNodeHelpers(USERS_COLLECTION, userSchema, usersEmbedKeys.options);

export const insertUser = helpers.insert;
export const getUserById = helpers.getById;
export const updateUser = helpers.updateById;
export const deleteUser = helpers.deleteById;
export const upsertUserByKey = helpers.upsertByKey;
export const getAllUsersChunked = helpers.getAllChunked;
export const listUsersPage = helpers.listPage;

export async function getUserByEmail(email: string): Promise<User | null> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.email == ${email}
      LIMIT 1
      RETURN u
  `);
  const doc = await cursor.next();
  return doc ? userSchema.parse(withArangoKey(doc)) : null;
}

export async function getUserByEmailHash(emailHash: string): Promise<User | null> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.emailHash == ${emailHash}
      LIMIT 1
      RETURN u
  `);
  const doc = await cursor.next();
  return doc ? userSchema.parse(withArangoKey(doc)) : null;
}

export async function getUserByAliasSlug(aliasSlug: string): Promise<User | null> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.alias_slug == ${aliasSlug}
      LIMIT 1
      RETURN u
  `);
  const doc = await cursor.next();
  return doc ? userSchema.parse(withArangoKey(doc)) : null;
}

export async function getUserByRefreshTokenHash(refreshTokenHash: string): Promise<User | null> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.refreshTokenHash == ${refreshTokenHash}
      LIMIT 1
      RETURN u
  `);
  const doc = await cursor.next();
  return doc ? userSchema.parse(withArangoKey(doc)) : null;
}

export async function getUserByUpdatesUnsubscribeTokenHash(tokenHash: string): Promise<User | null> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.is_subscribed_to_updates_unsubscribe_token_hash == ${tokenHash}
      LIMIT 1
      RETURN u
  `);
  const doc = await cursor.next();
  return doc ? userSchema.parse(withArangoKey(doc)) : null;
}

export async function countUsers(): Promise<number> {
  const cursor = await db.query(aql`
    RETURN LENGTH(${db.collection(USERS_COLLECTION)})
  `);
  const count = await cursor.next();
  return typeof count === 'number' ? count : 0;
}

export async function countVerifiedUsers(): Promise<number> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.isVerified == true
      COLLECT WITH COUNT INTO verified
      RETURN verified
  `);
  const count = await cursor.next();
  return typeof count === 'number' ? count : 0;
}

export async function listUnverifiedWaitlistUsers(): Promise<User[]> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u.isVerified != true
      RETURN u
  `);
  const docs = await cursor.all();
  return docs.map((doc) => userSchema.parse(withArangoKey(doc)));
}
