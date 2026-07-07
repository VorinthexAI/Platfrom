import 'dotenv/config';
import { Database } from 'arangojs';
import { embed } from '../core/actions/embed';
import { generateAlias } from '../lib/alias';
import { newId } from '../lib/ids';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const username = process.env.ARANGO_USERNAME ?? 'root';
const password = process.env.ARANGO_ROOT_PASSWORD ?? '';

interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
}

const legacyIndexesToDrop: Record<string, string[][]> = {
  members: [['userId']],
  superAdmins: [['userId'], ['memberId']],
  authChallenges: [['userId', 'kind']],
};

function buildEventEmbedText(key: string, belongsTo: string, slug: string): string {
  return ['_events', key, belongsTo, slug].join(':');
}

function buildOutputEmbedText(key: string, type: string): string {
  return ['_outputs', key, type].join(':');
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

const collections: CollectionSpec[] = [
  {
    name: 'users',
    indexes: [
      { fields: ['platformId'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  {
    name: 'members',
    indexes: [
      { fields: ['platformId'] },
      { fields: ['platformId', 'role'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  {
    name: 'superAdmins',
    indexes: [
      { fields: ['platformId'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  { name: 'minds', indexes: [{ fields: ['userId'], unique: true }] },
  { name: 'orchestrators', indexes: [{ fields: ['name'] }] },
  {
    name: 'agents',
    indexes: [
      { fields: ['orchestratorId'] },
      { fields: ['orchestratorId', 'name'], unique: true },
    ],
  },
  { name: 'capabilities', indexes: [{ fields: ['name'] }] },
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
    indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['belongsTo', 'sourceId', 'createdAt'] }, { fields: ['userId', 'createdAt'] }],
  },
  { name: 'outputs', indexes: [{ fields: ['type', 'createdAt'] }] },
  { name: 'outputRelations', indexes: [{ fields: ['parentOutputId'] }, { fields: ['childOutputId'] }] },
  { name: 'outputAnalytics', indexes: [{ fields: ['outputId', 'snapshotAt'] }] },
  { name: 'platforms', indexes: [{ fields: ['name'], unique: true }] },
  {
    name: 'visitors',
    indexes: [
      { fields: ['platformId'] },
      { fields: ['emailHash'], unique: true, sparse: true },
      { fields: ['distinctId'], unique: true, sparse: true },
      { fields: ['userId'], sparse: true },
    ],
  },
  {
    name: 'activeVisitors',
    indexes: [
      { fields: ['visitorId'] },
      { fields: ['sessionKey'], unique: true },
      { fields: ['disconnectedAt'] },
      { fields: ['platformId', 'connectedAt'] },
    ],
  },
  {
    name: 'intelligenceFragments',
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
    await targetDb.query(
      `
      FOR doc IN @@collection
        FILTER !HAS(doc, "embedding") || doc.embedding == null
        UPDATE doc WITH { embedding: [] } IN @@collection
    `,
      { '@collection': spec.name },
    );
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
      UPDATE u WITH {
        platformId: @defaultPlatformId
      } IN users
    `,
    { defaultPlatformId },
  );

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
    FOR u IN users
      FILTER HAS(u, "isMfaEnabled")
        || HAS(u, "has_request_mfa_reset_link")
        || HAS(u, "isSuperAdmin")
        || HAS(u, "totpSecret")
        || HAS(u, "lastTotpTimeStep")
        || HAS(u, "requested_mfa_reset_link_at")
      UPDATE u WITH {
        isMfaEnabled: null,
        has_request_mfa_reset_link: null,
        isSuperAdmin: null,
        totpSecret: null,
        lastTotpTimeStep: null,
        requested_mfa_reset_link_at: null
      } IN users OPTIONS { keepNull: false }
  `);

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
    for await (const render of cursor) {
      const key = newId();
      const type = 'post.render';
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
          embedding: await embed({ text: buildOutputEmbedText(key, type) }),
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
  for await (const user of usersWithEventsCursor) {
    for (const event of user.events ?? []) {
      const slug = typeof event.slug === 'string' && event.slug.length > 0 ? event.slug : 'unknown';
      const key = newId();
      const createdAt = typeof event.createdAt === 'string'
        ? event.createdAt
        : typeof event.created_at === 'string'
          ? event.created_at
          : new Date().toISOString();
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
        embedding: await embed({ text: buildEventEmbedText(key, 'user', slug) }),
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
    for await (const event of cursor) {
      if (typeof event.userId !== 'string' || event.userId.length === 0) continue;

      const slug = typeof event.slug === 'string' && event.slug.length > 0 ? event.slug : 'unknown';
      const key = `user_event_${event._key}`;
      await eventsCollection.save(
        {
          _key: key,
          sourceId: defaultPlatformId,
          belongsTo: 'platform',
          userId: event.userId,
          slug,
          data: event.data && typeof event.data === 'object' ? event.data : {},
          createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
          embedding: await embed({ text: buildEventEmbedText(key, 'user', slug) }),
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
  for await (const event of eventsCursor) {
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
    const embedding = typeof event.slug === 'string' && event.slug.length > 0
      ? await embed({ text: buildEventEmbedText(event._key, belongsTo, event.slug) })
      : [];
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
  const usersMissingAliasCursor = await targetDb.query<{
    _key: string;
    alias?: string | null;
    waitlistNumber?: number | null;
  }>(`
    FOR u IN users
      FILTER !HAS(u, "alias") || u.alias == null
        || !HAS(u, "waitlistNumber") || u.waitlistNumber == null
      SORT u.createdAt ASC
      RETURN { _key: u._key, alias: u.alias, waitlistNumber: u.waitlistNumber }
  `);
  for await (const user of usersMissingAliasCursor) {
    const patch: Record<string, unknown> = {};
    if (user.alias == null) patch.alias = generateAlias(user._key);
    if (user.waitlistNumber == null) {
      nextWaitlistNumber += 1;
      patch.waitlistNumber = nextWaitlistNumber;
    }
    await usersCollection.update(user._key, patch);
  }

  console.log('ArangoDB schema is up to date.');
  systemDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
