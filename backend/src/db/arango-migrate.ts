import 'dotenv/config';
import { Database } from 'arangojs';
import { embed } from '../lib/embed';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '../lib/alias';
import { newId } from '../lib/ids';
import { ensureOrganizationProvidersCollection } from '../lib/ai/organization-providers/indexes';
import { ensureOrganizationScopesCollection } from '../lib/ai/organization-scopes/indexes';
import { ensureAgentRunsCollection } from '../lib/ai/agent-runs/indexes';
import { PROVIDER_NAMES } from '../lib/ai/providers/types';

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
  // with the fields (scrubbed below); only distinctId + organizationId remain.
  // The platformId index goes with the platform -> organization rename.
  visitors: [['emailHash'], ['userId'], ['platformId']],
  users: [['platformId'], ['platform_role'], ['organization_role']],
  visitorSessions: [['platformId', 'connectedAt']],
  userSessions: [['platformId', 'connectedAt']],
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
    name: 'actions',
    embedKeys: ['name', 'description', 'objective', 'inputDescription', 'outputDescription'],
    indexes: [
      { fields: ['slug'], unique: true },
      { fields: ['handlerKey'] },
      { fields: ['enabled'] },
    ],
  },
  {
    name: 'providers',
    embedKeys: ['name', 'description', 'supportedUseCases'],
    indexes: [
      { fields: ['slug'], unique: true },
      { fields: ['handlerKey'] },
      { fields: ['enabled'] },
    ],
  },
  {
    name: 'models',
    embedKeys: ['name', 'description', 'supportedUseCases'],
    indexes: [{ fields: ['slug'], unique: true }],
  },
  {
    name: 'modelActions',
    indexes: [
      { fields: ['modelKey', 'actionKey'], unique: true },
      { fields: ['actionKey', 'enabled', 'priority'] },
    ],
  },
  {
    name: 'modelProviders',
    indexes: [
      { fields: ['modelKey', 'providerKey'], unique: true },
      { fields: ['providerKey', 'enabled'] },
    ],
  },
  {
    name: 'users',
    embedKeys: ['email', 'name'],
    indexes: [
      { fields: ['organizationId'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['alias_slug'], unique: true, sparse: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
    ],
  },
  {
    // Renamed from the legacy 'user_organization' (snake_case, singular —
    // every other collection is camelCase plural) — see the copy-and-drop
    // step near the end of main() that moves live rows across on deploy.
    name: 'userOrganizations',
    indexes: [
      { fields: ['organizationId'] },
      { fields: ['userId'] },
      { fields: ['organizationId', 'userId'], unique: true },
      { fields: ['organizationId', 'orgRole'] },
    ],
  },
  { name: 'minds', embedKeys: ['name'], indexes: [{ fields: ['userId'], unique: true }] },
  {
    name: 'orchestrators',
    embedKeys: ['name', 'role'],
    indexes: [{ fields: ['name'] }, { fields: ['voiceId'] }],
  },
  {
    name: 'voices',
    embedKeys: ['voice', 'label', 'modelLabel', 'language'],
    indexes: [{ fields: ['provider', 'model', 'voice'], unique: true }],
  },
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
  {
    name: 'organizations',
    embedKeys: ['name', 'slug', 'description'],
    indexes: [
      { fields: ['is_root'] },
      { fields: ['ownerId'] },
      { fields: ['slug'], unique: true, sparse: true },
    ],
  },
  {
    name: 'visitors',
    indexes: [
      { fields: ['organizationId'] },
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
      { fields: ['organizationId', 'connectedAt'] },
    ],
  },
  {
    name: 'userSessions',
    indexes: [
      { fields: ['userId'] },
      { fields: ['source'] },
      { fields: ['sessionKey'], unique: true },
      { fields: ['disconnectedAt'] },
      { fields: ['organizationId', 'connectedAt'] },
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
  // AI framework nodes. Creation + read-path indexes are owned by the
  // ensure*Collection modules under src/lib/ai (called from main below);
  // these entries exist so the generic embedding backfill covers them.
  // Embedding policy: only human text is embedded — ids, enums, and
  // timestamps are queryable with plain filters and are never embed text.
  { name: 'organizationScopes', embedKeys: ['name'] },
  { name: 'organizationProviders', embedKeys: ['name'] },
  // Every top-level agentRuns field is an id/enum/timestamp, so no
  // embedKeys: the ledger keeps a normalized empty embedding until a
  // prose field (e.g. a run summary) exists to embed.
  { name: 'agentRuns' },
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
  // The output ledger is retired: outputs, its edge collection, and its
  // analytics snapshots go together. postRenders (the pre-outputs legacy
  // ledger this file used to migrate INTO outputs) has nowhere to land
  // anymore and is dropped with them.
  'outputs',
  'outputRelations',
  'outputAnalytics',
  'postRenders',
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

  // AI framework collections: creation + read-path indexes are owned by
  // their ensure* modules. Runs BEFORE the `collections` loop so the
  // generic embedding backfill below sees them fully set up.
  await ensureOrganizationProvidersCollection(targetDb);
  await ensureOrganizationScopesCollection(targetDb);
  await ensureAgentRunsCollection(targetDb);

  // Providers written before the display-name field existed: stamp the
  // static PROVIDER_NAMES text (the embedded field — ids are never embed
  // text) so the embedding backfill below has something to embed.
  await targetDb.query(
    `
      FOR doc IN organizationProviders
        FILTER doc.name == null
        UPDATE doc WITH { name: @names[doc.providerId] || doc.providerId } IN organizationProviders
    `,
    { names: PROVIDER_NAMES },
  );

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

  // AI-layer collections rename: the first cut shipped snake_case names;
  // every other collection is camelCase plural, so copy the documents
  // across (preserving _key) and retire the legacy collections. Runs
  // BEFORE the ensure* calls below so indexes land on the new names.
  // overwriteMode ignore makes reruns no-ops.
  const aiCollectionRenames: Array<{ legacy: string; current: string }> = [
    { legacy: 'organization_providers', current: 'organizationProviders' },
    { legacy: 'organization_scopes', current: 'organizationScopes' },
    { legacy: 'agent_runs', current: 'agentRuns' },
  ];
  for (const { legacy, current } of aiCollectionRenames) {
    const legacyCollection = targetDb.collection(legacy);
    if (!(await legacyCollection.exists())) continue;
    const currentCollection = targetDb.collection(current);
    if (!(await currentCollection.exists())) {
      await currentCollection.create();
    }
    await targetDb.query(
      `
      FOR doc IN @@legacy
        INSERT doc INTO @@current OPTIONS { overwriteMode: "ignore" }
      `,
      { '@legacy': legacy, '@current': current },
    );
    await legacyCollection.drop();
    console.log(`Copied ${legacy} -> ${current} and dropped ${legacy}`);
  }


  // Legacy scratch collection the org-migration steps below write into
  // before the final user_organization -> userOrganizations copy. Not part
  // of `collections` above (that's the current schema, and this name is
  // retired at the end of this run) but must exist for those AQL writes to
  // resolve even when there's no legacy data to migrate (e.g. a fresh CI
  // database).
  if (!(await targetDb.collection('user_organization').exists())) {
    await targetDb.collection('user_organization').create();
    console.log('Created legacy scratch collection user_organization');
  }

  // Root organization: the single is_root node every user, visitor,
  // session, and event hangs off. The legacy `platforms` singleton (named
  // "this") is copied across PRESERVING its _key, so every stored
  // platformId value keeps pointing at the right node — only the field
  // names need renaming, never the ids. `platforms` itself is dropped at
  // the end of this migration, after all copies and renames completed.
  const organizationsCollection = targetDb.collection('organizations');
  let rootOrganizationId: string | null = null;
  const rootOrganizationCursor = await targetDb.query<{ _key: string }>(`
    FOR organization IN organizations
      FILTER organization.is_root == true
      LIMIT 1
      RETURN { _key: organization._key }
  `);
  const existingRootOrganization = await rootOrganizationCursor.next();
  if (existingRootOrganization) {
    rootOrganizationId = existingRootOrganization._key;
  }

  const legacyPlatformsCollection = targetDb.collection('platforms');
  if (await legacyPlatformsCollection.exists()) {
    const legacyPlatformsCursor = await targetDb.query<Record<string, unknown>>(`
      FOR platform IN platforms
        RETURN platform
    `);
    const legacyPlatforms = await legacyPlatformsCursor.all();
    for (const platform of legacyPlatforms) {
      const key = nonEmptyString(platform._key);
      if (!key) continue;
      const isRoot = platform.name === 'this' || legacyPlatforms.length === 1;
      const name = isRoot ? 'Vorinthex AI' : String(platform.name ?? '');
      await organizationsCollection.save(
        {
          _key: key,
          name,
          is_root: isRoot,
          ownerId: null,
          slug: null,
          description: null,
          isActive: true,
          // mfa_enabled is THE source of truth for MFA enforcement; the
          // root organization always enforces it.
          mfa_enabled: isRoot || platform.mfa_enabled === true,
          metadata: platform.metadata && typeof platform.metadata === 'object' ? platform.metadata : {},
          createdAt: nonEmptyString(platform.createdAt) ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          embedding: await embed({ text: ['_organizations', key, name].join(':') }),
        },
        { overwriteMode: 'ignore' },
      );
      if (isRoot && !rootOrganizationId) rootOrganizationId = key;
    }
    if (legacyPlatforms.length > 0) {
      console.log(`Copied ${legacyPlatforms.length} platforms -> organizations`);
    }
  }

  if (!rootOrganizationId) {
    rootOrganizationId = newId();
    const now = new Date().toISOString();
    await organizationsCollection.save({
      _key: rootOrganizationId,
      name: 'Vorinthex AI',
      is_root: true,
      ownerId: null,
      slug: null,
      description: null,
      isActive: true,
      mfa_enabled: true,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      embedding: await embed({ text: ['_organizations', rootOrganizationId, 'Vorinthex AI'].join(':') }),
    });
    console.log('Created root organization Vorinthex AI');
  }

  await targetDb.query(`
    FOR organization IN organizations
      FILTER !HAS(organization, "mfa_enabled")
      UPDATE organization WITH { mfa_enabled: false } IN organizations
  `);

  // mfa_enabled is THE source of truth for MFA enforcement (auth code
  // never derives it from is_root) — align the root organization, which
  // has always been enforced in practice, so the data says what the
  // code does.
  await targetDb.query(`
    FOR organization IN organizations
      FILTER organization.is_root == true && organization.mfa_enabled != true
      UPDATE organization WITH { mfa_enabled: true } IN organizations
  `);

  // Teams collapse into organizations: a team becomes an ordinary
  // (non-root) organization under the same _key, and each teamMembers row
  // becomes a user_organization row whose organizationId is the old
  // teamId — so membership links survive the rename untouched. The
  // teamMemberInvites collection retires with the feature (it has no API
  // surface); all three legacy collections are dropped at the end.
  const legacyTeamsCollection = targetDb.collection('teams');
  if (await legacyTeamsCollection.exists()) {
    const legacyTeamsCursor = await targetDb.query<Record<string, unknown>>(`
      FOR team IN teams
        RETURN team
    `);
    const legacyTeams = await legacyTeamsCursor.all();
    for (const team of legacyTeams) {
      const key = nonEmptyString(team._key);
      if (!key) continue;
      const name = String(team.name ?? '');
      const embedText = buildNodeEmbedText('organizations', key, ['name', 'slug', 'description'], team);
      await organizationsCollection.save(
        {
          _key: key,
          name,
          is_root: false,
          ownerId: nonEmptyString(team.ownerId),
          slug: nonEmptyString(team.slug),
          description: nonEmptyString(team.description),
          isActive: team.isActive !== false,
          mfa_enabled: team.mfa_enabled === true,
          metadata: {},
          createdAt: nonEmptyString(team.createdAt) ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          embedding: embedText ? await embed({ text: embedText }) : [],
        },
        { overwriteMode: 'ignore' },
      );
    }
    if (legacyTeams.length > 0) {
      console.log(`Copied ${legacyTeams.length} teams -> organizations`);
    }
  }

  const legacyTeamMembersCollection = targetDb.collection('teamMembers');
  if (await legacyTeamMembersCollection.exists()) {
    const userOrganizationCollection = targetDb.collection('user_organization');
    const legacyTeamMembersCursor = await targetDb.query<Record<string, unknown>>(`
      FOR member IN teamMembers
        RETURN member
    `);
    const legacyTeamMembers = await legacyTeamMembersCursor.all();
    for (const member of legacyTeamMembers) {
      const key = nonEmptyString(member._key);
      const organizationId = nonEmptyString(member.teamId);
      const userId = nonEmptyString(member.userId);
      if (!key || !organizationId || !userId) continue;
      await userOrganizationCollection.save(
        {
          _key: key,
          organizationId,
          userId,
          orgRole: nonEmptyString(member.role) ?? 'viewer',
          orgTitle: nonEmptyString(member.title),
          status: nonEmptyString(member.status) ?? 'active',
          joinedAt: nonEmptyString(member.joinedAt) ?? nonEmptyString(member.createdAt) ?? new Date().toISOString(),
          invitedByUserId: nonEmptyString(member.invitedByUserId),
          isMfaEnabled: member.isMfaEnabled === true,
          totpSecret: nonEmptyString(member.totpSecret),
          lastTotpTimeStep: typeof member.lastTotpTimeStep === 'number' ? member.lastTotpTimeStep : null,
          createdAt: nonEmptyString(member.createdAt) ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          embedding: [],
        },
        { overwriteMode: 'ignore' },
      );
    }
    if (legacyTeamMembers.length > 0) {
      console.log(`Copied ${legacyTeamMembers.length} teamMembers -> user_organization`);
    }
  }

  const legacyOrganizationMembersCollection = targetDb.collection('organizationMembers');
  if (await legacyOrganizationMembersCollection.exists()) {
    await targetDb.query(`
      FOR member IN organizationMembers
        FILTER HAS(member, "organizationId") && member.organizationId != null && member.organizationId != ""
          && HAS(member, "userId") && member.userId != null && member.userId != ""
        UPSERT { organizationId: member.organizationId, userId: member.userId }
        INSERT {
          _key: member._key,
          organizationId: member.organizationId,
          userId: member.userId,
          orgRole: HAS(member, "orgRole") ? member.orgRole : (HAS(member, "role") ? member.role : "viewer"),
          orgTitle: HAS(member, "orgTitle") ? member.orgTitle : (HAS(member, "title") ? member.title : null),
          status: HAS(member, "status") ? member.status : "active",
          joinedAt: HAS(member, "joinedAt") ? member.joinedAt : (HAS(member, "createdAt") ? member.createdAt : DATE_ISO8601(DATE_NOW())),
          invitedByUserId: HAS(member, "invitedByUserId") ? member.invitedByUserId : null,
          isMfaEnabled: HAS(member, "isMfaEnabled") ? member.isMfaEnabled : false,
          totpSecret: HAS(member, "totpSecret") ? member.totpSecret : null,
          lastTotpTimeStep: HAS(member, "lastTotpTimeStep") ? member.lastTotpTimeStep : null,
          createdAt: HAS(member, "createdAt") ? member.createdAt : DATE_ISO8601(DATE_NOW()),
          updatedAt: DATE_ISO8601(DATE_NOW()),
          embedding: []
        }
        UPDATE {
          orgRole: HAS(member, "orgRole") ? member.orgRole : (HAS(member, "role") ? member.role : OLD.orgRole),
          orgTitle: HAS(member, "orgTitle") ? member.orgTitle : (HAS(member, "title") ? member.title : OLD.orgTitle),
          status: HAS(member, "status") ? member.status : OLD.status,
          isMfaEnabled: HAS(member, "isMfaEnabled") ? member.isMfaEnabled : OLD.isMfaEnabled,
          totpSecret: HAS(member, "totpSecret") ? member.totpSecret : OLD.totpSecret,
          lastTotpTimeStep: HAS(member, "lastTotpTimeStep") ? member.lastTotpTimeStep : OLD.lastTotpTimeStep,
          updatedAt: DATE_ISO8601(DATE_NOW())
        }
        IN user_organization
    `);
    console.log('Copied organizationMembers -> user_organization');
  }

  // Rename the platform-era fields on users in one pass: organizationId
  // takes the old platformId value (same key, see the copy above), and the
  // role/title pair moves to its organization_* names.
  await targetDb.query(
    `
    FOR u IN users
      FILTER !HAS(u, "organizationId") || u.organizationId == null || u.organizationId == ""
        || !HAS(u, "organization_role") || !HAS(u, "organization_title")
        || HAS(u, "platformId") || HAS(u, "platform_role") || HAS(u, "platform_title")
      UPDATE u WITH {
        organizationId: (HAS(u, "organizationId") && u.organizationId != null && u.organizationId != "")
          ? u.organizationId
          : ((HAS(u, "platformId") && u.platformId != null && u.platformId != "") ? u.platformId : @rootOrganizationId),
        organization_role: HAS(u, "organization_role") ? u.organization_role : (HAS(u, "platform_role") ? u.platform_role : null),
        organization_title: HAS(u, "organization_title") ? u.organization_title : (HAS(u, "platform_title") ? u.platform_title : null),
        platformId: null,
        platform_role: null,
        platform_title: null
      } IN users OPTIONS { keepNull: false }
    `,
    { rootOrganizationId },
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

  await targetDb.query(`
    FOR u IN users
      FILTER HAS(u, "isSuperAdmin")
      UPDATE u WITH { isSuperAdmin: null } IN users OPTIONS { keepNull: false }
  `);

  let migratedLegacyIdentities = false;
  const membersCollection = targetDb.collection('members');
  if (await membersCollection.exists()) {
    migratedLegacyIdentities = true;
    await targetDb.query(
      `
      FOR m IN members
        FILTER !HAS(m, "organizationId")
          || m.organizationId == null
          || m.organizationId == ""
          || !HAS(m, "role")
          || m.role == null
          || m.role == ""
          || HAS(m, "isSuperAdmin")
        UPDATE m WITH {
          organizationId: (!HAS(m, "organizationId") || m.organizationId == null || m.organizationId == "") ? @rootOrganizationId : m.organizationId,
          role: (!HAS(m, "role") || m.role == null || m.role == "") ? (m.isSuperAdmin == true ? "owner" : "viewer") : m.role,
          isSuperAdmin: null
        } IN members OPTIONS { keepNull: false }
      `,
      { rootOrganizationId },
    );

    await targetDb.query(`
      FOR m IN members
        LET existing = FIRST(FOR u IN users FILTER u.emailHash == m.emailHash LIMIT 1 RETURN u)
        FILTER existing == null
        INSERT {
          _key: m._key,
          organizationId: HAS(m, "organizationId") && m.organizationId != null && m.organizationId != "" ? m.organizationId : @rootOrganizationId,
          email: m.email,
          emailHash: m.emailHash,
          name: HAS(m, "name") ? m.name : null,
          profileUrl: HAS(m, "profileUrl") ? m.profileUrl : null,
          alias: null,
          alias_slug: null,
          organization_role: "viewer",
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
    `, { rootOrganizationId });

    await targetDb.query(`
      FOR m IN members
        FOR u IN users
          FILTER u.emailHash == m.emailHash
          UPDATE u WITH {
            organization_role: u.organization_role == "owner" || u.organization_role == "admin" ? u.organization_role : "viewer",
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
          organizationId: HAS(admin, "organizationId") && admin.organizationId != null && admin.organizationId != "" ? admin.organizationId : @rootOrganizationId,
          email: admin.email,
          emailHash: admin.emailHash,
          name: null,
          profileUrl: null,
          alias: null,
          alias_slug: null,
          organization_role: "owner",
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
    `, { rootOrganizationId });

    await targetDb.query(`
      FOR admin IN superAdmins
        FOR u IN users
          FILTER u.emailHash == admin.emailHash
          UPDATE u WITH {
            organization_role: "owner",
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

  await targetDb.query(
    `
    FOR u IN users
      LET organizationId = (HAS(u, "organizationId") && u.organizationId != null && u.organizationId != "") ? u.organizationId : @rootOrganizationId
      LET legacyRole = HAS(u, "organization_role") && u.organization_role != null && u.organization_role != ""
        ? u.organization_role
        : null
      LET hasLegacyMfa = HAS(u, "isMfaEnabled")
        || HAS(u, "totpSecret")
        || HAS(u, "lastTotpTimeStep")
      FILTER legacyRole != null || hasLegacyMfa
      LET normalizedRole = legacyRole == "owner" || legacyRole == "admin" || legacyRole == "member" || legacyRole == "viewer"
        ? legacyRole
        : "viewer"
      UPSERT { organizationId, userId: u._key }
      INSERT {
        _key: CONCAT("uorg_", organizationId, "_", u._key),
        organizationId,
        userId: u._key,
        orgRole: normalizedRole,
        orgTitle: HAS(u, "organization_title") ? u.organization_title : null,
        status: "active",
        joinedAt: HAS(u, "createdAt") ? u.createdAt : DATE_ISO8601(DATE_NOW()),
        invitedByUserId: null,
        isMfaEnabled: HAS(u, "isMfaEnabled") ? u.isMfaEnabled : false,
        totpSecret: HAS(u, "totpSecret") ? u.totpSecret : null,
        lastTotpTimeStep: HAS(u, "lastTotpTimeStep") ? u.lastTotpTimeStep : null,
        createdAt: HAS(u, "createdAt") ? u.createdAt : DATE_ISO8601(DATE_NOW()),
        updatedAt: DATE_ISO8601(DATE_NOW()),
        embedding: []
      }
      UPDATE {
        orgRole: OLD.orgRole == "owner" ? OLD.orgRole : normalizedRole,
        orgTitle: HAS(u, "organization_title") && u.organization_title != null ? u.organization_title : OLD.orgTitle,
        isMfaEnabled: HAS(u, "isMfaEnabled") ? u.isMfaEnabled : OLD.isMfaEnabled,
        totpSecret: HAS(u, "totpSecret") ? u.totpSecret : OLD.totpSecret,
        lastTotpTimeStep: HAS(u, "lastTotpTimeStep") ? u.lastTotpTimeStep : OLD.lastTotpTimeStep,
        updatedAt: DATE_ISO8601(DATE_NOW())
      }
      IN user_organization
    `,
    { rootOrganizationId },
  );

  await targetDb.query(`
    FOR u IN users
      FILTER HAS(u, "organization_role")
        || HAS(u, "organization_title")
        || HAS(u, "isMfaEnabled")
        || HAS(u, "has_request_mfa_reset_link")
        || HAS(u, "isSuperAdmin")
        || HAS(u, "totpSecret")
        || HAS(u, "lastTotpTimeStep")
        || HAS(u, "requested_mfa_reset_link_at")
      UPDATE u WITH {
        organization_role: null,
        organization_title: null,
        isMfaEnabled: null,
        has_request_mfa_reset_link: null,
        isSuperAdmin: null,
        totpSecret: null,
        lastTotpTimeStep: null,
        requested_mfa_reset_link_at: null
      } IN users OPTIONS { keepNull: false }
  `);

  if (migratedLegacyIdentities) {
    await backfillCollectionEmbeddings(targetDb, collections.find((spec) => spec.name === 'users')!);
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
      const eventEmbedText = buildNodeEmbedText('events', key, ['belongsTo', 'slug'], { belongsTo: 'organization', slug });
      await eventsCollection.save({
        _key: key,
        sourceId: rootOrganizationId,
        belongsTo: 'organization',
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
      const eventEmbedText = buildNodeEmbedText('events', key, ['belongsTo', 'slug'], { belongsTo: 'organization', slug });
      await eventsCollection.save(
        {
          _key: key,
          sourceId: rootOrganizationId,
          belongsTo: 'organization',
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
    const belongsTo = legacyAppSourceId ? 'app' : 'organization';
    const legacyPlatformSourceId = event.belongsTo === 'platform' && event.entityId !== userId
      ? nonEmptyString(event.entityId)
      : null;
    const sourceId = legacyAppSourceId
      ?? nonEmptyString(event.sourceId)
      ?? legacyPlatformSourceId
      ?? rootOrganizationId;
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
      organizationId?: string;
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
        organizationId: active.organizationId,
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

  // platform -> organization rename on the remaining owners: visitors and
  // both session ledgers carry the same key under the new field name. Runs
  // after every legacy copy above so nothing can reintroduce platformId.
  for (const ownedCollection of ['visitors', 'visitorSessions', 'userSessions']) {
    await targetDb.query(
      `
      FOR doc IN @@collection
        FILTER HAS(doc, "platformId")
          || !HAS(doc, "organizationId") || doc.organizationId == null || doc.organizationId == ""
        UPDATE doc WITH {
          organizationId: (HAS(doc, "organizationId") && doc.organizationId != null && doc.organizationId != "")
            ? doc.organizationId
            : ((HAS(doc, "platformId") && doc.platformId != null && doc.platformId != "") ? doc.platformId : @rootOrganizationId),
          platformId: null
        } IN @@collection OPTIONS { keepNull: false }
      `,
      { '@collection': ownedCollection, rootOrganizationId },
    );
  }

  // Events flip their ownership label: belongsTo "platform" becomes
  // "organization" (sourceId already points at the copied node). The
  // embedding text includes belongsTo, so re-embed the flipped rows —
  // drained fully before the per-row work, like the legacy passes above.
  const platformEventsCursor = await targetDb.query<{ _key: string; slug?: string }>(`
    FOR event IN events
      FILTER event.belongsTo == "platform"
      RETURN { _key: event._key, slug: event.slug }
  `);
  const platformEvents = await platformEventsCursor.all();
  if (platformEvents.length > 0) {
    console.log(`Flipping ${platformEvents.length} events belongsTo platform -> organization`);
  }
  for (const event of platformEvents) {
    const eventEmbedText = typeof event.slug === 'string' && event.slug.length > 0
      ? buildNodeEmbedText('events', event._key, ['belongsTo', 'slug'], { belongsTo: 'organization', slug: event.slug })
      : null;
    await eventsCollection.update(event._key, {
      belongsTo: 'organization',
      embedding: eventEmbedText ? await embed({ text: eventEmbedText }) : [],
    });
  }

  // user_organization -> userOrganizations rename: copy every row across
  // (preserving _key so nothing else needs to change), UPSERT'd on the same
  // (organizationId, userId) pair the unique index enforces so this is safe
  // to run again. Runs after every block above that still writes into the
  // legacy 'user_organization' name so it picks up rows those backfills
  // just wrote. The old collection is dropped alongside the other retired
  // collections below, in this same run.
  const legacyUserOrganizationCollection = targetDb.collection('user_organization');
  if (await legacyUserOrganizationCollection.exists()) {
    await targetDb.query(`
      FOR link IN user_organization
        UPSERT { organizationId: link.organizationId, userId: link.userId }
        INSERT {
          _key: link._key,
          organizationId: link.organizationId,
          userId: link.userId,
          orgRole: link.orgRole,
          orgTitle: HAS(link, "orgTitle") ? link.orgTitle : null,
          status: HAS(link, "status") ? link.status : "active",
          joinedAt: link.joinedAt,
          invitedByUserId: HAS(link, "invitedByUserId") ? link.invitedByUserId : null,
          isMfaEnabled: HAS(link, "isMfaEnabled") ? link.isMfaEnabled : false,
          totpSecret: HAS(link, "totpSecret") ? link.totpSecret : null,
          lastTotpTimeStep: HAS(link, "lastTotpTimeStep") ? link.lastTotpTimeStep : null,
          createdAt: link.createdAt,
          updatedAt: link.updatedAt,
          embedding: []
        }
        UPDATE {
          orgRole: link.orgRole,
          orgTitle: HAS(link, "orgTitle") ? link.orgTitle : OLD.orgTitle,
          status: HAS(link, "status") ? link.status : OLD.status,
          isMfaEnabled: HAS(link, "isMfaEnabled") ? link.isMfaEnabled : OLD.isMfaEnabled,
          totpSecret: HAS(link, "totpSecret") ? link.totpSecret : OLD.totpSecret,
          lastTotpTimeStep: HAS(link, "lastTotpTimeStep") ? link.lastTotpTimeStep : OLD.lastTotpTimeStep,
          updatedAt: link.updatedAt
        }
        IN userOrganizations
    `);
    console.log('Copied user_organization -> userOrganizations');
  }

  // The platforms collection is fully copied into organizations (same keys)
  // and nothing references it anymore — retire it. Teams follow the same
  // path (copied into organizations/userOrganizations above), and the
  // invites collection retires with the teams feature. user_organization
  // retires here too, now that its rows live in userOrganizations above.
  for (const retiredCollectionName of ['platforms', 'teams', 'teamMembers', 'teamMemberInvites', 'organizationMembers', 'user_organization']) {
    const retiredCollection = targetDb.collection(retiredCollectionName);
    if (await retiredCollection.exists()) {
      await retiredCollection.drop();
      console.log(`Dropped collection ${retiredCollectionName}`);
    }
  }

  console.log('ArangoDB schema is up to date.');
  systemDb.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
