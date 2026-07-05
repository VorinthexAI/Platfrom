import 'dotenv/config';
import { Database } from 'arangojs';
import { embed } from '../core/actions/embed';
import { newId } from '../lib/ids';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const username = process.env.ARANGO_USERNAME ?? 'root';
const password = process.env.ARANGO_ROOT_PASSWORD ?? '';

interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
}

function buildEventEmbedText(key: string, belongsTo: string, slug: string): string {
  return ['_events', key, belongsTo, slug].join(':');
}

function buildOutputEmbedText(key: string, type: string): string {
  return ['_outputs', key, type].join(':');
}

function buildMemberEmbedText(key: string, email: string, name?: string | null): string {
  return ['_members', key, email, name].filter(Boolean).join(':');
}

function buildSuperAdminEmbedText(key: string, email: string): string {
  return ['_superAdmins', key, email].filter(Boolean).join(':');
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
      { fields: ['userId'], unique: true },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  {
    name: 'superAdmins',
    indexes: [
      { fields: ['userId'], unique: true },
      { fields: ['memberId'], unique: true, sparse: true },
      { fields: ['emailHash'], unique: true },
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
    indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['userId', 'kind'] }, { fields: ['expiresAt'] }],
  },
  {
    name: 'events',
    indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['belongsTo', 'sourceId', 'createdAt'] }, { fields: ['userId', 'createdAt'] }],
  },
  { name: 'outputs', indexes: [{ fields: ['type', 'createdAt'] }] },
  { name: 'outputRelations', indexes: [{ fields: ['parentOutputId'] }, { fields: ['childOutputId'] }] },
  { name: 'outputAnalytics', indexes: [{ fields: ['outputId', 'snapshotAt'] }] },
  { name: 'platforms', indexes: [{ fields: ['name'], unique: true }] },
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

  const membersCollection = targetDb.collection('members');
  const superAdminsCollection = targetDb.collection('superAdmins');
  const usersToPromoteCursor = await targetDb.query<{
    _key: string;
    platformId?: string;
    email?: string;
    emailHash?: string;
    name?: string | null;
    profileUrl?: string | null;
    isMfaEnabled?: boolean;
    has_request_mfa_reset_link?: boolean;
    isSuperAdmin?: boolean;
    refreshTokenHash?: string | null;
    totpSecret?: string | null;
    lastTotpTimeStep?: number | null;
    requested_mfa_reset_link_at?: string | null;
    lastLoginAt?: string | null;
    isWaitlistApproved?: boolean;
    createdAt?: string;
    updatedAt?: string;
  }>(`
    FOR u IN users
      FILTER u.isWaitlistApproved == true
        || u.isSuperAdmin == true
        || u.isMfaEnabled == true
        || HAS(u, "totpSecret")
        || u.refreshTokenHash != null
      RETURN u
  `);
  for await (const user of usersToPromoteCursor) {
    if (!user.email || !user.emailHash) continue;
    const existingMemberCursor = await targetDb.query<{
      _key: string;
      platformId?: string;
      role?: string;
      isMfaEnabled?: boolean;
      has_request_mfa_reset_link?: boolean;
      isSuperAdmin?: boolean;
      refreshTokenHash?: string | null;
      totpSecret?: string | null;
      lastTotpTimeStep?: number | null;
      requested_mfa_reset_link_at?: string | null;
      lastLoginAt?: string | null;
      createdAt?: string;
      updatedAt?: string;
    }>(
      `
        FOR m IN members
          FILTER m.userId == @userId
          LIMIT 1
          RETURN m
      `,
      { userId: user._key },
    );
    const existingMember = await existingMemberCursor.next();
    const key = existingMember?._key ?? newId();
    const now = new Date().toISOString();
    const memberWasSuperAdmin = existingMember?.isSuperAdmin == true || user.isSuperAdmin == true;
    await membersCollection.save(
      {
        _key: key,
        platformId: existingMember?.platformId ?? user.platformId ?? defaultPlatformId,
        userId: user._key,
        email: user.email,
        emailHash: user.emailHash,
        name: user.name ?? null,
        profileUrl: user.profileUrl ?? null,
        role: existingMember?.role ?? (memberWasSuperAdmin ? 'owner' : 'viewer'),
        isMfaEnabled: existingMember?.isMfaEnabled ?? user.isMfaEnabled ?? false,
        has_request_mfa_reset_link: existingMember?.has_request_mfa_reset_link ?? user.has_request_mfa_reset_link ?? false,
        refreshTokenHash: existingMember?.refreshTokenHash ?? user.refreshTokenHash ?? null,
        totpSecret: existingMember?.totpSecret ?? user.totpSecret ?? null,
        lastTotpTimeStep: existingMember?.lastTotpTimeStep ?? user.lastTotpTimeStep ?? null,
        requested_mfa_reset_link_at: existingMember?.requested_mfa_reset_link_at ?? user.requested_mfa_reset_link_at ?? null,
        lastLoginAt: existingMember?.lastLoginAt ?? user.lastLoginAt ?? null,
        createdAt: existingMember?.createdAt ?? user.createdAt ?? now,
        updatedAt: existingMember?.updatedAt ?? user.updatedAt ?? now,
        embedding: await embed({ text: buildMemberEmbedText(key, user.email, user.name) }),
      },
      { overwriteMode: 'update' },
    );

    if (memberWasSuperAdmin) {
      await superAdminsCollection.save(
        {
          _key: `super_admin_${user._key}`,
          userId: user._key,
          memberId: key,
          email: user.email,
          emailHash: user.emailHash,
          createdAt: existingMember?.createdAt ?? user.createdAt ?? now,
          updatedAt: now,
          embedding: await embed({ text: buildSuperAdminEmbedText(`super_admin_${user._key}`, user.email) }),
        },
        { overwriteMode: 'update' },
      );
    }
  }

  const existingSuperAdminMembersCursor = await targetDb.query<{
    _key: string;
    userId?: string;
    email?: string;
    emailHash?: string;
    createdAt?: string;
  }>(`
    FOR member IN members
      FILTER member.isSuperAdmin == true
      RETURN member
  `);
  for await (const member of existingSuperAdminMembersCursor) {
    if (!member.userId || !member.email || !member.emailHash) continue;
    const key = `super_admin_${member.userId}`;
    const now = new Date().toISOString();
    await superAdminsCollection.save(
      {
        _key: key,
        userId: member.userId,
        memberId: member._key,
        email: member.email,
        emailHash: member.emailHash,
        createdAt: member.createdAt ?? now,
        updatedAt: now,
        embedding: await embed({ text: buildSuperAdminEmbedText(key, member.email) }),
      },
      { overwriteMode: 'update' },
    );
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

  console.log('ArangoDB schema is up to date.');
  systemDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
