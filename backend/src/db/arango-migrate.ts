import 'dotenv/config';
import { Database } from 'arangojs';
import { embedText } from '../lib/bedrock-titan';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '../lib/alias';
import { newId } from '../lib/ids';
import { ensureOrganizationProvidersCollection } from '../lib/ai/organization-providers/indexes';
import { ensureOrganizationCredentialsCollection } from '../lib/ai/organization-credentials/indexes';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from '../lib/ai/scopes/indexes';
import { ensureAgentRunsCollection } from '../lib/ai/agent-runs/indexes';
import { ensureAgentRunStepsCollection } from '../lib/ai/agent-run-steps/indexes';
import { ensureAgentRunCallsCollection } from '../lib/ai/agent-run-calls/indexes';
import { ensureAgentArtifactsCollection } from '../lib/ai/agent-artifacts/indexes';
import { ensureArtifactCollections } from '../lib/artifacts/indexes';
import { seedNexusOrganizationArtifact } from '../lib/artifacts/seed';
import { ensureAgentMemoriesCollection } from '../lib/ai/agent-memories/indexes';
import { ensureAgentRunSourcesCollection } from '../lib/ai/agent-run-sources/indexes';
import { ensureAgentArtifactChecksCollection } from '../lib/ai/agent-artifact-checks/indexes';
import { ensureRuntimeVariablesCollection } from '../lib/ai/runtime-variables/indexes';
import { organizationProviderSchema } from '../lib/ai/organization-providers/schema';
import { buildEmbeddingText } from '../lib/db/base';
import { NEXUS_SCOPE_KEY, SEEDED_SCOPES } from '../lib/db/seed';
import { isLegacyIndex, LEGACY_INDEX_FIELDS } from './arango-migrate-indexes';
import { legacyContentRepresentations, stageLegacyDocumentShares } from './archive-migration';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const username = process.env.ARANGO_USERNAME ?? 'root';
const password = process.env.ARANGO_ROOT_PASSWORD ?? '';
interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
  embedKeys?: string[];
  skipEmbedding?: boolean;
  archive?: boolean;
}

function buildNodeEmbedText(_collectionName: string, _key: string, embedKeys: readonly string[], doc: Record<string, unknown>): string | null {
  return buildEmbeddingText(embedKeys, doc);
}

function generateEmbedding(text: string) {
  if (process.env.ARCHIVE_E2E === 'true') {
    const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1024);
    const digest = Buffer.from(new Bun.CryptoHasher('sha256').update(text).digest());
    return Promise.resolve(Array.from({ length: dimensions }, (_, index) => digest[index % digest.length]! / 255));
  }
  return embedText({ text });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function runMigrationTransaction(targetDb: Database, collectionName: string, query: string, bindVars: Record<string, unknown>) {
  const transaction = await targetDb.beginTransaction({ write: [collectionName], exclusive: [collectionName] });
  try {
    await transaction.step(async () => {
      const cursor = await targetDb.query(query, bindVars);
      await cursor.all();
    });
    await transaction.commit();
  } catch (error) {
    await transaction.abort();
    throw error;
  }
}

export async function migrateArchiveVersions(targetDb: Database) {
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  const enforceDimensions = Number.isInteger(dimensions) && dimensions > 0;
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR snapshot IN documentVersions
        FILTER snapshot._key > @after
        FILTER !IS_STRING(snapshot.html) || LENGTH(TRIM(snapshot.html)) == 0
          || !IS_OBJECT(snapshot.json) || snapshot.json.type != "doc"
          || !IS_STRING(snapshot.content) || LENGTH(TRIM(snapshot.content)) == 0
          || !IS_ARRAY(snapshot.embedding) || LENGTH(snapshot.embedding) == 0
          || LENGTH(snapshot.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || (@dimensions > 0 && LENGTH(snapshot.embedding) != @dimensions)
        SORT snapshot._key
        LIMIT 50
        RETURN snapshot
    `, { after, dimensions: enforceDimensions ? dimensions : 0 });
    const snapshots = await cursor.all();
    if (snapshots.length === 0) break;
    const updates: Array<Record<string, unknown>> = [];
    for (const snapshot of snapshots) {
      const content = nonEmptyString(snapshot.content);
      if (!content) throw new Error(`Cannot migrate documentVersions: ${String(snapshot._key)} has no nonempty historical content.`);
      const hasHtml = nonEmptyString(snapshot.html) !== null;
      const hasJson = snapshot.json !== null && typeof snapshot.json === 'object' && (snapshot.json as Record<string, unknown>).type === 'doc';
      const representations = hasHtml && hasJson ? {} : legacyContentRepresentations(content);
      let embedding = snapshot.embedding;
      if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value)) || (enforceDimensions && embedding.length !== dimensions)) {
        embedding = await generateEmbedding(content);
      }
      if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value)) || (enforceDimensions && embedding.length !== dimensions)) {
        throw new Error(`Cannot migrate documentVersions: ${String(snapshot._key)} could not produce a valid historical-content embedding.`);
      }
      updates.push({ _key: snapshot._key, ...representations, embedding });
    }
    await runMigrationTransaction(targetDb, 'documentVersions', `
      FOR patch IN @updates
        UPDATE patch._key WITH UNSET(patch, "_key") IN documentVersions
    `, { updates });
    after = String(snapshots.at(-1)!._key);
  }
  const verification = await targetDb.query<number>(`
    RETURN LENGTH(FOR snapshot IN documentVersions
      FILTER !IS_STRING(snapshot.html) || LENGTH(TRIM(snapshot.html)) == 0
        || !IS_OBJECT(snapshot.json) || snapshot.json.type != "doc"
        || !IS_STRING(snapshot.content) || LENGTH(TRIM(snapshot.content)) == 0
        || !IS_ARRAY(snapshot.embedding) || LENGTH(snapshot.embedding) == 0
        || LENGTH(snapshot.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || (@dimensions > 0 && LENGTH(snapshot.embedding) != @dimensions)
      RETURN 1)
  `, { dimensions: enforceDimensions ? dimensions : 0 });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`documentVersions migration verification failed for ${invalid} row(s).`);
}

export async function migrateArchiveShares(targetDb: Database) {
  const invalidShare = await targetDb.query<string>(`
    FOR share IN documentShares
      FILTER !REGEX_TEST(share.tokenHash, "^[a-fA-F0-9]{64}$")
      FILTER !IS_STRING(share.token) || LENGTH(share.token) == 0
      LIMIT 1
      RETURN share._key
  `);
  if (await invalidShare.next()) throw new Error('Cannot migrate documentShares: a row has neither a valid tokenHash nor a plaintext token.');

  const duplicateValid = await targetDb.query<string>(`
    FOR share IN documentShares
      FILTER REGEX_TEST(share.tokenHash, "^[a-fA-F0-9]{64}$")
      COLLECT hash = LOWER(share.tokenHash) WITH COUNT INTO count
      FILTER count > 1
      LIMIT 1
      RETURN hash
  `);
  const validCollision = await duplicateValid.next();
  if (validCollision) throw new Error(`Cannot migrate documentShares: duplicate token hash ${validCollision}.`);

  const duplicateLegacy = await targetDb.query<string>(`
    FOR share IN documentShares
      FILTER !REGEX_TEST(share.tokenHash, "^[a-fA-F0-9]{64}$")
      COLLECT hash = SHA256(share.token) WITH COUNT INTO count
      FILTER count > 1
      LIMIT 1
      RETURN hash
  `);
  const legacyCollision = await duplicateLegacy.next();
  if (legacyCollision) throw new Error(`Cannot migrate documentShares: duplicate token hash ${legacyCollision}.`);

  // Keyset pages bound both the wire result and cross-set hash lookup bind variables.
  let collisionAfter = '';
  while (true) {
    const page = await targetDb.query<{ key: string; hash: string }>(`
      FOR share IN documentShares
        FILTER share._key > @after
        FILTER !REGEX_TEST(share.tokenHash, "^[a-fA-F0-9]{64}$")
        SORT share._key
        LIMIT 100
        RETURN { key: share._key, hash: SHA256(share.token) }
    `, { after: collisionAfter });
    const candidates = await page.all();
    if (candidates.length === 0) break;
    const crossSet = await targetDb.query<string>(`
      FOR candidate IN @candidates
        FOR existing IN documentShares
          FILTER REGEX_TEST(existing.tokenHash, "^[a-fA-F0-9]{64}$")
          FILTER LOWER(existing.tokenHash) == candidate.hash
          LIMIT 1
          RETURN candidate.hash
    `, { candidates });
    const collision = await crossSet.next();
    if (collision) throw new Error(`Cannot migrate documentShares: duplicate token hash ${collision}.`);
    collisionAfter = candidates.at(-1)!.key;
  }
  const collection = targetDb.collection('documentShares');
  for (const index of await collection.indexes()) {
    const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
    if (fields.length === 1 && fields[0] === 'token') await collection.dropIndex(index.id);
  }
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR share IN documentShares
        FILTER share._key > @after
        FILTER HAS(share, "token") || !REGEX_TEST(share.tokenHash, "^[a-f0-9]{64}$")
          || share.permission == "edit" || !IS_ARRAY(share.embedding) || LENGTH(share.embedding) != 0
        SORT share._key
        LIMIT 100
        RETURN share
    `, { after });
    const shares = await cursor.all();
    if (shares.length === 0) break;
    const updates = stageLegacyDocumentShares(shares);
    await runMigrationTransaction(targetDb, 'documentShares', `
      FOR patch IN @updates
        UPDATE patch._key WITH MERGE(UNSET(patch, "_key"), { token: null }) IN documentShares OPTIONS { keepNull: false }
    `, { updates });
    after = String(shares.at(-1)!._key);
  }
  const verification = await targetDb.query<number>(`
    LET malformed = LENGTH(FOR share IN documentShares
      FILTER HAS(share, "token") || !REGEX_TEST(share.tokenHash, "^[a-f0-9]{64}$")
      RETURN 1)
    LET duplicates = LENGTH(FOR share IN documentShares
      COLLECT hash = share.tokenHash WITH COUNT INTO count
      FILTER count > 1
      RETURN 1)
    RETURN malformed + duplicates
  `);
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`documentShares migration verification failed for ${invalid} hash group(s).`);
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
    embedKeys: ['name', 'slug'],
    indexes: [
      { fields: ['slug'], unique: true },
      { fields: ['handlerKey'] },
    ],
  },
  {
    name: 'models',
    embedKeys: ['name', 'description', 'supportedUseCases'],
    indexes: [{ fields: ['slug'], unique: true }],
  },
  {
    name: 'modelActions',
    skipEmbedding: true,
    indexes: [
      { fields: ['modelKey', 'actionKey'], unique: true },
      { fields: ['actionKey', 'enabled', 'priority'] },
    ],
  },
  {
    name: 'modelProviders',
    skipEmbedding: true,
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
      { fields: ['orchestratorKey'], sparse: true },
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
    embedKeys: ['name', 'title'],
    indexes: [
      { fields: ['slug'], unique: true },
      { fields: ['scopeKey'] },
    ],
  },
  {
    name: 'scopeAgents',
    skipEmbedding: true,
    indexes: [
      { fields: ['scopeKey', 'agentKey'], unique: true },
      { fields: ['organizationKey', 'scopeKey', 'status', 'position'] },
      { fields: ['agentKey', 'status'] },
    ],
  },
  {
    name: 'agentMembers',
    skipEmbedding: true,
    indexes: [
      { fields: ['scopeAgentKey', 'userOrganizationKey', 'source'], unique: true },
      { fields: ['organizationKey', 'agentKey', 'userOrganizationKey'] },
      { fields: ['scopeKey', 'userOrganizationKey'] },
    ],
  },
  {
    name: 'skills',
    embedKeys: ['name', 'title', 'definition'],
    indexes: [
      { fields: ['slug'], unique: true },
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
    embedKeys: ['slug'],
    skipEmbedding: true,
    indexes: [{ fields: ['slug', 'createdAt'] }, { fields: ['scopeId', 'createdAt'] }, { fields: ['userId', 'createdAt'] }],
  },
  {
    name: 'organizations',
    embedKeys: ['name', 'slug', 'description'],
    indexes: [
      { fields: ['is_root'] },
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
  { name: 'scopes', embedKeys: ['name', 'slug', 'description'] },
  { name: 'channels', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'position'] }, { fields: ['scopeKey', 'name'], unique: true }] },
  { name: 'channelParticipants', embedKeys: [], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['userOrganizationKey'], sparse: true }, { fields: ['orchestratorKey'], sparse: true }, { fields: ['channelKey', 'userOrganizationKey'], unique: true, sparse: true }, { fields: ['channelKey', 'orchestratorKey'], unique: true, sparse: true }] },
  { name: 'threads', embedKeys: ['title'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['rootMessageKey'], unique: true }, { fields: ['channelKey', 'status'] }] },
  { name: 'messages', embedKeys: ['content'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['threadKey'], sparse: true }, { fields: ['authorParticipantKey'] }, { fields: ['replyToMessageKey'], sparse: true }, { fields: ['channelKey', 'createdAt'] }, { fields: ['threadKey', 'createdAt'], sparse: true }] },
  { name: 'messageMentions', embedKeys: [], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['messageKey'] }, { fields: ['participantKey'] }, { fields: ['participantKey', 'handledAt'] }, { fields: ['messageKey', 'participantKey'], unique: true }] },
  { name: 'messageReactions', embedKeys: ['reaction'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['messageKey'] }, { fields: ['participantKey'] }, { fields: ['reaction'] }, { fields: ['messageKey', 'reaction'] }, { fields: ['messageKey', 'participantKey', 'reaction'], unique: true }] },
  { name: 'folders', embedKeys: ['name', 'description'], archive: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'deletedAt'] }, { fields: ['scopeKey', 'parentFolderKey'] }, { fields: ['scopeKey', 'parentFolderKey', 'name'], unique: true }] },
  { name: 'documents', embedKeys: ['name', 'content'], archive: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'deletedAt'] }, { fields: ['scopeKey', 'folderKey', 'deletedAt'] }, { fields: ['storageKey'], unique: true, sparse: true }, { fields: ['folderKey', 'name'] }] },
  { name: 'documentVersions', embedKeys: ['content'], archive: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'documentKey', 'deletedAt'] }, { fields: ['documentKey', 'version'], unique: true }] },
  { name: 'documentShares', embedKeys: [], archive: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'documentKey', 'deletedAt'] }, { fields: ['scopeKey', 'documentKey', 'revokedAt'] }, { fields: ['tokenHash'], unique: true }, { fields: ['expiresAt'], sparse: true }] },
  // Private replay ledger. Responses may contain one-time share tokens, so this
  // collection is deliberately not registered as a generic application node.
  { name: 'archiveIdempotency', skipEmbedding: true, indexes: [{ fields: ['organizationKey', 'actorKey', 'tool', 'idempotencyKey'], unique: true }, { fields: ['leaseExpiresAt'], sparse: true }, { fields: ['expiresAt'], sparse: true }] },
  { name: 'projects', embedKeys: ['name', 'description'], archive: true, indexes: [{ fields: ['scopeKey', 'deletedAt'] }, { fields: ['archiveFolderKey'], unique: true }, { fields: ['scopeKey', 'name'] }] },
  { name: 'milestones', embedKeys: ['name', 'description'], archive: true, indexes: [{ fields: ['scopeKey', 'deletedAt'] }, { fields: ['projectKey', 'deletedAt'] }, { fields: ['projectKey', 'order'] }, { fields: ['projectKey', 'status'] }] },
  { name: 'tasks', embedKeys: ['title', 'description'], archive: true, indexes: [{ fields: ['scopeKey', 'deletedAt'] }, { fields: ['projectKey', 'deletedAt'] }, { fields: ['milestoneKey', 'deletedAt'] }, { fields: ['milestoneKey', 'position'] }, { fields: ['projectKey', 'status'] }, { fields: ['priority'] }] },
  // Pure link nodes (scope tree edges, scope memberships) — ids only, so
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
  // Scopes were renamed from organizationScopes (and its snake_case
  // predecessor) before any API could write to them — nothing to copy.
  'organizationScopes',
  'organization_scopes',
  'scopeUsers',
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

  // Preserve documents from the temporary templates collection, then retire it.
  const skillsCollection = targetDb.collection('skills');
  if (!(await skillsCollection.exists())) {
    await skillsCollection.create();
  }
  for (const legacyName of ['templates']) {
    const legacyCollection = targetDb.collection(legacyName);
    if (!(await legacyCollection.exists())) continue;
    await targetDb.query(
      `
        FOR doc IN @@legacy
          INSERT doc INTO skills OPTIONS { overwriteMode: "ignore" }
      `,
      { '@legacy': legacyName },
    );
    await legacyCollection.drop();
    console.log(`Copied ${legacyName} -> skills and dropped ${legacyName}`);
  }

  // agentSkills is a pure relation collection. It deliberately has no
  // embedding field, so it is created outside the generic node backfill.
  const agentSkillsCollection = targetDb.collection('agentSkills');
  if (!(await agentSkillsCollection.exists())) {
    await agentSkillsCollection.create();
  }
  await agentSkillsCollection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'skillKey'], unique: true });
  await agentSkillsCollection.ensureIndex({ type: 'persistent', fields: ['agentKey'], unique: false });
  await agentSkillsCollection.ensureIndex({ type: 'persistent', fields: ['skillKey'], unique: false });
  await agentSkillsCollection.ensureIndex({ type: 'persistent', fields: ['agentKey', 'priority'], unique: false });

  // Persisted tool catalogs and grants are retired. These collections contain
  // configuration only; audit records remain in agent run and event collections.
  for (const name of ['agentTools', 'toolActions', 'tools']) {
    const collection = targetDb.collection(name);
    if (await collection.exists()) {
      await collection.drop();
      console.log(`Dropped retired ${name} collection`);
    }
  }
  const agentRunCallsCollection = targetDb.collection('agentRunCalls');
  if (await agentRunCallsCollection.exists()) {
    for (const index of await agentRunCallsCollection.indexes()) {
      const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
      if (fields.length === 1 && fields[0] === 'toolKey') await agentRunCallsCollection.dropIndex(index.id);
    }
  }

  // Agents are registry-only: the agent document's own scopeKey declares its
  // home scope and no scope-assignment linking collection is maintained. A
  // legacy scopeAgents collection may still exist in older databases; it is
  // deliberately left untouched (never read, never written).

  // Existing skills predate the separate competence-area name. Preserve
  // their title as the initial name before the stricter schema is read.
  await targetDb.query(`
    FOR skill IN skills
      FILTER !HAS(skill, "name") || skill.name == null || skill.name == ""
      UPDATE skill WITH { name: skill.title } IN skills
  `);

  // AI framework collections: creation + read-path indexes are owned by
  // their ensure* modules. Runs BEFORE the `collections` loop so the
  // generic embedding backfill below sees them fully set up.
  // Normalize the previous scope shape before creating unique indexes.
  const scopesCollection = targetDb.collection('scopes');
  if (!(await scopesCollection.exists())) {
    await scopesCollection.create();
  }
  await targetDb.query(`
    FOR scope IN scopes
      UPDATE scope WITH {
        organizationKey: scope.organizationKey != null ? scope.organizationKey : scope.organizationId,
        slug: scope.slug != null && scope.slug != "" ? scope.slug : scope._key,
        position: HAS(scope, "position") && IS_NUMBER(scope.position) && scope.position > 0 ? scope.position : 1,
        level: HAS(scope, "level") && IS_NUMBER(scope.level) && scope.level > 0 ? scope.level : 1,
        organizationId: null,
        createdAt: null,
        updatedAt: null
      } IN scopes OPTIONS { keepNull: false }
  `);
  await targetDb.query(`
    FOR scope IN scopes
      FILTER !HAS(scope, "deletedAt")
      UPDATE scope WITH { deletedAt: null } IN scopes
  `);
  await ensureScopesCollection(targetDb);
  const scopeScopesCollection = targetDb.collection('scopeScopes');
  if (!(await scopeScopesCollection.exists())) await scopeScopesCollection.create();
  for (const index of await scopeScopesCollection.indexes()) {
    const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
    if (fields.includes('parentScopeKey') || fields.includes('childScopeKey') || fields.includes('position')) {
      await scopeScopesCollection.dropIndex(index.id);
      console.log(`Dropped legacy scopeScopes index ${index.id}(${fields.join(', ')})`);
    }
  }
  await targetDb.query(`
    FOR relation IN scopeScopes
      UPDATE relation WITH {
        parentKey: HAS(relation, "parentKey") && relation.parentKey != null ? relation.parentKey : relation.parentScopeKey,
        childKey: HAS(relation, "childKey") && relation.childKey != null ? relation.childKey : relation.childScopeKey,
        parentScopeKey: null,
        childScopeKey: null,
        position: null,
        level: HAS(relation, "level") && IS_NUMBER(relation.level) && relation.level > 0 ? relation.level : 1
      } IN scopeScopes OPTIONS { keepNull: false }
  `);
  await targetDb.query(`
    FOR relation IN scopeScopes
      FILTER !HAS(relation, "parentKey") || relation.parentKey == null
        || !HAS(relation, "childKey") || relation.childKey == null
      REMOVE relation IN scopeScopes
  `);
  await targetDb.query(`
    FOR relation IN scopeScopes
      FILTER !HAS(relation, "deletedAt")
      UPDATE relation WITH { deletedAt: null } IN scopeScopes
  `);
  await ensureScopeScopesCollection(targetDb);
  await ensureScopeMembersCollection(targetDb);
  await targetDb.query(`FOR member IN scopeMembers FILTER !HAS(member, "status") UPDATE member WITH { status: "active" } IN scopeMembers`);

  // Migrate the former DAG links into a strict tree. Legacy keys were not
  // domain CUIDs, so each copied relation receives a fresh key.
  const legacyScopeChildren = targetDb.collection('scopeChildren');
  if (await legacyScopeChildren.exists()) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR relation IN scopeChildren
        SORT relation.parentScopeId ASC, relation.childScopeId ASC
        RETURN relation
    `);
    const relations = await cursor.all();
    const existingCursor = await targetDb.query<Record<string, unknown>>(`
      FOR relation IN scopeScopes
        RETURN relation
    `);
    const existingRelations = await existingCursor.all();
    const seenChildren = new Set<string>();
    const childrenByParent = new Map<string, Set<string>>();
    for (const relation of existingRelations) {
      const parentKey = nonEmptyString(relation.parentKey);
      const childKey = nonEmptyString(relation.childKey);
      if (!parentKey || !childKey) continue;
      seenChildren.add(childKey);
      const children = childrenByParent.get(parentKey) ?? new Set<string>();
      children.add(childKey);
      childrenByParent.set(parentKey, children);
    }
    const createsCycle = (parentKey: string, childKey: string) => {
      const pending = [childKey];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const current = pending.shift()!;
        if (current === parentKey) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(childrenByParent.get(current) ?? []));
      }
      return false;
    };
    for (const relation of relations) {
      const parentKey = nonEmptyString(relation.parentKey) ?? nonEmptyString(relation.parentScopeKey) ?? nonEmptyString(relation.parentScopeId);
      const childKey = nonEmptyString(relation.childKey) ?? nonEmptyString(relation.childScopeKey) ?? nonEmptyString(relation.childScopeId);
      if (
        !parentKey
        || !childKey
        || parentKey === childKey
        || seenChildren.has(childKey)
        || createsCycle(parentKey, childKey)
      ) continue;
      await targetDb.collection('scopeScopes').save({
        _key: newId(),
        parentKey,
        childKey,
        level: 1,
        deletedAt: null,
      });
      seenChildren.add(childKey);
      const children = childrenByParent.get(parentKey) ?? new Set<string>();
      children.add(childKey);
      childrenByParent.set(parentKey, children);
    }
    await legacyScopeChildren.drop();
    console.log(`Copied ${seenChildren.size} scopeChildren relations -> scopeScopes and dropped scopeChildren`);
  }
  // Providers written before the display-name field existed: stamp the
  // static PROVIDER_NAMES text (the embedded field — ids are never embed
  // text) so the embedding backfill below has something to embed.
  for (const spec of collections) {
    const collection = targetDb.collection(spec.name);
    const exists = await collection.exists();
    if (!exists) {
      await collection.create();
      console.log(`Created collection ${spec.name}`);
    }
    if (spec.archive) {
      await targetDb.query(
        `FOR doc IN @@collection FILTER !HAS(doc, "deletedAt") UPDATE doc WITH { deletedAt: null } IN @@collection`,
        { '@collection': spec.name },
      );
    }
    if (spec.name === 'actions') {
      await targetDb.query(`
        FOR doc IN actions
          UPDATE doc WITH { createdAt: null, updatedAt: null }
          IN actions OPTIONS { keepNull: false }
      `);
    }
    if (spec.name === 'providers') {
      await targetDb.query(`
        FOR doc IN providers
          UPDATE doc WITH {
            description: null,
            supportedUseCases: null,
            enabled: null
          } IN providers OPTIONS { keepNull: false }
      `);
    }
    if (spec.name === 'skills') {
      // Normalize the retired orchestrator-owned shape before the new
      // indexes and embeddings are created. The key is a stable slug fallback
      // for any legacy document that predates the slug field.
      await targetDb.query(`
        FOR doc IN skills
          UPDATE doc WITH {
            slug: doc.slug != null && doc.slug != "" ? doc.slug : doc._key,
            name: doc.name != null && doc.name != "" ? doc.name : doc._key,
            title: doc.title != null && doc.title != "" ? doc.title : (doc.role != null ? doc.role : doc._key),
            definition: doc.definition != null ? doc.definition : (doc.skill != null ? doc.skill : (doc.role != null ? doc.role : "")),
            skill: null,
            enabled: null,
            orchestratorId: null,
            role: null,
            model: null,
            storagePath: null,
            createdAt: null,
            updatedAt: null
          } IN skills OPTIONS { keepNull: false }
      `);
    }
    if (spec.name === 'agents') {
      await targetDb.query(`
        FOR doc IN agents
          UPDATE doc WITH {
            slug: doc.slug != null && doc.slug != "" ? doc.slug : doc._key,
            name: doc.name != null && doc.name != "" ? doc.name : doc._key,
            title: doc.title != null && doc.title != "" ? doc.title : (doc.role != null ? doc.role : doc._key),
            scopeKey: doc.scopeKey != null && doc.scopeKey != "" ? doc.scopeKey : (doc.orchestratorId != null ? doc.orchestratorId : doc._key),
            explorationRate: HAS(doc, "explorationRate") && doc.explorationRate >= 0 && doc.explorationRate <= 1 ? doc.explorationRate : 0.5,
            enabled: null,
            orchestratorId: null,
            role: null,
            model: null,
            storagePath: null,
            createdAt: null,
            updatedAt: null
          } IN agents OPTIONS { keepNull: false }
      `);
    }
    if (spec.name === 'documents') {
      const cursor = await targetDb.query<number>(`
        RETURN LENGTH(
          FOR document IN documents
            FILTER !HAS(document, "scopeKey")
              || !HAS(document, "folderKey")
              || !HAS(document, "storageKey")
              || !HAS(document, "sizeBytes")
              || !HAS(document, "html")
              || !HAS(document, "json")
              || !HAS(document, "content")
              || !HAS(document, "embedding")
            RETURN 1
        )
      `);
      const incompatibleDocuments = await cursor.next() ?? 0;
      if (incompatibleDocuments > 0) {
        throw new Error(`Cannot migrate documents: ${incompatibleDocuments} existing row(s) lack required Archive ingestion fields.`);
      }
    }
    if (spec.name === 'documentVersions') {
      await migrateArchiveVersions(targetDb);
    }
    if (spec.name === 'documentShares') {
      await migrateArchiveShares(targetDb);
    }
    const legacyIndexes = LEGACY_INDEX_FIELDS[spec.name] ?? [];
    if (legacyIndexes.length > 0) {
      const existingIndexes = await collection.indexes();
      for (const index of existingIndexes) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (isLegacyIndex(spec.name, fields, (spec.indexes ?? []).map((desired) => desired.fields))) {
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
  }

  // Existing users predate country tracking. Sweden is the historical fallback;
  // new web signups provide their detected code.
  await targetDb.query(`
    FOR user IN users
      FILTER !HAS(user, "countryCode") || user.countryCode == null || user.countryCode == ""
      UPDATE user WITH { countryCode: "SE" } IN users
  `);

  // Every pre-relation agent is linked to its existing home scope. Existing
  // scope memberships become inherited grants, preserving current access
  // while making the new runtime checks authoritative on the next deploy.
  const hierarchyCursor = await targetDb.query<{ parentKey: string; childKey: string }>('FOR relation IN scopeScopes FILTER relation.deletedAt == null RETURN { parentKey: relation.parentKey, childKey: relation.childKey }');
  const parentByChild = new Map((await hierarchyCursor.all()).map((relation) => [relation.childKey, relation.parentKey]));
  const agentsWithoutRelations = await targetDb.query<{ agentKey: string; scopeKey: string; organizationKey: string }>(`
    FOR agent IN agents
      LET scope = FIRST(FOR candidate IN scopes FILTER candidate._key == agent.scopeKey RETURN candidate)
      FILTER scope != null
      FILTER LENGTH(FOR link IN scopeAgents FILTER link.scopeKey == scope._key && link.agentKey == agent._key LIMIT 1 RETURN 1) == 0
      RETURN { agentKey: agent._key, scopeKey: scope._key, organizationKey: scope.organizationKey }
  `);
  for (const agent of await agentsWithoutRelations.all()) {
    const timestamp = new Date().toISOString();
    const scopeAgentKey = newId();
    await targetDb.collection('scopeAgents').save({ _key: scopeAgentKey, ...agent, position: 1, status: 'active', minimumAccessRole: 'viewer', createdByUserOrganizationKey: null, createdAt: timestamp, updatedAt: timestamp, embedding: [] });
    const ancestorKeys = [agent.scopeKey]; let parentKey = parentByChild.get(agent.scopeKey);
    while (parentKey && !ancestorKeys.includes(parentKey)) { ancestorKeys.push(parentKey); parentKey = parentByChild.get(parentKey); }
    const members = await targetDb.query<{ userOrganizationKey: string }>(`
      FOR membership IN userOrganizations
        FILTER membership.organizationId == @organizationKey && membership.status == "active"
        LET elevated = membership.orgRole == "owner" || membership.orgRole == "admin"
        LET scoped = LENGTH(FOR member IN scopeMembers FILTER member.userOrganizationKey == membership._key && member.scopeKey IN @ancestorKeys && member.status == "active" LIMIT 1 RETURN 1) > 0
        FILTER elevated || scoped
        RETURN { userOrganizationKey: membership._key }
    `, { organizationKey: agent.organizationKey, ancestorKeys });
    for (const member of await members.all()) await targetDb.collection('agentMembers').save({ _key: newId(), organizationKey: agent.organizationKey, scopeKey: agent.scopeKey, agentKey: agent.agentKey, scopeAgentKey, userOrganizationKey: member.userOrganizationKey, source: 'inherited', createdByUserOrganizationKey: null, createdAt: timestamp, embedding: [] });
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

  // Resolve legacy provider links to the full organization-provider node.
  // Invalid legacy references abort the migration rather than creating an
  // orphaned credential authorization target.
  const organizationProviders = targetDb.collection('organizationProviders');
  if (!(await organizationProviders.exists())) await organizationProviders.create();
  const organizationProviderCursor = await targetDb.query<Record<string, unknown>>(`
    FOR link IN organizationProviders
      RETURN link
  `);
  for (const legacyLink of await organizationProviderCursor.all()) {
    const legacyKey = nonEmptyString(legacyLink._key);
    const organizationKey = nonEmptyString(legacyLink.organizationKey)
      ?? nonEmptyString(legacyLink.organizationId);
    let providerKey = nonEmptyString(legacyLink.providerKey);
    let providerName = nonEmptyString(legacyLink.name);
    if (!providerKey) {
      const providerSlug = nonEmptyString(legacyLink.providerId);
      if (providerSlug) {
        const providerCursor = await targetDb.query<{ _key: string; name: string }>(`
          FOR provider IN providers
            FILTER provider.slug == @providerSlug
            LIMIT 1
            RETURN { _key: provider._key, name: provider.name }
        `, { providerSlug });
        const provider = await providerCursor.next();
        providerKey = provider?._key ?? null;
        providerName ??= provider?.name ?? null;
      }
    }
    if (providerKey && !providerName) {
      const providerCursor = await targetDb.query<{ name: string }>(`
        FOR provider IN providers
          FILTER provider._key == @providerKey
          LIMIT 1
          RETURN { name: provider.name }
      `, { providerKey });
      providerName = (await providerCursor.next())?.name ?? null;
    }
    if (!legacyKey || !organizationKey || !providerKey || !providerName) {
      throw new Error(`Cannot migrate organizationProviders/${legacyKey ?? 'unknown'}: unresolved organization or provider reference`);
    }
    const key = organizationProviderSchema.shape.key.safeParse(legacyKey).success ? legacyKey : newId();
    const timestamp = new Date().toISOString();
    const migrated = organizationProviderSchema.parse({
      key,
      organizationKey,
      providerKey,
      name: providerName,
      description: nonEmptyString(legacyLink.description),
      inputTokens: typeof legacyLink.inputTokens === 'number' && legacyLink.inputTokens >= 0 ? legacyLink.inputTokens : 0,
      outputTokens: typeof legacyLink.outputTokens === 'number' && legacyLink.outputTokens >= 0 ? legacyLink.outputTokens : 0,
      totalTokens: typeof legacyLink.totalTokens === 'number' && legacyLink.totalTokens >= 0 ? legacyLink.totalTokens : 0,
      lastUsedAt: nonEmptyString(legacyLink.lastUsedAt),
      createdAt: nonEmptyString(legacyLink.createdAt) ?? timestamp,
      updatedAt: nonEmptyString(legacyLink.updatedAt) ?? timestamp,
      embedding: [],
    });
    const { key: _migratedKey, ...migratedDocument } = migrated;
    if (key === legacyKey) {
      await organizationProviders.replace(legacyKey, { _key: key, ...migratedDocument });
    } else {
      await organizationProviders.save({ _key: key, ...migratedDocument });
      await organizationProviders.remove(legacyKey);
    }
  }
  for (const index of await organizationProviders.indexes()) {
    const fields: string[] = 'fields' in index && Array.isArray(index.fields)
      ? index.fields.map(String)
      : [];
    if (fields.includes('organizationId') || fields.includes('providerId')) {
      await organizationProviders.dropIndex(index.id);
    }
  }
  await ensureOrganizationProvidersCollection(targetDb);
  await ensureOrganizationCredentialsCollection(targetDb);

  // The call-level ledger cannot safely infer DB keys or provider-reported
  // usage for runs written with the retired slug-based shape. Preserve
  // those documents verbatim for audit/history, but keep the live
  // collection strict so every current run satisfies agentRunSchema.
  const agentRuns = targetDb.collection('agentRuns');
  if (await agentRuns.exists()) {
    const legacyAgentRuns = targetDb.collection('agentRunsLegacy');
    if (!(await legacyAgentRuns.exists())) await legacyAgentRuns.create();
    const legacyFilter = 'doc.organizationKey == null || doc.scopeKey == null || doc.agentKey == null || HAS(doc, "steps") || HAS(doc, "calls") || doc.reason == null || doc.score == null || doc.startedAt == null || doc.endedAt == null || doc.elapsedMs == null';
    await targetDb.query(`
      FOR doc IN agentRuns
        FILTER ${legacyFilter}
        INSERT doc INTO agentRunsLegacy OPTIONS { overwriteMode: "ignore" }
    `);
    await targetDb.query(`
      FOR doc IN agentRuns
        FILTER ${legacyFilter}
        REMOVE doc IN agentRuns
    `);
  }
  await ensureAgentRunsCollection(targetDb);
  await targetDb.query(`
    FOR run IN agentRuns
      FILTER !HAS(run, "principalType") || !HAS(run, "userOrganizationKey")
      UPDATE run WITH {
        principalType: HAS(run, "principalType") ? run.principalType : "system",
        userOrganizationKey: HAS(run, "userOrganizationKey") ? run.userOrganizationKey : null
      } IN agentRuns
  `);
  await ensureAgentRunStepsCollection(targetDb);
  await ensureAgentRunCallsCollection(targetDb);
  const agentArtifacts = targetDb.collection('agentArtifacts');
  if (await agentArtifacts.exists()) {
    const legacyAgentArtifacts = targetDb.collection('agentArtifactsLegacy');
    if (!(await legacyAgentArtifacts.exists())) await legacyAgentArtifacts.create();
    await targetDb.query(`
      FOR doc IN agentArtifacts
        FILTER HAS(doc, "artifactKey") || !HAS(doc, "nodeType") || !HAS(doc, "nodeKey")
        INSERT doc INTO agentArtifactsLegacy OPTIONS { overwriteMode: "ignore" }
    `);
    await targetDb.query(`
      FOR doc IN agentArtifacts
        FILTER HAS(doc, "artifactKey") || !HAS(doc, "nodeType") || !HAS(doc, "nodeKey")
        REMOVE doc IN agentArtifacts
    `);
    await targetDb.query(`
      FOR doc IN agentArtifacts
        UPDATE doc WITH {
          groupKey: HAS(doc, "groupKey") ? doc.groupKey : null,
          position: HAS(doc, "position") ? doc.position : 0
        } IN agentArtifacts
    `);
    for (const index of await agentArtifacts.indexes()) {
      const fields: string[] = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
      if (fields.includes('artifactKey')) await agentArtifacts.dropIndex(index.id);
    }
  }
  await ensureAgentArtifactsCollection(targetDb);
  await ensureArtifactCollections(targetDb);
  await ensureAgentRunSourcesCollection(targetDb);
  await ensureAgentArtifactChecksCollection(targetDb);
  await ensureRuntimeVariablesCollection(targetDb);
  await ensureAgentMemoriesCollection(targetDb);


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
          slug: null,
          description: null,
          isActive: true,
          // mfa_enabled is THE source of truth for MFA enforcement; the
          // root organization always enforces it.
          mfa_enabled: isRoot || platform.mfa_enabled === true,
          metadata: platform.metadata && typeof platform.metadata === 'object' ? platform.metadata : {},
          createdAt: nonEmptyString(platform.createdAt) ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          embedding: await generateEmbedding(['_organizations', key, name].join(':')),
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
      slug: null,
      description: null,
      isActive: true,
      mfa_enabled: true,
      metadata: {},
      createdAt: now,
      updatedAt: now,
      embedding: await generateEmbedding(['_organizations', rootOrganizationId, 'Vorinthex AI'].join(':')),
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

  // Production deploys run this migration rather than db:seed. Apply the
  // canonical scope seed here as well so Nexus and every direct child exist
  // with the same fixed CUID references and exact descriptions.
  const existingScopesCursor = await targetDb.query<{
    _key: string;
    summary?: string;
    description?: string;
  }>(`
    FOR scope IN scopes
      RETURN {
        _key: scope._key,
        summary: scope.summary,
        description: scope.description
      }
  `);
  for (const scope of await existingScopesCursor.all()) {
    const summary = scope.summary?.trim() || scope.description?.trim();
    if (!summary) continue;
    await targetDb.collection('scopes').update(scope._key, {
      summary,
    });
  }

  const actualScopeKeys = new Map<string, string>();
  for (const seed of SEEDED_SCOPES) {
    const existingCursor = await targetDb.query<{ _key: string }>(
      `
        FOR scope IN scopes
          FILTER (scope.organizationKey == @organizationKey && scope.slug == @slug) || scope._key == @scopeKey
          SORT scope.organizationKey == @organizationKey && scope.slug == @slug DESC
          LIMIT 1
          RETURN { _key: scope._key }
      `,
      { organizationKey: rootOrganizationId, slug: seed.slug, scopeKey: seed.key },
    );
    const existing = await existingCursor.next();
    const scopeKey = existing?._key ?? seed.key;
    if (existing) {
      await targetDb.collection('scopes').update(scopeKey, {
        organizationKey: rootOrganizationId,
        slug: seed.slug,
        name: seed.name,
        summary: seed.summary,
        description: seed.description,
        position: seed.position,
        deletedAt: null,
      });
    } else {
      const embedding = await generateEmbedding(buildEmbeddingText(['summary'], seed)!);
      await targetDb.collection('scopes').save({
        _key: scopeKey,
        organizationKey: rootOrganizationId,
        slug: seed.slug,
        name: seed.name,
        summary: seed.summary,
        description: seed.description,
        position: seed.position,
        deletedAt: null,
        embedding,
      });
    }
    actualScopeKeys.set(seed.key, scopeKey);
  }
  const nexusScopeId = actualScopeKeys.get(NEXUS_SCOPE_KEY);
  if (!nexusScopeId) throw new Error('Cannot resolve canonical Nexus scope');

  for (const seed of SEEDED_SCOPES.filter((scope) => scope.parentKey !== null)) {
    const parentKey = actualScopeKeys.get(seed.parentKey!);
    const childKey = actualScopeKeys.get(seed.key);
    if (!parentKey || !childKey) throw new Error(`Cannot resolve seeded scope relation for ${seed.slug}`);
    const relationCursor = await targetDb.query<{ _key: string; parentKey: string }>(
      `
        FOR relation IN scopeScopes
          FILTER relation.childKey == @childKey
          LIMIT 1
          RETURN { _key: relation._key, parentKey: relation.parentKey }
      `,
      { childKey },
    );
    const relation = await relationCursor.next();
    if (relation?.parentKey === parentKey) {
      await targetDb.collection('scopeScopes').update(relation._key, { level: seed.level });
      continue;
    }
    if (relation) await targetDb.collection('scopeScopes').remove(relation._key);
    await targetDb.collection('scopeScopes').save({
      _key: newId(),
      parentKey,
      childKey,
      level: seed.level,
      deletedAt: null,
    });
  }
  const scopeHierarchyCursor = await targetDb.query<{ parentKey: string; childKey: string }>(`
    FOR relation IN scopeScopes
      FILTER relation.deletedAt == null
      RETURN { parentKey: relation.parentKey, childKey: relation.childKey }
  `);
  const hierarchyParentByChild = new Map<string, string>();
  for (const relation of await scopeHierarchyCursor.all()) {
    hierarchyParentByChild.set(relation.childKey, relation.parentKey);
  }
  const scopeLevel = (scopeKey: string): number => {
    let level = 1;
    let parentKey = hierarchyParentByChild.get(scopeKey);
    const visited = new Set<string>([scopeKey]);
    while (parentKey && !visited.has(parentKey)) {
      visited.add(parentKey);
      level += 1;
      parentKey = hierarchyParentByChild.get(parentKey);
    }
    return level;
  };
  const scopeKeysCursor = await targetDb.query<{ _key: string }>('FOR scope IN scopes RETURN { _key: scope._key }');
  for (const scope of await scopeKeysCursor.all()) {
    await targetDb.collection('scopes').update(scope._key, { level: scopeLevel(scope._key) });
  }
  await targetDb.query(`
    FOR relation IN scopeScopes
      LET child = DOCUMENT("scopes", relation.childKey)
      UPDATE relation WITH { level: child == null ? 1 : child.level } IN scopeScopes
  `);
  console.log('Seeded canonical Nexus scope hierarchy');

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
          slug: nonEmptyString(team.slug),
          description: nonEmptyString(team.description),
          isActive: team.isActive !== false,
          mfa_enabled: team.mfa_enabled === true,
          metadata: {},
          createdAt: nonEmptyString(team.createdAt) ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          embedding: embedText ? await generateEmbedding(embedText) : [],
        },
        { overwriteMode: 'ignore' },
      );
    }
    if (legacyTeams.length > 0) {
      console.log(`Copied ${legacyTeams.length} teams -> organizations`);
    }
  }

  // Organization ownership is represented exclusively by userOrganizations
  // with orgRole "owner". Remove the denormalized legacy field from every
  // existing organization, including production documents from older seeds.
  await targetDb.query(`
    FOR organization IN organizations
      FILTER HAS(organization, "ownerId")
      UPDATE organization WITH { ownerId: null } IN organizations OPTIONS { keepNull: false }
  `);

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

  const membersCollection = targetDb.collection('members');
  if (await membersCollection.exists()) {
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
      const eventEmbedText = buildNodeEmbedText('events', key, ['slug'], { slug });
      await eventsCollection.save({
        _key: key,
        scopeId: nexusScopeId,
        userId: user._key,
        slug,
        data: {
          distinctId: typeof event.distinctId === 'string' ? event.distinctId : null,
          payload: event.payload && typeof event.payload === 'object' ? event.payload : {},
        },
        createdAt,
        embedding: eventEmbedText ? await generateEmbedding(eventEmbedText) : [],
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
      const eventEmbedText = buildNodeEmbedText('events', key, ['slug'], { slug });
      await eventsCollection.save(
        {
          _key: key,
          scopeId: nexusScopeId,
          userId: event.userId,
          slug,
          data: event.data && typeof event.data === 'object' ? event.data : {},
          createdAt: typeof event.createdAt === 'string' ? event.createdAt : new Date().toISOString(),
          embedding: eventEmbedText ? await generateEmbedding(eventEmbedText) : [],
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
    userId?: string;
    entityId?: string;
    belongsTo?: string;
    data?: Record<string, unknown> | null;
  }>(`
    FOR event IN events
      FILTER HAS(event, "entityId")
        || HAS(event, "entityType")
      RETURN {
        _key: event._key,
        slug: event.slug,
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
    const eventEmbedText = typeof event.slug === 'string' && event.slug.length > 0
      ? buildNodeEmbedText('events', event._key, ['slug'], { slug: event.slug })
      : null;
    const embedding = eventEmbedText ? await generateEmbedding(eventEmbedText) : [];
    await eventsCollection.update(event._key, {
      scopeId: nexusScopeId,
      sourceId: null,
      belongsTo: null,
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
        || !HAS(u, "refreshTokenExpiresAt")
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
        refreshTokenExpiresAt: HAS(u, "refreshTokenExpiresAt") ? u.refreshTokenExpiresAt : null,
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

  // Every historical event now belongs directly to Nexus. Drain the cursor
  // before per-row embedding work, and only touch legacy rows on reruns.
  const scopeEventsCursor = await targetDb.query<{ _key: string; slug?: string }>(`
    FOR event IN events
      FILTER !HAS(event, "scopeId")
        || event.scopeId != @nexusScopeId
        || HAS(event, "sourceId")
        || HAS(event, "belongsTo")
        || HAS(event, "entityId")
        || HAS(event, "entityType")
      RETURN { _key: event._key, slug: event.slug }
  `, { nexusScopeId });
  const scopeEvents = await scopeEventsCursor.all();
  if (scopeEvents.length > 0) {
    console.log(`Migrating ${scopeEvents.length} events to Nexus scope ${nexusScopeId}`);
  }
  for (const event of scopeEvents) {
    const eventEmbedText = typeof event.slug === 'string' && event.slug.length > 0
      ? buildNodeEmbedText('events', event._key, ['slug'], { slug: event.slug })
      : null;
    await eventsCollection.update(event._key, {
      scopeId: nexusScopeId,
      sourceId: null,
      belongsTo: null,
      entityId: null,
      entityType: null,
      embedding: eventEmbedText ? await generateEmbedding(eventEmbedText) : [],
    }, { keepNull: false });
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

  // Invitations are no longer part of organization membership. Strip the
  // retired field from every live document so the production database and
  // the Zod schema converge during the next deploy.
  await targetDb.query(`
    FOR membership IN userOrganizations
      FILTER HAS(membership, "invitedByUserId")
      UPDATE membership WITH { invitedByUserId: null }
        IN userOrganizations
        OPTIONS { keepNull: false }
  `);

  // Normalize the public founder aliases and guarantee that every active
  // root-organization member can enter Nexus. Owners already inherit all
  // scopes, but an explicit Nexus membership gives non-owner founders the
  // same reliable starting point and keeps access independent of UI logic.
  await targetDb.query(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @rootOrganizationId
      FILTER !HAS(membership, "status") || membership.status == "active"
      FOR user IN users
        FILTER user._key == membership.userId
        LET email = LOWER(user.email)
        LET founderAlias =
          email == "oscar@vorinthex.com" ? "Atlas" :
          email == "josef@vorinthex.com" ? "Orbit" :
          email == "frank@vorinthex.com" ? "Mercury" :
          email == "vincent@vorinthex.com" ? "Iris" :
          email == "anton@vorinthex.com" ? "Apollo" : null
        FILTER founderAlias != null
        UPDATE user WITH { alias: founderAlias, updatedAt: DATE_ISO8601(DATE_NOW()) } IN users
  `, { rootOrganizationId });

  // Founder memberships may enter their assigned command deck directly. The
  // link remains optional for every other organization member.
  await targetDb.query(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @rootOrganizationId
      FILTER !HAS(membership, "status") || membership.status == "active"
      FOR user IN users
        FILTER user._key == membership.userId
        LET email = LOWER(user.email)
        LET orchestratorName =
          email == "oscar@vorinthex.com" ? "Atlas" :
          email == "josef@vorinthex.com" ? "Orbit" :
          email == "frank@vorinthex.com" ? "Mercury" :
          email == "vincent@vorinthex.com" ? "Iris" :
          email == "anton@vorinthex.com" ? "Apollo" : null
        FILTER orchestratorName != null
        LET orchestrator = FIRST(
          FOR candidate IN orchestrators
            FILTER candidate.name == orchestratorName
            LIMIT 1
            RETURN candidate
        )
        FILTER orchestrator != null
        UPDATE membership WITH {
          orchestratorKey: orchestrator._key,
          updatedAt: DATE_ISO8601(DATE_NOW())
        } IN userOrganizations
  `, { rootOrganizationId });

  const rootMembershipCursor = await targetDb.query<{ key: string; orgRole: string }>(`
    FOR membership IN userOrganizations
      FILTER membership.organizationId == @rootOrganizationId
      FILTER !HAS(membership, "status") || membership.status == "active"
      RETURN { key: membership._key, orgRole: membership.orgRole }
  `, { rootOrganizationId });
  for (const membership of await rootMembershipCursor.all()) {
    const existingCursor = await targetDb.query<{ key: string }>(`
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey
        FILTER scopeMember.userOrganizationKey == @membershipKey
        LIMIT 1
        RETURN { key: scopeMember._key }
    `, { scopeKey: nexusScopeId, membershipKey: membership.key });
    if (await existingCursor.next()) continue;
    await targetDb.collection('scopeMembers').save({
      _key: newId(),
      scopeKey: nexusScopeId,
      userOrganizationKey: membership.key,
      role: membership.orgRole === 'owner' || membership.orgRole === 'admin' ? membership.orgRole : 'viewer',
    });
  }
  console.log('Normalized founder aliases, orchestrator links, and Nexus access');

  await seedNexusOrganizationArtifact(targetDb, rootOrganizationId, nexusScopeId);
  console.log('Seeded the Nexus spatial organization artifact');

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

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
