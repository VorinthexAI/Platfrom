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
  organizationId: z.string(),
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
export async function deleteUser(userKey: string): Promise<void> {
  await withTransaction(['users', 'userHiddens', 'userGenerations', 'conversations', 'conversationMessages', 'ticketVotes', 'tickets', 'events', 'storageDeletionJobs'], async (transaction) => {
    await transaction.query('FOR hidden IN userHiddens FILTER hidden.userKey == @userKey REMOVE hidden IN userHiddens', { userKey });
    await transaction.query('FOR generation IN userGenerations FILTER generation.userKey == @userKey REMOVE generation IN userGenerations', { userKey });
    await transaction.query('FOR message IN conversationMessages FILTER message.userKey == @userKey REMOVE message IN conversationMessages', { userKey });
    await transaction.query('FOR conversation IN conversations FILTER conversation.userKey == @userKey REMOVE conversation IN conversations', { userKey });
    await transaction.query(`
      LET authoredTicketKeys = (FOR ticket IN tickets FILTER ticket.userKey == @userKey RETURN ticket._key)
      LET votedTicketKeys = UNIQUE(FOR vote IN ticketVotes FILTER vote.userKey == @userKey RETURN vote.ticketKey)
      LET removedVotes = (FOR vote IN ticketVotes FILTER vote.userKey == @userKey || vote.ticketKey IN authoredTicketKeys REMOVE vote IN ticketVotes RETURN 1)
      FOR ticket IN tickets
        FILTER ticket._key IN MINUS(votedTicketKeys, authoredTicketKeys) && ticket.type == "feedback"
        LET counts = FIRST(FOR vote IN ticketVotes FILTER vote.ticketKey == ticket._key COLLECT AGGREGATE upvotes = SUM(vote.vote == "up" ? 1 : 0), downvotes = SUM(vote.vote == "down" ? 1 : 0) RETURN { upvotes, downvotes })
        UPDATE ticket WITH counts IN tickets
    `, { userKey });
    await transaction.query('FOR ticket IN tickets FILTER ticket.userKey == @userKey REMOVE ticket IN tickets', { userKey });
    await transaction.query('FOR event IN events FILTER event.userId == @userKey REMOVE event IN events', { userKey });
    await transaction.query('LET user = DOCUMENT(users, @userKey) FILTER user != null && IS_STRING(user.profileStorageKey) UPSERT { storageKey: user.profileStorageKey } INSERT { storageKey: user.profileStorageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { userKey, now: new Date().toISOString() });
    const cursor = await transaction.query('REMOVE @userKey IN users RETURN OLD._key', { userKey });
    if (await cursor.next() === undefined) throw new Error(`User ${userKey} was not found.`);
  });
}
export const upsertUserByKey = helpers.upsertByKey;
export const getAllUsersChunked = helpers.getAllChunked;
export const listUsersPage = helpers.listPage;

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
