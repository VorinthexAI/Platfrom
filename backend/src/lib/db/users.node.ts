import { z } from 'zod';
import { aql } from 'arangojs';
import { db } from './client';
import { createNodeHelpers, isArangoNotFoundError, withArangoKey } from './base';

export const USERS_COLLECTION = 'users';

// ISO 3166-1 alpha-2 country codes. Keep this closed so country data cannot
// accumulate arbitrary or misspelled values.
export const countryCodeSchema = z.enum([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA',
  'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
]);

export const userSettingsSchema = z.object({
  archive: z.object({
    showOnlyFavorites: z.boolean(),
  }).strict(),
}).strict();
export type UserSettings = z.infer<typeof userSettingsSchema>;

export const DEFAULT_USER_SETTINGS = Object.freeze({
  archive: Object.freeze({ showOnlyFavorites: false }),
});

export const userSchema = z.object({
  key: z.string(),
  organizationId: z.string(),
  email: z.string(),
  emailHash: z.string(),
  countryCode: countryCodeSchema.default('SE'),
  name: z.string().nullable().default(null),
  profileUrl: z.string().nullable().default(null),
  alias: z.string().nullable().default(null),
  alias_slug: z.string().regex(/^[a-z]{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().default(null),
  isVerified: z.boolean().default(false),
  isOnboarded: z.boolean().default(false),
  guestBootstrapSecretHash: z.string().nullable().default(null),
  settings: userSettingsSchema.default(DEFAULT_USER_SETTINGS),
  is_subscribed_to_updates: z.boolean().default(true),
  is_subscribed_to_updates_unsubscribe_token_hash: z.string().nullable().default(null),
  is_subscribed_to_updates_unsubscribe_requested_at: z.string().nullable().default(null),
  refreshTokenHash: z.string().nullable().default(null),
  refreshTokenExpiresAt: z.string().datetime().nullable().default(null),
  refreshFounderMembershipKey: z.string().nullable().default(null),
  refreshFounderMfaVersion: z.number().int().nonnegative().nullable().default(null),
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

export async function updateUserSettings(userKey: string, settings: UserSettings, updatedAt: string): Promise<User | null> {
  try {
    const result = await db.collection(USERS_COLLECTION).update(userKey, { settings, updatedAt }, { returnNew: true, mergeObjects: false });
    return userSchema.parse(withArangoKey(result.new as Record<string, unknown>));
  } catch (error) {
    if (isArangoNotFoundError(error)) return null;
    throw error;
  }
}

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

export async function revokeLegacyRefreshToken(userId: string, refreshTokenHash: string, updatedAt: string): Promise<boolean> {
  const cursor = await db.query(aql`
    FOR u IN ${db.collection(USERS_COLLECTION)}
      FILTER u._key == ${userId} && u.refreshTokenHash == ${refreshTokenHash}
      UPDATE u WITH {
        refreshTokenHash: null,
        refreshTokenExpiresAt: null,
        refreshFounderMembershipKey: null,
        refreshFounderMfaVersion: null,
        updatedAt: ${updatedAt}
      } IN ${db.collection(USERS_COLLECTION)}
      RETURN NEW
  `);
  return Boolean(await cursor.next());
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
