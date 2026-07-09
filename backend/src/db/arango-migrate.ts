import 'dotenv/config';
import { Database } from 'arangojs';
import { embed } from '../lib/embed';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '../lib/alias';
import { newId } from '../lib/ids';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const username = process.env.ARANGO_USERNAME ?? 'root';
const password = process.env.ARANGO_ROOT_PASSWORD ?? '';

interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
  embedKeys?: string[];
}

const legacyIndexesToDrop: Record<string, string[][]> = {
  members: [['userId']],
  superAdmins: [['userId'], ['memberId']],
  authChallenges: [['userId', 'kind']],
  // Visitors are anonymous now: the emailHash/userId identity indexes go
  // with the fields (scrubbed below); only distinctId + platformId remain.
  visitors: [['emailHash'], ['userId']],
};

function buildNodeEmbedText(collectionName: string, key: string, embedKeys: readonly string[], doc: Record<string, unknown>): string | null {
  if (embedKeys.length === 0) return null;
  const parts = [`_${collectionName}`, key];
  for (const field of embedKeys) {
    const value = doc[field];
    if (value === null || value === undefined || value === '') continue;
    parts.push(String(value));
  }
  return parts.join(':');
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function emailHashFromData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  return nonEmptyString(record.email_hash)
    ?? nonEmptyString(record.emailHash)
    ?? (record.payload && typeof record.payload === 'object'
      ? nonEmptyString((record.payload as Record<string, unknown>).email_hash)
        ?? nonEmptyString((record.payload as Record<string, unknown>).emailHash)
      : null);
}

async function getUserIdByEmailHash(targetDb: Database, emailHash: string): Promise<string | null> {
  const cursor = await targetDb.query<{ _key: string }>(
    `
      FOR user IN users
        FILTER user.emailHash == @emailHash
        LIMIT 1
        RETURN { _key: user._key }
    `,
    { emailHash },
  );
  const user = await cursor.next();
  return user?._key ?? null;
}

async function resolveEventUserId(input: {
  targetDb: Database;
  explicitUserId?: unknown;
  legacyEntityId?: unknown;
  legacyBelongsTo?: unknown;
  data?: unknown;
}): Promise<string | null> {
  const explicitUserId = nonEmptyString(input.explicitUserId);
  if (explicitUserId) return explicitUserId;

  const data = input.data && typeof input.data === 'object' ? input.data as Record<string, unknown> : {};
  const dataUserId = nonEmptyString(data.user_id) ?? nonEmptyString(data.userId);
  if (dataUserId) return dataUserId;

  if (input.legacyBelongsTo === 'user') {
    const legacyUserId = nonEmptyString(input.legacyEntityId);
    if (legacyUserId) return legacyUserId;
  }

  const emailHash = emailHashFromData(input.data);
  return emailHash ? getUserIdByEmailHash(input.targetDb, emailHash) : null;
}

async function backfillCollectionEmbeddings(targetDb: Database, spec: CollectionSpec): Promise<void> {
  const embedKeys = spec.embedKeys ?? [];
  if (embedKeys.length === 0) {
    await targetDb.query(
      `
      FOR doc IN @@collection
        FILTER !HAS(doc, "embedding") || doc.embedding == null || !IS_ARRAY(doc.embedding)
        UPDATE doc WITH { embedding: [] } IN @@collection
    `,
      { '@collection': spec.name },
    );
    return;
  }

  const cursor = await targetDb.query<Record<string, unknown>>(
    `
      FOR doc IN @@collection
        RETURN doc
    `,
    { '@collection': spec.name },
  );
  const collection = targetDb.collection(spec.name);
  const docs = await cursor.all();
  for (const doc of docs) {
    const key = nonEmptyString(doc._key);
    if (!key) continue;
    const text = buildNodeEmbedText(spec.name, key, embedKeys, doc);
    const embedding = text ? await embed({ text }) : [];
    await collection.update(key, { embedding });
  }
  if (docs.length > 0) {
    console.log(`Normalized embeddings for ${docs.length} ${spec.name} documents`);
  }
}

const collections: CollectionSpec[] = [
  {
    name: 'users',
    embedKeys: ['email', 'name'],
    indexes: [
      { fields: ['platformId'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['alias_slug'], unique: true, sparse: true },
      { fields: ['platform_role'] },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  {
    name: 'teams',
    embedKeys: ['name', 'slug', 'description'],
    indexes: [
      { fields: ['ownerId'] },
      { fields: ['slug'], unique: true },
      { fields: ['isActive'] },
    ],
  },
  {
    name: 'teamMembers',
    indexes: [
      { fields: ['teamId'] },
      { fields: ['userId'] },
      { fields: ['teamId', 'userId'], unique: true },
      { fields: ['teamId', 'role'] },
    ],
  },
  {
    name: 'teamMemberInvites',
    embedKeys: ['email', 'role', 'status'],
    indexes: [
      { fields: ['teamId'] },
      { fields: ['emailHash'] },
      { fields: ['tokenHash'], unique: true },
      { fields: ['teamId', 'emailHash'] },
      { fields: ['status', 'expiresAt'] },
    ],
  },
  { name: 'minds', embedKeys: ['name'], indexes: [{ fields: ['userId'], unique: true }] },
  { name: 'orchestrators', embedKeys: ['name', 'model'], indexes: [{ fields: ['name'] }] },
  {
    name: 'agents',
    embedKeys: ['name', 'role', 'model'],
    indexes: [
      { fields: ['orchestratorId'] },
      { fields: ['orchestratorId', 'name'], unique: true },
    ],
  },
  { name: 'capabilities', embedKeys: ['name'], indexes: [{ fields: ['name'] }] },
  {
    name: 'mindCapabilities',
    indexes: [
      { fields: ['mindId'] },
      { fields: ['capabilityId'] },
      { fields: ['mindId', 'capabilityId'], unique: true },
    ],
  },
  {
    name: 'products',
    embedKeys: ['productId', 'name', 'type', 'billingPeriod'],
    indexes: [
      { fields: ['productId'], unique: true },
      { fields: ['polarProductId'], unique: true, sparse: true },
    ],
  },
  {
    name: 'paymentCheckouts',
    indexes: [
      { fields: ['userId', 'idempotencyKey'], unique: true },
      { fields: ['provider', 'providerCheckoutId'], unique: true, sparse: true },
    ],
  },
  { name: 'paymentOrders', indexes: [{ fields: ['provider', 'providerOrderId'], unique: true }] },
  {
    name: 'subscriptions',
    indexes: [{ fields: ['provider', 'providerSubscriptionId'], unique: true }, { fields: ['userId'] }],
  },
  {
    name: 'userEntitlements',
    indexes: [{ fields: ['sourceType', 'sourceId'], unique: true }, { fields: ['userId', 'productId'] }],
  },
  { name: 'processedWebhookEvents', indexes: [{ fields: ['provider', 'eventId'], unique: true }] },
  {
    name: 'authChallenges',
    indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['identityKey', 'identityType', 'kind'] }, { fields: ['expiresAt'] }],
  },
  {
    name: 'events',
    embedKeys: ['belongsTo', 'slug'],
    indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['belongsTo', 'sourceId', 'createdAt'] }, { fields: ['userId', 'createdAt'] }],
  },
  { name: 'outputs', embedKeys: ['type'], indexes: [{ fields: ['type', 'createdAt'] }] },
  { name: 'outputRelations', embedKeys: ['relationType'], indexes: [{ fields: ['parentOutputId'] }, { fields: ['childOutputId'] }] },
  { name: 'outputAnalytics', indexes: [{ fields: ['outputId', 'snapshotAt'] }] },
  { name: 'platforms', indexes: [{ fields: ['name'], unique: true }] },
  {
    name: 'visitors',
    indexes: [
      { fields: ['platformId'] },
      { fields: ['distinctId'], unique: true, sparse: true },
    ],
  },
  {
    name: 'visitorSessions',
    indexes: [
      { fields: ['visitorId'] },
      { fields: ['source'] },
      { fields: ['sessionKey'], unique: true },
      { fields: ['disconnectedAt'] },
      { fields: ['platformId', 'connectedAt'] },
    ],
  },
  {
    name: 'userSessions',
    indexes: [
      { fields: ['userId'] },
      { fields: ['source'] },
      { fields: ['sessionKey'], unique: true },
      { fields: ['disconnectedAt'] },
      { fields: ['platformId', 'connectedAt'] },
      { fields: ['userId', 'connectedAt'] },
    ],
  },
  {
    name: 'intelligenceFragments',
    embedKeys: ['collectibleId', 'rarity'],
    indexes: [
      { fields: ['userId'] },
      { fields: ['explorerId'] },
      { fields: ['explorerId', 'collectibleId'], unique: true },
      { fields: ['collectibleId'] },
      // Leaderboard lookups: recent collects and per-user totals straight
      // from the fragments ledger — no separate leaderboard node.
      { fields: ['createdAt'] },
      { fields: ['userId', 'createdAt'] },
    ],
  },
  {
    name: 'userWaitlistLeaderboardChanges',
    indexes: [
      { fields: ['userId', 'createdAt'] },
      { fields: ['createdAt'] },
    ],
  },
];

const droppedCollections = [
  'companies',
  'companyApiKeys',
  'companyApps',
  'companyMemberAppAccess',
  'companyMembers',
  'companyMemberTitles',
  'companyRoles',
  'companyTitles',
  'eventAppLinks',
  'outputAppLinks',
  'blueprints',
  'eventDefinitions',
];

async function main() {
  const systemDb = new Database({ url, auth: { username, password } });
  const existingDatabases = await systemDb.listDatabases();
  if (!existingDatabases.includes(databaseName)) {
    await systemDb.createDatabase(databaseName);
    console.log(`Created database ${databaseName}`);
  }
  const targetDb = systemDb.database(databaseName);

  for (const name of droppedCollections) {
    const collection = targetDb.collection(name);
    if (await collection.exists()) {
      await collection.drop();
      console.log(`Dropped collection ${name}`);
    }
  }

  for (const spec of collections) {
    const collection = targetDb.collection(spec.name);
    const exists = await collection.exists();
    if (!exists) {
      await collection.create();
      console.log(`Created collection ${spec.name}`);
    }
    const legacyIndexes = legacyIndexesToDrop[spec.name] ?? [];
    if (legacyIndexes.length > 0) {
      const existingIndexes = await collection.indexes();
      for (const index of existingIndexes) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields : [];
        if (legacyIndexes.some((legacy) => legacy.length === fields.length && legacy.every((field, i) => fields[i] === field))) {
          await collection.dropIndex(index.id);
          console.log(`Dropped legacy index ${index.id} on ${spec.name}(${fields.join(', ')})`);
        }
      }
    }
    for (const index of spec.indexes ?? []) {
      await collection.ensureIndex({
        type: 'persistent',
        fields: index.fields,
        unique: index.unique ?? false,
        sparse: index.sparse ?? false,
      });
    }
    await backfillCollectionEmbeddings(targetDb, spec);
  }

  const platformsCollection = targetDb.collection('platforms');
  let defaultPlatformId: string | null = null;
  const defaultPlatformCursor = await targetDb.query<{ _key: string }>(`
    FOR platform IN platforms
      FILTER platform.name == "this"
      LIMIT 1
      RETURN { _key: platform._key }
  `);
  const existingDefaultPlatform = await defaultPlatformCursor.next();
  if (existingDefaultPlatform) {
    defaultPlatformId = existingDefaultPlatform._key;
  } else {
    defaultPlatformId = newId();
    const now = new Date().toISOString();
    await platformsCollection.save({
      _key: defaultPlatformId,
      name: 'this',
      metadata: {},
      createdAt: now,
      updatedAt: now,
      embedding: await embed({ text: ['_platforms', defaultPlatformId, 'this'].join(':') }),
    });
  }

  await targetDb.query(
    `
    FOR u IN users
      FILTER !HAS(u, "platformId") || u.platformId == null || u.platformId == ""
        || !HAS(u, "platform_role")
      UPDATE u WITH {
        platformId: (!HAS(u, "platformId") || u.platformId == null || u.platformId == "") ? @defaultPlatformId : u.platformId,
        platform_role: HAS(u, "platform_role") ? u.platform_role : null
      } IN users
    `,
    { defaultPlatformId },
  );

  // Backfill the platform display title: null for everyone until seeded.
  await targetDb.query(`
    FOR u IN users
      FILTER !HAS(u, "platform_title")
      UPDATE u WITH { platform_title: null } IN users
  `);

  await targetDb.query(`
    FOR c IN authChallenges
      FILTER (!HAS(c, "identityKey") || c.identityKey == null || c.identityKey == "")
        && HAS(c, "userId")
        && c.userId != null
        && c.userId != ""
      UPDATE c WITH {
        identityKey: c.userId,
        identityType: "user",
        userId: null
      } IN authChallenges OPTIONS { keepNull: false }
  `);

  await targetDb.query(`
    FOR u IN users
      FILTER !HAS(u, "isMfaEnabled")
        || !HAS(u, "has_request_mfa_reset_link")
        || HAS(u, "isSuperAdmin")
        || !HAS(u, "totpSecret")
        || !HAS(u, "lastTotpTimeStep")
        || !HAS(u, "requested_mfa_reset_link_at")
      UPDATE u WITH {
        isMfaEnabled: HAS(u, "isMfaEnabled") ? u.isMfaEnabled : false,
        has_request_mfa_reset_link: HAS(u, "has_request_mfa_reset_link") ? u.has_request_mfa_reset_link : false,
        isSuperAdmin: null,
        totpSecret: HAS(u, "totpSecret") ? u.totpSecret : null,
        lastTotpTimeStep: HAS(u, "lastTotpTimeStep") ? u.lastTotpTimeStep : null,
        requested_mfa_reset_link_at: HAS(u, "requested_mfa_reset_link_at") ? u.requested_mfa_reset_link_at : null
      } IN users OPTIONS { keepNull: false }
  `);

  let migratedLegacyIdentities = false;
  const membersCollection = targetDb.collection('members');
  if (await membersCollection.exists()) {
    migratedLegacyIdentities = true;
    await targetDb.query(
      `
      FOR m IN members
        FILTER !HAS(m, "platformId")
          || m.platformId == null
          || m.platformId == ""
          || !HAS(m, "role")
          || m.role == null
          || m.role == ""
          || HAS(m, "isSuperAdmin")
        UPDATE m WITH {
          platformId: (!HAS(m, "platformId") || m.platformId == null || m.platformId == "") ? @defaultPlatformId : m.platformId,
          role: (!HAS(m, "role") || m.role == null || m.role == "") ? (m.isSuperAdmin == true ? "owner" : "viewer") : m.role,
          isSuperAdmin: null
        } IN members OPTIONS { keepNull: false }
      `,
      { defaultPlatformId },
    );

    await targetDb.query(`
      FOR m IN members
        LET existing = FIRST(FOR u IN users FILTER u.emailHash == m.emailHash LIMIT 1 RETURN u)
        FILTER existing == null
        INSERT {
          _key: m._key,
          platformId: HAS(m, "platformId") && m.platformId != null && m.platformId != "" ? m.platformId : @defaultPlatformId,
          email: m.email,
          emailHash: m.emailHash,
          name: HAS(m, "name") ? m.name : null,
          profileUrl: HAS(m, "profileUrl") ? m.profileUrl : null,
          alias: null,
          alias_slug: null,
          platform_role: "viewer",
          waitlistNumber: null,
          isVerified: true,
          is_subscribed_to_updates: true,
          is_subscribed_to_updates_unsubscribe_token_hash: null,
          is_subscribed_to_updates_unsubscribe_requested_at: null,
          isMfaEnabled: HAS(m, "isMfaEnabled") ? m.isMfaEnabled : false,
          has_request_mfa_reset_link: HAS(m, "has_request_mfa_reset_link") ? m.has_request_mfa_reset_link : false,
          totpSecret: HAS(m, "totpSecret") ? m.totpSecret : null,
          lastTotpTimeStep: HAS(m, "lastTotpTimeStep") ? m.lastTotpTimeStep : null,
          requested_mfa_reset_link_at: HAS(m, "requested_mfa_reset_link_at") ? m.requested_mfa_reset_link_at : null,
          refreshTokenHash: HAS(m, "refreshTokenHash") ? m.refreshTokenHash : null,
          lastLoginAt: HAS(m, "lastLoginAt") ? m.lastLoginAt : null,
          createdAt: HAS(m, "createdAt") ? m.createdAt : DATE_ISO8601(DATE_NOW()),
          updatedAt: DATE_ISO8601(DATE_NOW()),
          embedding: []
        } IN users OPTIONS { overwriteMode: "ignore" }
    `, { defaultPlatformId });

    await targetDb.query(`
      FOR m IN members
        FOR u IN users
          FILTER u.emailHash == m.emailHash
          UPDATE u WITH {
            platform_role: u.platform_role == "owner" || u.platform_role == "admin" ? u.platform_role : "viewer",
            name: HAS(u, "name") && u.name != null ? u.name : (HAS(m, "name") ? m.name : null),
            profileUrl: HAS(u, "profileUrl") && u.profileUrl != null ? u.profileUrl : (HAS(m, "profileUrl") ? m.profileUrl : null),
            isMfaEnabled: HAS(m, "isMfaEnabled") ? m.isMfaEnabled : (HAS(u, "isMfaEnabled") ? u.isMfaEnabled : false),
            has_request_mfa_reset_link: HAS(m, "has_request_mfa_reset_link") ? m.has_request_mfa_reset_link : (HAS(u, "has_request_mfa_reset_link") ? u.has_request_mfa_reset_link : false),
            totpSecret: HAS(m, "totpSecret") ? m.totpSecret : (HAS(u, "totpSecret") ? u.totpSecret : null),
            lastTotpTimeStep: HAS(m, "lastTotpTimeStep") ? m.lastTotpTimeStep : (HAS(u, "lastTotpTimeStep") ? u.lastTotpTimeStep : null),
            requested_mfa_reset_link_at: HAS(m, "requested_mfa_reset_link_at") ? m.requested_mfa_reset_link_at : (HAS(u, "requested_mfa_reset_link_at") ? u.requested_mfa_reset_link_at : null),
            refreshTokenHash: HAS(m, "refreshTokenHash") && m.refreshTokenHash != null ? m.refreshTokenHash : (HAS(u, "refreshTokenHash") ? u.refreshTokenHash : null),
            lastLoginAt: HAS(m, "lastLoginAt") && m.lastLoginAt != null ? m.lastLoginAt : (HAS(u, "lastLoginAt") ? u.lastLoginAt : null),
            updatedAt: DATE_ISO8601(DATE_NOW())
          } IN users
    `);
  }

  const superAdminsCollection = targetDb.collection('superAdmins');
  if (await superAdminsCollection.exists()) {
    migratedLegacyIdentities = true;
    await targetDb.query(`
      FOR admin IN superAdmins
        LET existing = FIRST(FOR u IN users FILTER u.emailHash == admin.emailHash LIMIT 1 RETURN u)
        FILTER existing == null
        INSERT {
          _key: admin._key,
          platformId: HAS(admin, "platformId") && admin.platformId != null && admin.platformId != "" ? admin.platformId : @defaultPlatformId,
          email: admin.email,
          emailHash: admin.emailHash,
          name: null,
          profileUrl: null,
          alias: null,
          alias_slug: null,
          platform_role: "owner",
          waitlistNumber: null,
          isVerified: true,
          is_subscribed_to_updates: true,
          is_subscribed_to_updates_unsubscribe_token_hash: null,
          is_subscribed_to_updates_unsubscribe_requested_at: null,
          isMfaEnabled: HAS(admin, "isMfaEnabled") ? admin.isMfaEnabled : false,
          has_request_mfa_reset_link: HAS(admin, "has_request_mfa_reset_link") ? admin.has_request_mfa_reset_link : false,
          totpSecret: HAS(admin, "totpSecret") ? admin.totpSecret : null,
          lastTotpTimeStep: HAS(admin, "lastTotpTimeStep") ? admin.lastTotpTimeStep : null,
          requested_mfa_reset_link_at: HAS(admin, "requested_mfa_reset_link_at") ? admin.requested_mfa_reset_link_at : null,
          refreshTokenHash: HAS(admin, "refreshTokenHash") ? admin.refreshTokenHash : null,
          lastLoginAt: HAS(admin, "lastLoginAt") ? admin.lastLoginAt : null,
          createdAt: HAS(admin, "createdAt") ? admin.createdAt : DATE_ISO8601(DATE_NOW()),
          updatedAt: DATE_ISO8601(DATE_NOW()),
          embedding: []
        } IN users OPTIONS { overwriteMode: "ignore" }
    `, { defaultPlatformId });

    await targetDb.query(`
      FOR admin IN superAdmins
        FOR u IN users
          FILTER u.emailHash == admin.emailHash
          UPDATE u WITH {
            platform_role: "owner",
            isMfaEnabled: HAS(admin, "isMfaEnabled") ? admin.isMfaEnabled : (HAS(u, "isMfaEnabled") ? u.isMfaEnabled : false),
            has_request_mfa_reset_link: HAS(admin, "has_request_mfa_reset_link") ? admin.has_request_mfa_reset_link : (HAS(u, "has_request_mfa_reset_link") ? u.has_request_mfa_reset_link : false),
            totpSecret: HAS(admin, "totpSecret") ? admin.totpSecret : (HAS(u, "totpSecret") ? u.totpSecret : null),
            lastTotpTimeStep: HAS(admin, "lastTotpTimeStep") ? admin.lastTotpTimeStep : (HAS(u, "lastTotpTimeStep") ? u.lastTotpTimeStep : null),
            requested_mfa_reset_link_at: HAS(admin, "requested_mfa_reset_link_at") ? admin.requested_mfa_reset_link_at : (HAS(u, "requested_mfa_reset_link_at") ? u.requested_mfa_reset_link_at : null),
            refreshTokenHash: HAS(admin, "refreshTokenHash") && admin.refreshTokenHash != null ? admin.refreshTokenHash : (HAS(u, "refreshTokenHash") ? u.refreshTokenHash : null),
            lastLoginAt: HAS(admin, "lastLoginAt") && admin.lastLoginAt != null ? admin.lastLoginAt : (HAS(u, "lastLoginAt") ? u.lastLoginAt : null),
            updatedAt: DATE_ISO8601(DATE_NOW())
          } IN users
    `);
  }
  if (migratedLegacyIdentities) {
    await backfillCollectionEmbeddings(targetDb, collections.find((spec) => spec.name === 'users')!);
  }

  const oldPostRenders = targetDb.collection('postRenders');
  if (await oldPostRenders.exists()) {
    const outputs = targetDb.collection('outputs');
    const cursor = await targetDb.query<{
      _key: string;
      status?: string;
      results?: unknown[];
      createdAt?: string;
      updatedAt?: string;
    }>(`
      FOR render IN postRenders
        RETURN render
    `);
    // Drain before the slow embed() work — see the legacy-events note.
    const renders = await cursor.all();
    for (const render of renders) {
      const key = newId();
      const type = 'post.render';
      const outputEmbedText = buildNodeEmbedText('outputs', key, ['type'], { type });
      await outputs.save(
        {
          _key: key,
          type,
          data: {
            postId: render._key,
            status: render.status ?? 'done',
            results: Array.isArray(render.results) ? render.results : [],
          },
          storagePath: null,
          usageCount: 0,
          embedding: outputEmbedText ? await embed({ text: outputEmbedText }) : [],
          createdAt: render.createdAt ?? render.updatedAt ?? new Date().toISOString(),
        },
        { overwriteMode: 'replace' },
      );
    }
    await oldPostRenders.drop();
    console.log('Migrated postRenders -> outputs and dropped collection postRenders');
  }

  const usersWithEventsCursor = await targetDb.query<{
    _key: string;
    events?: Array<Record<string, unknown>>;
  }>(`
    FOR user IN users
      FILTER HAS(user, "events") && IS_ARRAY(user.events) && LENGTH(user.events) > 0
      RETURN { _key: user._key, events: user.events }
  `);
  const eventsCollection = targetDb.collection('events');
  // Drain before the slow embed() work — see the legacy-events note.
  const usersWithEvents = await usersWithEventsCursor.all();
  for (const user of usersWithEvents) {
    for (const event of user.events ?? []) {
      const slug = typeof event.slug === 'string' && event.slug.length > 0 ? event.slug : 'unknown';
      const key = newId();
      const createdAt = typeof event.createdAt === 'string'
        ? event.createdAt
        : typeof event.created_at === 'string'
          ? event.created_at
          : new Date().toISOString();
      const eventEmbedText = buildNodeEmbedText('events', key, ['belongsTo', 'slug'], { belongsTo: 'platform', slug });
      await eventsCollection.save({
        _key: key,
        sourceId: defaultPlatformId,
        belongsTo: 'platform',
        userId: user._key,
        slug,
        data: {
          distinctId: typeof event.distinctId === 'string' ? event.distinctId : null,
          payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
        },
        createdAt,
        embedding: eventEmbedText ? await embed({ text: eventEmbedText }) : [],
      });
    }
  }

  const userEventsCollection = targetDb.collection('userEvents');
  if (await userEventsCollection.exists()) {
    const cursor = await targetDb.query<{
      _key: string;
      userId?: string;
      slug?: string;
      data?: Record<string, unknown> | null;
      createdAt?: string;
    }>(`
      FOR event IN userEvents
        RETURN {
          _key: event._key,
          userId: event.userId,
          slug: event.slug,
          data: event.data,
          createdAt: event.createdAt
        }
    `);

    let migratedUserEvents = 0;
    // Drain before the slow embed() work — see the legacy-events note.
    const legacyUserEvents = await cursor.all();
    for (const event of legacyUserEvents) {
      if (typeof event.userId !== 'string' || event.userId.length === 0) continue;

      const slug = typeof event.slug === 'string' && event.slug.length > 0 ? event.slug : 'unknown';
      const key = `user_event_${event._key}`;
      const eventEmbedText = buildNodeEmbedText('events', key, ['belongsTo', 'slug'], { belongsTo: 'platform', slug });
      await eventsCollection.save(
        {
          _key: key,
          sourceId: defaultPlatformId,
          belongsTo: 'platform',
          userId: event.userId,
          slug,
          data: event.data && typeof event.data === 'object' ? event.data : {},
          createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
          embedding: eventEmbedText ? await embed({ text: eventEmbedText }) : [],
        },
        { overwriteMode: 'ignore' },
      );
      migratedUserEvents += 1;
    }

    await userEventsCollection.drop();
    console.log(`Migrated ${migratedUserEvents} userEvents -> events and dropped collection userEvents`);
  }

  await targetDb.query(`
    FOR event IN events
      FILTER HAS(event, "category")
      UPDATE event WITH { category: null } IN events OPTIONS { keepNull: false }
  `);

  // Only events still carrying the LEGACY shape need this pass. Selecting
  // everything re-embedded the whole collection on every deploy — and once
  // the collection grew, one batch of embed() calls outlived the server's
  // cursor TTL and the next batch fetch died with "cursor not found"
  // (errorNum 1600). Filter to the legacy rows and drain the cursor fully
  // BEFORE the slow per-event work so no server cursor stays open.
  const eventsCursor = await targetDb.query<{
    _key: string;
    slug?: string;
    sourceId?: string;
    userId?: string;
    entityId?: string;
    belongsTo?: string;
    data?: Record<string, unknown> | null;
  }>(`
    FOR event IN events
      FILTER HAS(event, "entityId")
        || HAS(event, "entityType")
        || !HAS(event, "sourceId") || event.sourceId == null
        || !HAS(event, "belongsTo") || event.belongsTo == null
      RETURN {
        _key: event._key,
        slug: event.slug,
        sourceId: event.sourceId,
        userId: event.userId,
        entityId: event.entityId,
        belongsTo: event.belongsTo,
        data: event.data
      }
  `);
  const legacyEvents = await eventsCursor.all();
  if (legacyEvents.length > 0) {
    console.log(`Migrating ${legacyEvents.length} legacy events`);
  }
  for (const event of legacyEvents) {
    const userId = await resolveEventUserId({
      targetDb,
      explicitUserId: event.userId,
      legacyEntityId: event.entityId,
      legacyBelongsTo: event.belongsTo,
      data: event.data,
    });
    const legacyAppSourceId = event.belongsTo === 'app' ? nonEmptyString(event.sourceId) ?? nonEmptyString(event.entityId) : null;
    const belongsTo = legacyAppSourceId ? 'app' : 'platform';
    const legacyPlatformSourceId = event.belongsTo === 'platform' && event.entityId !== userId
      ? nonEmptyString(event.entityId)
      : null;
    const sourceId = legacyAppSourceId
      ?? nonEmptyString(event.sourceId)
      ?? legacyPlatformSourceId
      ?? defaultPlatformId;
    const eventEmbedText = typeof event.slug === 'string' && event.slug.length > 0
      ? buildNodeEmbedText('events', event._key, ['belongsTo', 'slug'], { belongsTo, slug: event.slug })
      : null;
    const embedding = eventEmbedText ? await embed({ text: eventEmbedText }) : [];
    await eventsCollection.update(event._key, {
      sourceId,
      belongsTo,
      userId,
      entityId: null,
      entityType: null,
      embedding,
    }, { keepNull: false });
  }

  await targetDb.query(`
    FOR u IN users
      FILTER !HAS(u, "is_subscribed_to_updates")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at")
        || !HAS(u, "refreshTokenHash")
        || !HAS(u, "lastLoginAt")
        || HAS(u, "isOnWaitlist")
        || HAS(u, "isWaitlistApproved")
        || HAS(u, "events")
      UPDATE u WITH {
        events: null,
        isOnWaitlist: null,
        isWaitlistApproved: null,
        is_subscribed_to_updates: HAS(u, "is_subscribed_to_updates") ? u.is_subscribed_to_updates : (HAS(u, "isSubscribedToNewsletter") ? u.isSubscribedToNewsletter : true),
        is_subscribed_to_updates_unsubscribe_token_hash: HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash") ? u.is_subscribed_to_updates_unsubscribe_token_hash : null,
        is_subscribed_to_updates_unsubscribe_requested_at: HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at") ? u.is_subscribed_to_updates_unsubscribe_requested_at : null,
        refreshTokenHash: HAS(u, "refreshTokenHash") ? u.refreshTokenHash : null,
        lastLoginAt: HAS(u, "lastLoginAt") ? u.lastLoginAt : null
      } IN users OPTIONS { keepNull: false }
  `);

  const maxWaitlistNumberCursor = await targetDb.query<number | null>(`
    RETURN MAX(
      FOR u IN users
        FILTER HAS(u, "waitlistNumber") && u.waitlistNumber != null
        RETURN u.waitlistNumber
    )
  `);
  let nextWaitlistNumber = (await maxWaitlistNumberCursor.next()) ?? 0;
  const usersCollection = targetDb.collection('users');
  const existingAliasSlugsCursor = await targetDb.query<{ _key: string; alias_slug?: string | null }>(`
    FOR u IN users
      FILTER HAS(u, "alias_slug") && u.alias_slug != null && u.alias_slug != ""
      RETURN { _key: u._key, alias_slug: u.alias_slug }
  `);
  const takenAliasSlugs = new Map<string, string>();
  for (const row of await existingAliasSlugsCursor.all()) {
    if (typeof row.alias_slug === 'string' && row.alias_slug.length > 0) {
      takenAliasSlugs.set(row.alias_slug, row._key);
    }
  }
  function allocateAliasSlug(alias: string, userKey: string): string {
    for (let attempt = 0; attempt < ALIAS_SLUG_PREFIX_SPACE; attempt += 1) {
      const candidate = generateAliasSlug(alias, userKey, attempt);
      const owner = takenAliasSlugs.get(candidate);
      if (!owner || owner === userKey) {
        takenAliasSlugs.set(candidate, userKey);
        return candidate;
      }
    }
    throw new Error(`Could not allocate alias_slug for user ${userKey}`);
  }
  const usersMissingAliasCursor = await targetDb.query<{
    _key: string;
    alias?: string | null;
    alias_slug?: string | null;
    waitlistNumber?: number | null;
  }>(`
    FOR u IN users
      FILTER !HAS(u, "alias") || u.alias == null
        || !HAS(u, "alias_slug") || u.alias_slug == null || u.alias_slug == ""
        || !HAS(u, "waitlistNumber") || u.waitlistNumber == null
      SORT u.createdAt ASC
      RETURN { _key: u._key, alias: u.alias, alias_slug: u.alias_slug, waitlistNumber: u.waitlistNumber }
  `);
  const usersMissingAlias = await usersMissingAliasCursor.all();
  for (const user of usersMissingAlias) {
    const patch: Record<string, unknown> = {};
    const alias = user.alias ?? generateAlias(user._key);
    if (user.alias == null) patch.alias = alias;
    if (user.alias_slug == null || user.alias_slug === '') {
      patch.alias_slug = allocateAliasSlug(alias, user._key);
    }
    if (user.waitlistNumber == null) {
      nextWaitlistNumber += 1;
      patch.waitlistNumber = nextWaitlistNumber;
    }
    await usersCollection.update(user._key, patch);
  }

  // Presence funnel split: partition the old single `activeVisitors` ledger
  // into two clean funnels. Each session resolves to an identity — its parent
  // visitor's userId, else its own emailHash against `users` — and lands in
  // `userSessions` (authed) or `visitorSessions` (anonymous). Migrated docs
  // keep their `_key`s so any in-flight Redis session closes cleanly through
  // the new sweeper/leave code. Runs BEFORE the visitors scrub so the userId
  // link is still readable, and the source is dropped only after the copy
  // completes — `overwriteMode: 'ignore'` makes reruns no-ops.
  const activeVisitorsCollection = targetDb.collection('activeVisitors');
  if (await activeVisitorsCollection.exists()) {
    const visitorSessionsCollection = targetDb.collection('visitorSessions');
    const userSessionsCollection = targetDb.collection('userSessions');
    const cursor = await targetDb.query<{
      _key: string;
      platformId?: string;
      visitorId?: string;
      emailHash?: string | null;
      alias?: string;
      sessionKey?: string;
      connectedAt?: string;
      disconnectedAt?: string | null;
      createdAt?: string;
      updatedAt?: string;
    }>(`
      FOR a IN activeVisitors
        RETURN a
    `);
    const legacyActiveVisitors = await cursor.all();
    let migratedUserSessions = 0;
    let migratedVisitorSessions = 0;
    for (const active of legacyActiveVisitors) {
      let userId: string | null = null;
      if (typeof active.visitorId === 'string' && active.visitorId.length > 0) {
        const parentCursor = await targetDb.query<{ userId?: string | null }>(
          `
            FOR v IN visitors
              FILTER v._key == @visitorId
              LIMIT 1
              RETURN { userId: v.userId }
          `,
          { visitorId: active.visitorId },
        );
        const parent = await parentCursor.next();
        userId = nonEmptyString(parent?.userId ?? null);
      }
      if (!userId && typeof active.emailHash === 'string' && active.emailHash.length > 0) {
        userId = await getUserIdByEmailHash(targetDb, active.emailHash);
      }

      const base = {
        _key: active._key,
        platformId: active.platformId,
        alias: active.alias,
        sessionKey: active.sessionKey,
        connectedAt: active.connectedAt,
        disconnectedAt: active.disconnectedAt ?? null,
        createdAt: active.createdAt,
        updatedAt: active.updatedAt,
        embedding: [],
      };
      if (userId) {
        await userSessionsCollection.save({ ...base, userId }, { overwriteMode: 'ignore' });
        migratedUserSessions += 1;
      } else {
        await visitorSessionsCollection.save({ ...base, visitorId: active.visitorId }, { overwriteMode: 'ignore' });
        migratedVisitorSessions += 1;
      }
    }
    await activeVisitorsCollection.drop();
    console.log(
      `Migrated activeVisitors -> ${migratedUserSessions} userSessions + ${migratedVisitorSessions} visitorSessions and dropped collection activeVisitors`,
    );
  }

  // Visitors are anonymous by definition now — drop the leftover identity
  // fields so nothing lingers behind the removed indexes.
  await targetDb.query(`
    FOR v IN visitors
      FILTER HAS(v, "userId") || HAS(v, "emailHash")
      UPDATE v WITH { userId: null, emailHash: null } IN visitors OPTIONS { keepNull: false }
  `);

  await targetDb.query(`
    FOR session IN visitorSessions
      FILTER !HAS(session, "source") || session.source == null || session.source == ""
      UPDATE session WITH { source: "web" } IN visitorSessions
  `);

  await targetDb.query(`
    FOR session IN userSessions
      FILTER !HAS(session, "source") || session.source == null || session.source == ""
      UPDATE session WITH { source: "web" } IN userSessions
  `);

  for (const legacyIdentityCollectionName of ['members', 'superAdmins']) {
    const collection = targetDb.collection(legacyIdentityCollectionName);
    if (await collection.exists()) {
      await collection.drop();
      console.log(`Dropped legacy identity collection ${legacyIdentityCollectionName}`);
    }
  }

  console.log('ArangoDB schema is up to date.');
  systemDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
