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

const collections: CollectionSpec[] = [
  { name: 'users', indexes: [{ fields: ['email'], unique: true }, { fields: ['emailHash'], unique: true }] },
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
    indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['belongsTo', 'entityId', 'createdAt'] }],
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
        entityId: user._key,
        belongsTo: 'user',
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
          entityId: event.userId,
          belongsTo: 'user',
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

  const eventsCursor = await targetDb.query<{ _key: string; slug?: string; entityId?: string; belongsTo?: string }>(`
    FOR event IN events
      RETURN { _key: event._key, slug: event.slug, entityId: event.entityId, belongsTo: event.belongsTo }
  `);
  for await (const event of eventsCursor) {
    const belongsTo = event.belongsTo === 'app' || event.belongsTo === 'platform' || event.belongsTo === 'user' ? event.belongsTo : 'platform';
    const entityId = belongsTo === 'platform'
      ? defaultPlatformId
      : typeof event.entityId === 'string' && event.entityId.length > 0
        ? event.entityId
        : newId();
    const embedding = typeof event.slug === 'string' && event.slug.length > 0
      ? await embed({ text: buildEventEmbedText(event._key, belongsTo, event.slug) })
      : [];
    await eventsCollection.update(event._key, { entityId, belongsTo, entityType: null, embedding }, { keepNull: false });
  }

  await targetDb.query(`
    FOR u IN users
      FILTER !HAS(u, "has_request_mfa_reset_link")
        || !HAS(u, "requested_mfa_reset_link_at")
        || !HAS(u, "is_subscribed_to_updates")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at")
        || HAS(u, "events")
      UPDATE u WITH {
        events: null,
        has_request_mfa_reset_link: HAS(u, "has_request_mfa_reset_link") ? u.has_request_mfa_reset_link : false,
        requested_mfa_reset_link_at: HAS(u, "requested_mfa_reset_link_at") ? u.requested_mfa_reset_link_at : null,
        is_subscribed_to_updates: HAS(u, "is_subscribed_to_updates") ? u.is_subscribed_to_updates : (HAS(u, "isSubscribedToNewsletter") ? u.isSubscribedToNewsletter : true),
        is_subscribed_to_updates_unsubscribe_token_hash: HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash") ? u.is_subscribed_to_updates_unsubscribe_token_hash : null,
        is_subscribed_to_updates_unsubscribe_requested_at: HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at") ? u.is_subscribed_to_updates_unsubscribe_requested_at : null
      } IN users OPTIONS { keepNull: false }
  `);

  console.log('ArangoDB schema is up to date.');
  systemDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
