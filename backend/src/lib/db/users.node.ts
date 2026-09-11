import { z } from 'zod';
import { aql } from 'arangojs';
import { db, withTransaction } from './client';
import { buildEmbeddingText, createNodeHelpers, withArangoKey } from './base';
import { embedText, embeddingMetadata } from '@/lib/embeddings';

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

export const userSchema = z.object({
  key: z.string(),
  currentScopeKey: z.string().cuid(),
  microSparkBalance: z.number().int().safe().nonnegative().default(0),
  microSparkDebt: z.number().int().safe().nonnegative().default(0),
  pendingReferralCode: z.string().regex(/^[A-F0-9]{12}$/).nullable().default(null),
  email: z.string(),
  emailHash: z.string(),
  countryCode: countryCodeSchema.default('SE'),
  name: z.string().nullable().default(null),
  profileUrl: z.string().nullable().default(null),
  profileStorageKey: z.string().nullable().default(null),
  alias: z.string().nullable().default(null),
  alias_slug: z.string().regex(/^[a-z]{4}-[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable().default(null),
  isVerified: z.boolean().default(false),
  isOnboarded: z.boolean().default(false),
  guestBootstrapSecretHash: z.string().nullable().default(null),
  is_subscribed_to_updates: z.boolean().default(true),
  is_subscribed_to_updates_unsubscribe_token_hash: z.string().nullable().default(null),
  is_subscribed_to_updates_unsubscribe_requested_at: z.string().nullable().default(null),
  deletionRequestedAt: z.string().datetime().nullable().default(null),
  lastLoginAt: z.string().datetime().nullable().default(null),
  lastSeenAt: z.string().datetime().nullable().default(null),
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
export async function deleteUser(userKey: string): Promise<void> {
  await withTransaction(['users', 'userHiddens', 'userGenerations', 'conversations', 'conversationMessages', 'userInboxThreads', 'userInboxMessages', 'tickets', 'events', 'sparkTransactions', 'referralCodes', 'referralAttributions', 'referralRewards', 'checkoutHandoffs', 'paymentCheckouts', 'paymentOrders', 'subscriptions', 'storageDeletionJobs', 'tags', 'tagAssignments'], async (transaction) => {
    await transaction.query('LET tagKeys = (FOR tag IN tags FILTER tag.userKey == @userKey RETURN tag._key) FOR assignment IN tagAssignments FILTER assignment.tagKey IN tagKeys REMOVE assignment IN tagAssignments', { userKey });
    await transaction.query('FOR tag IN tags FILTER tag.userKey == @userKey REMOVE tag IN tags', { userKey });
    await transaction.query('FOR hidden IN userHiddens FILTER hidden.userKey == @userKey REMOVE hidden IN userHiddens', { userKey });
    await transaction.query('FOR generation IN userGenerations FILTER generation.userKey == @userKey REMOVE generation IN userGenerations', { userKey });
    await transaction.query('FOR message IN conversationMessages FILTER message.userKey == @userKey REMOVE message IN conversationMessages', { userKey });
    await transaction.query('FOR conversation IN conversations FILTER conversation.userKey == @userKey REMOVE conversation IN conversations', { userKey });
    await transaction.query('FOR message IN userInboxMessages FILTER message.userKey == @userKey REMOVE message IN userInboxMessages', { userKey });
    await transaction.query('FOR thread IN userInboxThreads FILTER thread.userKey == @userKey REMOVE thread IN userInboxThreads', { userKey });
    await transaction.query('FOR ticket IN tickets FILTER ticket.userKey == @userKey REMOVE ticket IN tickets', { userKey });
    await transaction.query('FOR event IN events FILTER event.userId == @userKey REMOVE event IN events', { userKey });
    await transaction.query('FOR item IN sparkTransactions FILTER item.userKey == @userKey REMOVE item IN sparkTransactions', { userKey });
    await transaction.query('FOR reward IN referralRewards FILTER reward.referrerUserKey == @userKey || reward.referredUserKey == @userKey REMOVE reward IN referralRewards', { userKey });
    await transaction.query('FOR attribution IN referralAttributions FILTER attribution.referrerUserKey == @userKey || attribution.referredUserKey == @userKey REMOVE attribution IN referralAttributions', { userKey });
    await transaction.query('FOR code IN referralCodes FILTER code.ownerUserKey == @userKey REMOVE code IN referralCodes', { userKey });
    await transaction.query('FOR handoff IN checkoutHandoffs FILTER handoff.userKey == @userKey REMOVE handoff IN checkoutHandoffs', { userKey });
    await transaction.query('FOR checkout IN paymentCheckouts FILTER checkout.userKey == @userKey REMOVE checkout IN paymentCheckouts', { userKey });
    await transaction.query('FOR order IN paymentOrders FILTER order.userKey == @userKey REMOVE order IN paymentOrders', { userKey });
    await transaction.query('FOR subscription IN subscriptions FILTER subscription.userKey == @userKey REMOVE subscription IN subscriptions', { userKey });
    await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null && IS_STRING(user.profileStorageKey) UPSERT { storageKey: user.profileStorageKey } INSERT { storageKey: user.profileStorageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { userKey, now: new Date().toISOString() });
    const cursor = await transaction.query('REMOVE @userKey IN users RETURN OLD._key', { userKey });
    if (await cursor.next() === undefined) throw new Error(`User ${userKey} was not found.`);
  });
}
export const upsertUserByKey = helpers.upsertByKey;
export const getAllUsersChunked = helpers.getAllChunked;
export const listUsersPage = helpers.listPage;

export async function touchUserLastSeen(userKey: string, seenAt: string): Promise<boolean> {
  const timestamp = z.string().datetime().parse(seenAt);
  const cursor = await db.query(`
    FOR user IN users
      FILTER user._key == @userKey && user.deletionRequestedAt == null
      UPDATE user WITH { lastSeenAt: user.lastSeenAt == null || user.lastSeenAt < @seenAt ? @seenAt : user.lastSeenAt } IN users
      RETURN true
  `, { userKey, seenAt: timestamp });
  return await cursor.next() === true;
}

export async function touchUserLastLogin(userKey: string, loginAt: string): Promise<boolean> {
  const timestamp = z.string().datetime().parse(loginAt);
  const cursor = await db.query(`
    FOR user IN users
      FILTER user._key == @userKey && user.deletionRequestedAt == null
      UPDATE user WITH { lastLoginAt: user.lastLoginAt == null || user.lastLoginAt < @loginAt ? @loginAt : user.lastLoginAt } IN users
      RETURN true
  `, { userKey, loginAt: timestamp });
  return await cursor.next() === true;
}

type UserDatabase = Pick<typeof db, 'query'>;

export async function initializeUserNameIfMissing(
  userKey: string,
  name: string,
  updatedAt: string,
  options: { database?: UserDatabase; getUser?: typeof getUserById; embed?: typeof embedText } = {},
): Promise<User | null> {
  const normalizedKey = z.string().trim().min(1).parse(userKey);
  const normalizedName = z.string().trim().min(1).max(200).parse(name);
  const timestamp = z.string().datetime().parse(updatedAt);
  const getUser = options.getUser ?? getUserById;
  const current = await getUser(normalizedKey);
  if (!current || current.name !== null) return current;
  const text = buildEmbeddingText(usersEmbedKeys.options, { ...current, name: normalizedName });
  const embedding = text ? await (options.embed ?? embedText)({ text }) : [];
  const cursor = await (options.database ?? db).query(`
    FOR user IN users
      FILTER user._key == @userKey && user.name == null
      UPDATE user WITH { name: @name, updatedAt: @updatedAt, embedding: @embedding, embeddingProvider: @embeddingProvider, embeddingModel: @embeddingModel, embeddingDimensions: @embeddingDimensions } IN users
      RETURN NEW
  `, { userKey: normalizedKey, name: normalizedName, updatedAt: timestamp, embedding, ...embeddingMetadata() });
  const updated = await cursor.next();
  return updated ? userSchema.parse(withArangoKey(updated as Record<string, unknown>)) : getUser(normalizedKey);
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
