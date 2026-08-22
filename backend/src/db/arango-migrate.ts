import 'dotenv/config';
import { Database } from 'arangojs';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER_ID, LEGACY_EMBEDDING_DIMENSIONS, embedText, embedTexts, embeddingMetadata } from '../lib/embeddings';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '../lib/alias';
import { newId } from '../lib/ids';
import { ensureOrganizationProvidersCollection } from '../lib/ai/organization-providers/indexes';
import { ensureOrganizationCredentialsCollection } from '../lib/ai/organization-credentials/indexes';
import { ensureOrganizationConnectorsCollection } from '../lib/email-inbox/indexes';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from '../lib/ai/scopes/indexes';
import { reconcileOrganizationScopeMemberships } from '../lib/ai/scopes/membership-invariant';
import { actionIdSchema, type ActionId } from '../lib/ai/actions/types';
import { organizationProviderSchema } from '../lib/ai/organization-providers/schema';
import { buildEmbeddingText } from '../lib/db/base';
import { NEXUS_SCOPE_KEY, SEEDED_SCOPES } from '../lib/db/seed';
import { isLegacyIndex, LEGACY_REMOVAL_MARKER } from './arango-migrate-indexes';
import { stageLegacyDocumentShares } from './content-migration';
import { htmlToPlainText } from '../lib/ai/document-processing/representation';
import { chunkDocumentContent, chunkDocumentText, documentEmbeddingTexts, documentSemanticHash } from '../lib/ai/document-processing/chunking';
import { z } from 'zod';
import { withDatabaseTransaction } from '../lib/db/client';
import { countryCodeSchema } from '../lib/db/users.node';
import { retireAiPersistence } from './retire-ai-persistence';
import { buildPlaceEmbeddingText, buildTripEmbeddingText, TRIP_EMBEDDING_CONTENT_VERSION } from '../lib/travel/semantic-text';
import { generatedPlaceDetailSchema } from '../lib/db/places.node';
import { buildImageEmbeddingText } from '../lib/image-embedding';

const url = process.env.ARANGO_URL ?? 'http://127.0.0.1:8529';
const databaseName = process.env.ARANGO_DATABASE ?? 'vorinthex';
const username = process.env.ARANGO_USERNAME ?? 'root';
const password = process.env.ARANGO_ROOT_PASSWORD ?? '';
export interface CollectionSpec {
  name: string;
  indexes?: Array<{ fields: string[]; unique?: boolean; sparse?: boolean }>;
  embedKeys?: string[];
  skipEmbedding?: boolean;
}

export async function migrateImageCaptions(targetDb: Database): Promise<void> {
  const invalid = await targetDb.query<number>(`
    RETURN LENGTH(
      FOR image IN images
        FILTER !IS_STRING(image.caption) || LENGTH(TRIM(image.caption)) == 0
        RETURN 1
    )
  `);
  if ((await invalid.next() ?? 0) > 0) throw new Error('Image caption migration found images with invalid legacy captions.');

  const conflicts = await targetDb.query<number>(`
    RETURN LENGTH(
      FOR image IN images
        FILTER image.imageCaptionKey == null
        LET caption = DOCUMENT(imageCaptions, image._key)
        FILTER caption != null
        FILTER caption.scopeKey != image.scopeKey
          || caption.sourceImageKey != image._key
          || caption.caption != image.caption
        RETURN 1
    )
  `);
  if ((await conflicts.next() ?? 0) > 0) throw new Error('Image caption migration found conflicting canonical records.');

  await targetDb.query(`
    FOR image IN images
      FILTER image.imageCaptionKey == null
      INSERT {
        _key: image._key,
        scopeKey: image.scopeKey,
        sourceImageKey: image._key,
        caption: image.caption,
        score: 1,
        scoreVersion: 0,
        embedding: image.embedding,
        perceptualHash: null,
        hashAlgorithm: null,
        hashSegment0: null,
        hashSegment1: null,
        hashSegment2: null,
        hashSegment3: null,
        createdAt: image.createdAt,
        updatedAt: image.updatedAt
      } INTO imageCaptions OPTIONS { overwriteMode: "ignore" }
  `);
  await targetDb.query('FOR caption IN imageCaptions FILTER !HAS(caption, "score") || !HAS(caption, "scoreVersion") UPDATE caption WITH { score: HAS(caption, "score") ? caption.score : 1, scoreVersion: HAS(caption, "scoreVersion") ? caption.scoreVersion : 0 } IN imageCaptions');
  await targetDb.query(`
    FOR image IN images
      FILTER image.imageCaptionKey == null
      UPDATE image WITH { imageCaptionKey: image._key } IN images
  `);
  const missing = await targetDb.query<number>(`
    RETURN LENGTH(
      FOR image IN images
        LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey)
        FILTER caption == null
          || caption.scopeKey != image.scopeKey
          || caption.caption != image.caption
          || !IS_NUMBER(caption.score) || caption.score < 1 || caption.score > 100
        RETURN 1
    )
  `);
  if ((await missing.next() ?? 0) > 0) throw new Error('Image caption migration verification failed.');
}

export async function migrateGenericContentContracts(targetDb: Database): Promise<void> {
  const legacyLedger = targetDb.collection('archiveIdempotency');
  if (await legacyLedger.exists()) {
    const ledger = targetDb.collection('contentIdempotency');
    const ledgerAlreadyExisted = await ledger.exists();
    if (!ledgerAlreadyExisted) await ledger.create();
    const conflicts = await targetDb.query<number>(`
      RETURN LENGTH(
        FOR source IN archiveIdempotency
          LET target = DOCUMENT(contentIdempotency, source._key)
          FILTER target != null
            && UNSET(source, "_id", "_rev") != UNSET(target, "_id", "_rev")
          RETURN 1
      )
    `);
    if ((await conflicts.next() ?? 0) > 0) throw new Error('Content idempotency collection migration found conflicting records.');
    await targetDb.query(`FOR record IN archiveIdempotency INSERT record INTO contentIdempotency OPTIONS { overwriteMode: "ignore" }`);
    const verification = await targetDb.query<number>(`RETURN LENGTH(FOR record IN archiveIdempotency LET migrated = DOCUMENT(contentIdempotency, record._key) FILTER migrated == null || UNSET(record, "_id", "_rev") != UNSET(migrated, "_id", "_rev") RETURN 1)`);
    if ((await verification.next() ?? 0) > 0) throw new Error('Content idempotency collection migration verification failed.');
    // Keep the source through the first cutover so requests already using it can settle.
    if (ledgerAlreadyExisted) await legacyLedger.drop();
  }

  const shares = targetDb.collection('shares');
  if (await shares.exists()) {
    const legacyKey = 'archive-document-shares-cutover';
    const legacy = await shares.document(legacyKey).catch(() => null) as Record<string, unknown> | null;
    if (legacy) {
      const current = await shares.document('content-document-shares-cutover').catch(() => null);
      if (!current) {
        const { _key, _id, _rev, ...state } = legacy;
        const transaction = await targetDb.beginTransaction({ write: ['shares'], exclusive: ['shares'] });
        try {
          await transaction.step(() => shares.remove(legacyKey));
          await transaction.step(() => shares.save({
            ...state,
            _key: 'content-document-shares-cutover',
            kind: 'content-share-cutover',
            tokenHash: new Bun.CryptoHasher('sha256').update('content-document-shares-cutover').digest('hex'),
          }));
          await transaction.commit();
        } catch (error) {
          await transaction.abort();
          throw error;
        }
      } else {
        await shares.remove(legacyKey);
      }
    }
  }
}

export async function retireUserSettings(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('users').exists()) return;
  await targetDb.query('FOR user IN users FILTER HAS(user, "settings") UPDATE user WITH { settings: null } IN users OPTIONS { keepNull: false }');
}

function buildNodeEmbedText(_collectionName: string, _key: string, embedKeys: readonly string[], doc: Record<string, unknown>): string | null {
  return buildEmbeddingText(embedKeys, doc);
}

function generateEmbedding(text: string) {
  if (process.env.CONTENT_E2E === 'true') {
    const dimensions = EMBEDDING_DIMENSIONS;
    const digest = Buffer.from(new Bun.CryptoHasher('sha256').update(text).digest());
    return Promise.resolve(Array.from({ length: dimensions }, (_, index) => digest[index % digest.length]! / 255));
  }
  return embedText({ text });
}

function generateEmbeddings(texts: string[]) {
  if (process.env.CONTENT_E2E === 'true') return Promise.all(texts.map(generateEmbedding));
  return embedTexts({ texts });
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function isCurrentVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === EMBEDDING_DIMENSIONS && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function currentChunkEmbeddings(value: unknown, chunkCount: number): number[][] | null {
  return Array.isArray(value) && value.length === chunkCount && value.every(isCurrentVector) ? value : null;
}

function migrationContentChunks(content: string): string[] | null {
  try { return chunkDocumentContent(content); } catch { return null; }
}

function migrationFallbackChunk(content: string): string {
  const chunk = chunkDocumentText(content.slice(0, 16_000))[0]?.text;
  if (!chunk) throw new Error('Cannot produce a bounded semantic fallback chunk.');
  return chunk;
}

function recoverLegacyHtmlContent(html: string): string {
  try {
    return htmlToPlainText(html);
  } catch {
    return html
      .replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<\/?(?:h[1-6]|p|div|section|blockquote|pre|li|tr|table|ul|ol)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39);/g, (_, entity: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]!)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
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

export async function migrateModelActionSlugs(targetDb: Database): Promise<void> {
  const modelActions = targetDb.collection('modelActions');
  if (!await modelActions.exists()) return;
  for (const index of await modelActions.indexes()) {
    const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
    if (fields.includes('actionKey')) await modelActions.dropIndex(index.id);
  }
  const actions = new Map<string, unknown>();
  if (await targetDb.collection('actions').exists()) {
    const cursor = await targetDb.query<{ key: string; slug: unknown }>('FOR action IN actions RETURN { key: action._key, slug: action.slug }');
    for (const action of await cursor.all()) actions.set(action.key, action.slug);
  }
  const cursor = await targetDb.query<Record<string, unknown>>('FOR relation IN modelActions SORT relation._key RETURN relation');
  const pairs = new Map<string, Array<{ key: string; actionSlug: ActionId; enabled: boolean; priority: number }>>();
  for (const relation of await cursor.all()) {
    const key = nonEmptyString(relation._key);
    const modelKey = nonEmptyString(relation.modelKey);
    const currentSlug = actionIdSchema.safeParse(relation.actionSlug);
    const legacySlug = actionIdSchema.safeParse(actions.get(String(relation.actionKey)));
    const actionSlug = currentSlug.success ? currentSlug.data : legacySlug.success ? legacySlug.data : null;
    const pair = modelKey && actionSlug ? `${modelKey}\0${actionSlug}` : null;
    if (!key || !pair || !actionSlug) {
      if (key) await targetDb.query('REMOVE @key IN modelActions', { key });
      continue;
    }
    const candidates = pairs.get(pair) ?? [];
    candidates.push({ key, actionSlug, enabled: relation.enabled === true, priority: typeof relation.priority === 'number' && Number.isFinite(relation.priority) ? relation.priority : 0 });
    pairs.set(pair, candidates);
  }
  for (const candidates of pairs.values()) {
    candidates.sort((left, right) => Number(right.enabled) - Number(left.enabled) || right.priority - left.priority || left.key.localeCompare(right.key));
    const [winner, ...duplicates] = candidates;
    await targetDb.query('UPDATE @key WITH { actionSlug: @actionSlug, actionKey: null } IN modelActions OPTIONS { keepNull: false }', { key: winner!.key, actionSlug: winner!.actionSlug });
    for (const duplicate of duplicates) await targetDb.query('REMOVE @key IN modelActions', { key: duplicate.key });
  }
}

export async function retireTranscriptionDomain(targetDb: Database): Promise<void> {
  const modelSlugs = ['openai.gpt-4o-mini-transcribe', 'aws.transcribe-standard'];
  const providerSlugs = ['aws-transcribe'];
  await targetDb.query(`
    LET modelKeys = (FOR model IN models FILTER model.slug IN @modelSlugs RETURN model._key)
    FOR relation IN modelActions
      FILTER relation.modelKey IN modelKeys
      REMOVE relation IN modelActions
  `, { modelSlugs });
  await targetDb.query(`
    LET modelKeys = (FOR model IN models FILTER model.slug IN @modelSlugs RETURN model._key)
    LET providerKeys = (FOR provider IN providers FILTER provider.slug IN @providerSlugs RETURN provider._key)
    FOR relation IN modelProviders
      FILTER relation.modelKey IN modelKeys || relation.providerKey IN providerKeys
      REMOVE relation IN modelProviders
  `, { modelSlugs, providerSlugs });
  for (const collection of ['organizationProviders', 'orgCredentials']) {
    await targetDb.query(`
      LET providerKeys = (FOR provider IN providers FILTER provider.slug IN @providerSlugs RETURN provider._key)
      FOR relation IN @@collection
        FILTER relation.providerKey IN providerKeys
        REMOVE relation IN @@collection
    `, { '@collection': collection, providerSlugs });
  }
  await targetDb.query('FOR model IN models FILTER model.slug IN @modelSlugs REMOVE model IN models', { modelSlugs });
  await targetDb.query('FOR provider IN providers FILTER provider.slug IN @providerSlugs REMOVE provider IN providers', { providerSlugs });
}

export async function retireMomentumScope(targetDb: Database, organizationKey: string, archiveScopeKey: string): Promise<void> {
  const retired = await targetDb.query<string>(`
    FOR scope IN scopes
      FILTER scope._key == "cmrnlzf650028qc7k4p5zem5w" || (scope.organizationKey == @organizationKey && scope.slug == "momentum")
      RETURN scope._key
  `, { organizationKey });
  const scopeKeys = await retired.all();
  if (scopeKeys.length === 0) return;
  for (const collection of ['folders', 'tags', 'tagAssignments', 'documents', 'documentVersions', 'documentAudioVersions', 'documentSummaries', 'documentSummaryAudio', 'shares']) {
    await targetDb.query(`
      FOR resource IN @@collection
        FILTER resource.scopeKey IN @scopeKeys
        UPDATE resource WITH { scopeKey: @archiveScopeKey } IN @@collection
    `, { '@collection': collection, scopeKeys, archiveScopeKey });
  }
  await targetDb.query('FOR relation IN scopeScopes FILTER relation.parentKey IN @scopeKeys || relation.childKey IN @scopeKeys REMOVE relation IN scopeScopes', { scopeKeys });
  await targetDb.query('FOR relation IN scopeMembers FILTER relation.scopeKey IN @scopeKeys REMOVE relation IN scopeMembers', { scopeKeys });
  await targetDb.query('FOR scope IN scopes FILTER scope._key IN @scopeKeys REMOVE scope IN scopes', { scopeKeys });
}

export async function migrateContentFavorites(targetDb: Database, collectionName: 'folders' | 'documents' | 'images' | 'collections' | 'emailThreads') {
  await runMigrationTransaction(targetDb, collectionName, `
    FOR resource IN @@collection
      FILTER !IS_BOOL(resource.isFavorite)
      UPDATE resource WITH { isFavorite: false } IN @@collection
  `, { '@collection': collectionName });
  const verification = await targetDb.query<number>(`
    RETURN LENGTH(FOR resource IN @@collection
      FILTER !IS_BOOL(resource.isFavorite)
      RETURN 1)
  `, { '@collection': collectionName });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`${collectionName} favorite migration verification failed for ${invalid} row(s).`);
}

export async function migrateEmailReplyMetadata(targetDb: Database): Promise<void> {
  const targets = await targetDb.query<{ scopeKey: string; threadKey: string }>(`
    FOR message IN emailMessages
      FILTER !HAS(message, "replyDepth") || ((message.inReplyTo != null || LENGTH(message.references || []) > 0) && !HAS(message, "parentMessageId"))
      COLLECT scopeKey = message.scopeKey, threadKey = message.threadKey
      RETURN { scopeKey, threadKey }
  `);
  for (const target of await targets.all()) {
    const cursor = await targetDb.query<{ key: string; messageIdHeader?: string; inReplyTo?: string; references?: string[] }>(`
      FOR message IN emailMessages
        FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey
        SORT message.sentAt ASC, message._key ASC
        RETURN { key: message._key, messageIdHeader: message.messageIdHeader, inReplyTo: message.inReplyTo, references: message.references }
    `, target);
    const depths = new Map<string, number>();
    const updates = (await cursor.all()).map((message) => {
      const parentMessageId = message.inReplyTo ?? message.references?.at(-1);
      const replyDepth = parentMessageId ? (depths.get(parentMessageId) ?? -1) + 1 : 0;
      if (message.messageIdHeader) depths.set(message.messageIdHeader, replyDepth);
      return { key: message.key, parentMessageId: parentMessageId ?? null, replyDepth };
    });
    if (updates.length) await targetDb.query(`FOR patch IN @updates UPDATE patch.key WITH { parentMessageId: patch.parentMessageId, replyDepth: patch.replyDepth } IN emailMessages OPTIONS { keepNull: false }`, { updates });
  }
}

const legacyPlaceSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  saved: z.boolean(),
  status: z.enum(['wishlist', 'visited']).default('wishlist'),
  isFavorite: z.boolean().default(false),
  name: z.string().trim().min(1),
  summary: z.string().default(''),
  countryCode: z.preprocess((value) => typeof value === 'string' ? value.trim().toUpperCase() : value, countryCodeSchema),
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
  openedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
}).strict();

async function migrateMinimalPlaces(targetDb: Database): Promise<void> {
  const places = targetDb.collection('places');
  if (!await places.exists()) return;
  const placeImages = targetDb.collection('placeImages');
  if (!await placeImages.exists()) await placeImages.create();
  const obsoleteCountryCursor = await targetDb.query<string>('FOR place IN places FILTER place.kind == "country" && (!HAS(place, "userKey") || !HAS(place, "saved")) RETURN place._key');
  const obsoleteCountryKeys = await obsoleteCountryCursor.all();
  if (obsoleteCountryKeys.length > 0) {
    for (const collectionName of ['shares', 'tagAssignments', 'bookSources']) {
      if (!await targetDb.collection(collectionName).exists()) continue;
      await targetDb.query(`
        FOR resource IN @@collection
          FILTER resource.sourceType == "place" && resource.sourceKey IN @obsoleteCountryKeys
          REMOVE resource IN @@collection
      `, { '@collection': collectionName, obsoleteCountryKeys });
    }
    await targetDb.query('FOR place IN places FILTER place._key IN @obsoleteCountryKeys REMOVE place IN places', { obsoleteCountryKeys });
  }
  const missingOwners = await targetDb.query<string>(`
    FOR place IN places
      FILTER !HAS(place, "userKey")
      LET membershipKeys = UNIQUE(FOR relation IN placeImages
        FILTER relation.placeKey == place._key
        LET image = DOCUMENT(images, relation.imageKey)
        FILTER image != null && IS_STRING(image.createdByKey)
        RETURN image.createdByKey)
      LET userKeys = UNIQUE(FOR membershipKey IN membershipKeys
        LET membership = DOCUMENT(userOrganizations, membershipKey)
        FILTER membership != null && IS_STRING(membership.userId) && LENGTH(membership.userId) > 0
        RETURN membership.userId)
      FILTER LENGTH(userKeys) != 1
      RETURN place._key
  `);
  const unresolvedOwners = await missingOwners.all();
  if (unresolvedOwners.length > 0) throw new Error(`places migration cannot safely derive user ownership for: ${unresolvedOwners.join(', ')}`);
  await targetDb.query(`
    FOR place IN places
      FILTER !HAS(place, "userKey") || !HAS(place, "saved")
      LET membershipKey = FIRST(FOR relation IN placeImages
        FILTER relation.placeKey == place._key
        LET image = DOCUMENT(images, relation.imageKey)
        FILTER image != null && IS_STRING(image.createdByKey)
        RETURN image.createdByKey)
      LET membership = membershipKey == null ? null : DOCUMENT(userOrganizations, membershipKey)
      UPDATE place WITH { userKey: HAS(place, "userKey") ? place.userKey : membership.userId, saved: HAS(place, "saved") ? place.saved : true } IN places
  `);
  const canonicalFields = ['userKey', 'scopeKey', 'saved', 'status', 'isFavorite', 'name', 'summary', 'countryCode', 'latitude', 'longitude', 'embedding', 'embeddingContentVersion', 'createdAt'].sort();
  const canonicalFieldSets = [false, true].flatMap((hasKind) => [false, true].flatMap((hasOpenedAt) => [false, true].flatMap((hasGeneratedDetail) => [false, true]
    .filter((hasGeneratedDetailVersion) => hasGeneratedDetail || !hasGeneratedDetailVersion)
    .map((hasGeneratedDetailVersion) => [...canonicalFields, ...(hasKind ? ['kind'] : []), ...(hasOpenedAt ? ['openedAt'] : []), ...(hasGeneratedDetail ? ['generatedDetail'] : []), ...(hasGeneratedDetailVersion ? ['generatedDetailVersion'] : [])].sort()))));
  const validatePlaces = async () => {
    let validationAfter = '';
    while (true) {
      const cursor = await targetDb.query<Record<string, unknown>>(`
        /* Validate every retained place before accepting its canonical projection. */
        FOR place IN places
          FILTER place._key > @after
          SORT place._key
          LIMIT 100
          RETURN place
      `, { after: validationAfter });
      const rows = await cursor.all();
      if (rows.length === 0) break;
      for (const place of rows) {
        const generatedDetail = place.generatedDetail == null ? undefined : generatedPlaceDetailSchema.safeParse(place.generatedDetail);
        const result = legacyPlaceSchema.safeParse({
          key: place._key,
          userKey: place.userKey,
          scopeKey: place.scopeKey,
          saved: place.saved,
          status: place.status === 'visited' ? 'visited' : 'wishlist',
          isFavorite: place.isFavorite === true,
          name: place.name,
          summary: typeof place.summary === 'string' ? place.summary : '',
          countryCode: place.countryCode,
          latitude: place.latitude,
          longitude: place.longitude,
          createdAt: place.createdAt,
          ...(place.openedAt == null ? {} : { openedAt: place.openedAt }),
        });
        if (!result.success) throw new Error(`places migration cannot retain ${String(place._key)}: ${result.error.issues.map((issue) => issue.message).join(', ')}`);
        if (generatedDetail && !generatedDetail.success) throw new Error(`places migration cannot retain generated detail for ${String(place._key)}: ${generatedDetail.error.issues.map((issue) => issue.message).join(', ')}`);
      }
      validationAfter = String(rows.at(-1)!._key);
    }
  };
  await validatePlaces();
  const duplicateCursor = await targetDb.query<{ scopeKey: string; userKey: string; countryCode: string; name: string; count: number }>(`
    FOR place IN places
      COLLECT scopeKey = place.scopeKey, userKey = place.userKey, countryCode = UPPER(TRIM(place.countryCode)), name = TRIM(place.name) WITH COUNT INTO count
      FILTER count > 1
      RETURN { scopeKey, userKey, countryCode, name, count }
  `);
  const duplicates = await duplicateCursor.all();
  if (duplicates.length > 0) {
    const identities = duplicates.map(({ scopeKey, userKey, countryCode, name, count }) => `${scopeKey}/${userKey}/${countryCode}/${name} (${count})`).join(', ');
    throw new Error(`places migration found duplicate saved cities: ${identities}`);
  }
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR place IN places
        FILTER place._key > @after
        LET fields = ATTRIBUTES(place, true, true)
        FILTER fields NOT IN @canonicalFieldSets
          || place.name != TRIM(place.name) || place.countryCode != UPPER(TRIM(place.countryCode))
          || place.embeddingContentVersion != 2
          || place.status NOT IN ["wishlist", "visited"] || !IS_BOOL(place.isFavorite)
          || !IS_ARRAY(place.embedding) || LENGTH(place.embedding) != @dimensions
          || LENGTH(place.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        SORT place._key
        LIMIT 50
        RETURN place
    `, { after, canonicalFieldSets, dimensions: EMBEDDING_DIMENSIONS });
    const legacyPlaces = await cursor.all();
    if (legacyPlaces.length === 0) break;
    const replacements = [];
    for (const place of legacyPlaces) {
      const canonical = legacyPlaceSchema.parse({
        key: place._key,
        userKey: place.userKey,
        scopeKey: place.scopeKey,
        saved: place.saved,
        status: place.status === 'visited' ? 'visited' : 'wishlist',
        isFavorite: place.isFavorite === true,
        name: place.name,
        summary: typeof place.summary === 'string' ? place.summary : '',
        countryCode: place.countryCode,
        latitude: place.latitude,
        longitude: place.longitude,
        ...(place.openedAt == null ? {} : { openedAt: place.openedAt }),
        createdAt: place.createdAt,
      });
      replacements.push({
        _key: canonical.key,
        _rev: place._rev,
        userKey: canonical.userKey,
        scopeKey: canonical.scopeKey,
        saved: canonical.saved,
        status: canonical.status,
        isFavorite: canonical.isFavorite,
        ...(place.kind == null ? {} : { kind: z.enum(['country', 'place']).parse(place.kind) }),
        name: canonical.name,
        summary: canonical.summary,
        countryCode: canonical.countryCode,
        latitude: canonical.latitude,
        longitude: canonical.longitude,
        embedding: await generateEmbedding(buildPlaceEmbeddingText(canonical)),
        embeddingContentVersion: 2,
        ...(place.generatedDetail == null ? {} : { generatedDetail: generatedPlaceDetailSchema.parse(place.generatedDetail) }),
        ...(place.generatedDetailVersion == null ? {} : { generatedDetailVersion: z.number().int().positive().parse(place.generatedDetailVersion) }),
        ...(canonical.openedAt == null ? {} : { openedAt: canonical.openedAt }),
        createdAt: canonical.createdAt,
      });
    }
    await runMigrationTransaction(targetDb, 'places', `
      FOR replacement IN @replacements
        LET place = DOCUMENT(places, replacement._key)
        FILTER place != null && place._rev == replacement._rev
        REPLACE place WITH UNSET(replacement, "_rev") IN places
    `, { replacements });
    after = String(legacyPlaces.at(-1)!._key);
  }
  await validatePlaces();
  const invalid = await targetDb.query<number>(`
    RETURN LENGTH(FOR place IN places
      LET fields = ATTRIBUTES(place, true, true)
      FILTER fields NOT IN @canonicalFieldSets
        || place.name != TRIM(place.name) || place.countryCode != UPPER(TRIM(place.countryCode))
        || place.embeddingContentVersion != 2
        || place.status NOT IN ["wishlist", "visited"] || !IS_BOOL(place.isFavorite)
        || !IS_ARRAY(place.embedding) || LENGTH(place.embedding) != @dimensions
        || LENGTH(place.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
      RETURN 1)
  `, { canonicalFieldSets, dimensions: EMBEDDING_DIMENSIONS });
  const invalidCount = await invalid.next() ?? 0;
  if (invalidCount > 0) throw new Error(`places minimal projection verification failed for ${invalidCount} row(s).`);
}

export async function migrateMinimalPlacesAndRetireTrips(targetDb: Database): Promise<void> {
  await migrateMinimalPlaces(targetDb);
  const legacyVisits = targetDb.collection('placeVisits');
  if (await legacyVisits.exists()) await legacyVisits.drop();

  const trips = targetDb.collection('trips');
  if (!await trips.exists()) return;
  const tripPlaces = targetDb.collection('tripPlaces');
  const hasTripPlaces = await tripPlaces.exists();
  await targetDb.query('FOR trip IN trips UPDATE trip WITH { status: trip.status IN ["planned", "completed"] ? trip.status : "planned", isFavorite: HAS(trip, "isFavorite") && IS_BOOL(trip.isFavorite) ? trip.isFavorite : false, updatedAt: HAS(trip, "updatedAt") && IS_STRING(trip.updatedAt) ? trip.updatedAt : trip.createdAt } IN trips');
  const images = targetDb.collection('images');
  if (await images.exists()) await targetDb.query('FOR trip IN trips FILTER HAS(trip, "coverImageKey") LET image = DOCUMENT(images, trip.coverImageKey) FILTER image == null || image.scopeKey != trip.scopeKey UPDATE trip WITH { coverImageKey: null } IN trips OPTIONS { keepNull: false }');
  else await targetDb.query('FOR trip IN trips FILTER HAS(trip, "coverImageKey") UPDATE trip WITH { coverImageKey: null } IN trips OPTIONS { keepNull: false }');
  const invalidCursor = await targetDb.query<string>(`
    FOR trip IN trips
      LET createdAtTimestamp = IS_STRING(trip.createdAt) && REGEX_TEST(trip.createdAt, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\\\.[0-9]+)?Z$") && IS_DATESTRING(trip.createdAt) ? DATE_TIMESTAMP(trip.createdAt) : null
      LET updatedAtTimestamp = IS_STRING(trip.updatedAt) && REGEX_TEST(trip.updatedAt, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\\\.[0-9]+)?Z$") && IS_DATESTRING(trip.updatedAt) ? DATE_TIMESTAMP(trip.updatedAt) : null
      LET createdAtValid = createdAtTimestamp != null && DATE_YEAR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 0, 4)) && DATE_MONTH(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 5, 2)) && DATE_DAY(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 8, 2)) && DATE_HOUR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 11, 2)) && DATE_MINUTE(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 14, 2)) && DATE_SECOND(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 17, 2))
      LET updatedAtValid = updatedAtTimestamp != null && DATE_YEAR(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 0, 4)) && DATE_MONTH(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 5, 2)) && DATE_DAY(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 8, 2)) && DATE_HOUR(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 11, 2)) && DATE_MINUTE(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 14, 2)) && DATE_SECOND(updatedAtTimestamp) == TO_NUMBER(SUBSTRING(trip.updatedAt, 17, 2))
      FILTER !REGEX_TEST(trip._key, "^[cC][0-9a-z]{6,}$") || !REGEX_TEST(trip.userKey, "^[cC][0-9a-z]{6,}$") || !REGEX_TEST(trip.scopeKey, "^[cC][0-9a-z]{6,}$") || !IS_STRING(trip.name)
        || trip.name != TRIM(trip.name) || LENGTH(trip.name) == 0 || LENGTH(trip.name) > 255
        || !createdAtValid || !updatedAtValid || trip.status NOT IN ["planned", "completed"] || !IS_BOOL(trip.isFavorite)
        || HAS(trip, "coverImageKey") && !REGEX_TEST(trip.coverImageKey, "^[cC][0-9a-z]{6,}$")
        || HAS(trip, "description") && (!IS_STRING(trip.description) || trip.description != TRIM(trip.description) || LENGTH(trip.description) == 0 || LENGTH(trip.description) > 10000)
        || HAS(trip, "requestHash") && (!IS_STRING(trip.requestHash) || !REGEX_TEST(trip.requestHash, "^[a-f0-9]{64}$"))
      RETURN trip._key
  `);
  const invalidTripKeys = await invalidCursor.all();
  if (invalidTripKeys.length > 0) {
    if (hasTripPlaces) await targetDb.query('FOR relation IN tripPlaces FILTER relation.tripKey IN @tripKeys REMOVE relation IN tripPlaces', { tripKeys: invalidTripKeys });
    await targetDb.query('FOR trip IN trips FILTER trip._key IN @tripKeys REMOVE trip IN trips', { tripKeys: invalidTripKeys });
  }
  if (hasTripPlaces) {
    const places = targetDb.collection('places');
    if (!await places.exists()) await targetDb.query('FOR relation IN tripPlaces REMOVE relation IN tripPlaces');
    else await targetDb.query(`
      FOR relation IN tripPlaces
        LET trip = DOCUMENT(trips, relation.tripKey)
        LET place = DOCUMENT(places, relation.placeKey)
        FILTER !IS_STRING(relation.scopeKey) || !IS_STRING(relation.tripKey) || !IS_STRING(relation.placeKey)
          || !IS_NUMBER(relation.position) || relation.position < 0 || relation.position != FLOOR(relation.position)
          || !IS_STRING(relation.createdAt)
          || trip == null || place == null || trip.scopeKey != relation.scopeKey || place.scopeKey != relation.scopeKey
          || trip.userKey != place.userKey || place.saved != true
        REMOVE relation IN tripPlaces
    `);
  }
  for (const name of ['shares', 'tagAssignments']) {
    const collection = targetDb.collection(name);
    if (await collection.exists()) await targetDb.query('FOR resource IN @@collection FILTER resource.sourceType == "trip" REMOVE resource IN @@collection', { '@collection': name });
  }
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR trip IN trips
        FILTER trip._key > @after
        FILTER trip.embeddingContentVersion != @contentVersion || !IS_ARRAY(trip.embedding) || LENGTH(trip.embedding) != @dimensions || LENGTH(trip.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        SORT trip._key ASC
        LIMIT 50
        RETURN trip
    `, { after, contentVersion: TRIP_EMBEDDING_CONTENT_VERSION, dimensions: EMBEDDING_DIMENSIONS });
    const tripsToEmbed = await cursor.all();
    if (tripsToEmbed.length === 0) break;
    const updates = await Promise.all(tripsToEmbed.map(async (trip) => ({
      _key: trip._key, _rev: trip._rev,
      embedding: await generateEmbedding(buildTripEmbeddingText({ name: String(trip.name), description: typeof trip.description === 'string' ? trip.description : undefined })),
    })));
    await targetDb.query(`
      FOR patch IN @updates
        LET trip = DOCUMENT(trips, patch._key)
        FILTER trip != null && trip._rev == patch._rev
        UPDATE trip WITH { embedding: patch.embedding, embeddingContentVersion: @contentVersion } IN trips
    `, { updates, contentVersion: TRIP_EMBEDDING_CONTENT_VERSION });
    after = String(tripsToEmbed.at(-1)!._key);
  }
}

export async function migrateTripCreationReceipts(targetDb: Database): Promise<void> {
  const receipts = targetDb.collection('tripCreationReceipts');
  if (!await receipts.exists()) return;
  await targetDb.query(`
    FOR receipt IN tripCreationReceipts
      LET createdAtTimestamp = IS_STRING(receipt.createdAt) && REGEX_TEST(receipt.createdAt, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\\\.[0-9]+)?Z$") && IS_DATESTRING(receipt.createdAt) ? DATE_TIMESTAMP(receipt.createdAt) : null
      LET createdAtValid = createdAtTimestamp != null && DATE_YEAR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 0, 4)) && DATE_MONTH(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 5, 2)) && DATE_DAY(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 8, 2)) && DATE_HOUR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 11, 2)) && DATE_MINUTE(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 14, 2)) && DATE_SECOND(createdAtTimestamp) == TO_NUMBER(SUBSTRING(receipt.createdAt, 17, 2))
      FILTER !REGEX_TEST(receipt._key, "^[cC][0-9a-z]{6,}$") || !REGEX_TEST(receipt.scopeKey, "^[cC][0-9a-z]{6,}$") || !REGEX_TEST(receipt.userKey, "^[cC][0-9a-z]{6,}$") || receipt.tripKey != receipt._key || !REGEX_TEST(receipt.tripKey, "^[cC][0-9a-z]{6,}$") || !REGEX_TEST(receipt.requestHash, "^[a-f0-9]{64}$") || !createdAtValid
      REMOVE receipt IN tripCreationReceipts
  `);
  const trips = targetDb.collection('trips');
  if (await trips.exists()) await targetDb.query(`
    FOR trip IN trips
      LET createdAtTimestamp = IS_STRING(trip.createdAt) && REGEX_TEST(trip.createdAt, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\\\.[0-9]+)?Z$") && IS_DATESTRING(trip.createdAt) ? DATE_TIMESTAMP(trip.createdAt) : null
      LET createdAtValid = createdAtTimestamp != null && DATE_YEAR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 0, 4)) && DATE_MONTH(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 5, 2)) && DATE_DAY(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 8, 2)) && DATE_HOUR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 11, 2)) && DATE_MINUTE(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 14, 2)) && DATE_SECOND(createdAtTimestamp) == TO_NUMBER(SUBSTRING(trip.createdAt, 17, 2))
      FILTER REGEX_TEST(trip._key, "^[cC][0-9a-z]{6,}$") && REGEX_TEST(trip.scopeKey, "^[cC][0-9a-z]{6,}$") && REGEX_TEST(trip.userKey, "^[cC][0-9a-z]{6,}$") && IS_STRING(trip.requestHash) && REGEX_TEST(trip.requestHash, "^[a-f0-9]{64}$") && createdAtValid
      UPSERT { _key: trip._key }
        INSERT { _key: trip._key, scopeKey: trip.scopeKey, userKey: trip.userKey, tripKey: trip._key, requestHash: trip.requestHash, createdAt: trip.createdAt }
        UPDATE {} IN tripCreationReceipts
  `);
}

export async function migrateTripGuides(targetDb: Database): Promise<void> {
  const guides = targetDb.collection('tripGuides');
  if (!await guides.exists()) return;
  await targetDb.query(`
    FOR guide IN tripGuides
      LET trip = DOCUMENT(trips, guide.tripKey)
      FILTER !REGEX_TEST(guide._key, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(guide.scopeKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(guide.userKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(guide.tripKey, "^[cC][0-9a-z]{6,}$")
        || trip == null || trip.scopeKey != guide.scopeKey || trip.userKey != guide.userKey
        || !IS_STRING(guide.name) || guide.name != TRIM(guide.name) || LENGTH(guide.name) == 0 || LENGTH(guide.name) > 255
        || !IS_STRING(guide.summary) || guide.summary != TRIM(guide.summary) || LENGTH(guide.summary) == 0 || LENGTH(guide.summary) > 4000
        || !IS_STRING(guide.requestHash) || !REGEX_TEST(guide.requestHash, "^[a-f0-9]{64}$")
        || !IS_ARRAY(guide.embedding) || (LENGTH(guide.embedding) != @dimensions && LENGTH(guide.embedding) != @legacyDimensions) || LENGTH(guide.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || !IS_STRING(guide.createdAt) || !IS_DATESTRING(guide.createdAt)
      REMOVE guide IN tripGuides
  `, { dimensions: EMBEDDING_DIMENSIONS, legacyDimensions: LEGACY_EMBEDDING_DIMENSIONS });
}

export async function migratePlaceReports(targetDb: Database): Promise<void> {
  const reports = targetDb.collection('placeReports');
  if (!await reports.exists()) return;
  await targetDb.query(`
    FOR report IN placeReports
      LET place = DOCUMENT(places, report.placeKey)
      FILTER !REGEX_TEST(report._key, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(report.scopeKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(report.userKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(report.placeKey, "^[cC][0-9a-z]{6,}$")
        || place == null || place.scopeKey != report.scopeKey || place.userKey != report.userKey || place.saved != true
        || !IS_STRING(report.name) || report.name != TRIM(report.name) || LENGTH(report.name) == 0 || LENGTH(report.name) > 255
        || !IS_STRING(report.summary) || report.summary != TRIM(report.summary) || LENGTH(report.summary) == 0 || LENGTH(report.summary) > 4000
        || !IS_STRING(report.requestHash) || !REGEX_TEST(report.requestHash, "^[a-f0-9]{64}$")
        || !IS_ARRAY(report.embedding) || (LENGTH(report.embedding) != @dimensions && LENGTH(report.embedding) != @legacyDimensions) || LENGTH(report.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || !IS_STRING(report.createdAt) || !IS_DATESTRING(report.createdAt)
      REMOVE report IN placeReports
  `, { dimensions: EMBEDDING_DIMENSIONS, legacyDimensions: LEGACY_EMBEDDING_DIMENSIONS });
}

export async function migrateGeneratedTravelDocuments(targetDb: Database): Promise<void> {
  await migrateTripGuides(targetDb);
  await migratePlaceReports(targetDb);
  const { ensureGeneratedDocumentFolders } = await import('@/lib/generated-documents/folders');
  const scopes = await (await targetDb.query<{ _key: string }>('FOR scope IN scopes RETURN { _key: scope._key }')).all();
  for (const scope of scopes) await ensureGeneratedDocumentFolders(targetDb, scope._key);
  const migrations = [
    { source: 'tripGuides', subjectType: 'trip', subjectField: 'tripKey', kind: 'guide' },
    { source: 'placeReports', subjectType: 'place', subjectField: 'placeKey', kind: 'brief' },
  ] as const;
  for (const migration of migrations) {
    const source = targetDb.collection(migration.source);
    if (!await source.exists()) continue;
    await targetDb.query(`
      FOR legacy IN @@source
        LET folderPurpose = CONCAT("generated-documents-", @kind)
        LET folder = FIRST(FOR candidate IN folders FILTER candidate.scopeKey == legacy.scopeKey && candidate.purpose == folderPurpose LIMIT 1 RETURN candidate)
        FILTER folder != null
        UPSERT { _key: legacy._key }
          INSERT { _key: legacy._key, scopeKey: legacy.scopeKey, folderKey: folder._key, name: legacy.name, content: legacy.summary, embedding: legacy.embedding, contentChunks: [legacy.summary], chunkEmbeddings: [legacy.embedding], semanticChunkCount: 1, semanticContentHash: SHA256(legacy.summary), isFavorite: false, createdAt: legacy.createdAt, updatedAt: legacy.createdAt }
          UPDATE {} IN documents
        UPSERT { _key: legacy._key }
          INSERT { _key: legacy._key, scopeKey: legacy.scopeKey, documentKey: legacy._key, subjectType: @subjectType, subjectKey: legacy[@subjectField], kind: @kind, provenance: "generated", createdByKey: legacy.userKey, idempotencyKey: CONCAT("migration:", legacy._key), requestHash: legacy.requestHash, createdAt: legacy.createdAt, updatedAt: legacy.createdAt }
          UPDATE {} IN generatedDocumentBindings
    `, { '@source': migration.source, subjectType: migration.subjectType, subjectField: migration.subjectField, kind: migration.kind });
    const verification = await targetDb.query<number>(`
      RETURN LENGTH(FOR legacy IN @@source
        LET document = DOCUMENT(documents, legacy._key)
        LET binding = DOCUMENT(generatedDocumentBindings, legacy._key)
        LET folderPurpose = CONCAT("generated-documents-", @kind)
        LET folder = FIRST(FOR candidate IN folders FILTER candidate.scopeKey == legacy.scopeKey && candidate.purpose == folderPurpose LIMIT 1 RETURN candidate)
        FILTER document == null || binding == null || folder == null
          || document.scopeKey != legacy.scopeKey || document.folderKey != folder._key || document.name != legacy.name || document.content != legacy.summary
          || binding.scopeKey != legacy.scopeKey || binding.documentKey != legacy._key || binding.subjectType != @subjectType || binding.subjectKey != legacy[@subjectField]
          || binding.kind != @kind || binding.createdByKey != legacy.userKey || binding.requestHash != legacy.requestHash
        RETURN 1)
    `, { '@source': migration.source, subjectType: migration.subjectType, subjectField: migration.subjectField, kind: migration.kind });
    const invalid = await verification.next() ?? 0;
    if (invalid > 0) throw new Error(`${migration.source} conversion failed for ${invalid} row(s); source collection was preserved.`);
    await source.drop();
  }
  await migrateContentDocuments(targetDb);
}

type TripAttachmentMigrationTransaction = <T>(operation: (transaction: Pick<Database, 'query'>) => Promise<T>) => Promise<T>;

export async function migrateTripAttachments(targetDb: Database, runTransaction: TripAttachmentMigrationTransaction = (operation) => withDatabaseTransaction(targetDb, ['tripAttachments'], operation)): Promise<void> {
  const collection = targetDb.collection('tripAttachments');
  if (!await collection.exists()) return;
  const existing = new Set((await targetDb.listCollections()).map(({ name }) => name));
  const required = ['scopes', 'trips', 'folders', 'collections'];
  const missing = required.filter((name) => !existing.has(name));
  if (missing.length > 0) {
    await targetDb.query('FOR attachment IN tripAttachments REMOVE attachment IN tripAttachments');
    return;
  }
  await targetDb.query(`
    FOR attachment IN tripAttachments
      LET scope = DOCUMENT(scopes, attachment.scopeKey)
      LET trip = DOCUMENT(trips, attachment.tripKey)
      LET target = attachment.targetType == "folder" ? DOCUMENT(folders, attachment.targetKey)
        : attachment.targetType == "collection" ? DOCUMENT(collections, attachment.targetKey)
        : null
      LET createdAtTimestamp = IS_STRING(attachment.createdAt) && REGEX_TEST(attachment.createdAt, "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\\\.[0-9]+)?Z$") && IS_DATESTRING(attachment.createdAt) ? DATE_TIMESTAMP(attachment.createdAt) : null
      LET createdAtValid = createdAtTimestamp != null
        && DATE_YEAR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 0, 4))
        && DATE_MONTH(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 5, 2))
        && DATE_DAY(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 8, 2))
        && DATE_HOUR(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 11, 2))
        && DATE_MINUTE(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 14, 2))
        && DATE_SECOND(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 17, 2))
      FILTER !REGEX_TEST(attachment._key, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(attachment.scopeKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(attachment.tripKey, "^[cC][0-9a-z]{6,}$")
        || !REGEX_TEST(attachment.targetKey, "^[cC][0-9a-z]{6,}$")
        || !createdAtValid
        || attachment.targetType NOT IN ["folder", "collection"]
        || !IS_NUMBER(attachment.position) || attachment.position < 0 || attachment.position != FLOOR(attachment.position)
        || scope == null || trip == null || target == null
        || trip.scopeKey != attachment.scopeKey || target.scopeKey != attachment.scopeKey
        || (HAS(trip, @marker) && trip[@marker] != null)
        || (HAS(target, @marker) && target[@marker] != null)
        || (attachment.targetType == "collection" && (target.mutationPolicy == "system-only" || target.purpose != null))
      REMOVE attachment IN tripAttachments
  `, {
    marker: LEGACY_REMOVAL_MARKER,
  });
  await targetDb.query('FOR attachment IN tripAttachments SORT attachment.createdAt ASC, attachment._key ASC COLLECT scopeKey = attachment.scopeKey, tripKey = attachment.tripKey, targetType = attachment.targetType, targetKey = attachment.targetKey INTO grouped FOR duplicate IN SLICE(grouped, 1) REMOVE duplicate.attachment IN tripAttachments');
  await runTransaction(async (transaction) => {
    await transaction.query('FOR attachment IN tripAttachments UPDATE attachment WITH { position: CONCAT("migration:", attachment._key), _migrationPosition: attachment.position } IN tripAttachments');
    await transaction.query('FOR attachment IN tripAttachments SORT attachment.scopeKey, attachment.tripKey, attachment._migrationPosition, attachment.createdAt, attachment._key COLLECT scopeKey = attachment.scopeKey, tripKey = attachment.tripKey INTO grouped FOR position IN 0..(LENGTH(grouped) - 1) LET item = grouped[position] REPLACE item.attachment WITH UNSET(MERGE(item.attachment, { position }), "_migrationPosition") IN tripAttachments');
  });
}

export async function migrateExactSemanticRecords(targetDb: Database, collectionName: 'folders' | 'images' | 'collections' | 'tags' | 'imageCaptions' | 'visualIdentities', embedKeys: readonly string[]) {
  const dimensions = EMBEDDING_DIMENSIONS;
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR resource IN @@collection
        FILTER resource._key > @after
        FILTER !IS_ARRAY(resource.embedding) || LENGTH(resource.embedding) != @dimensions
          || LENGTH(resource.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || HAS(resource, "embeddingProvider") || HAS(resource, "embeddingModel") || HAS(resource, "embeddingDimensions")
          || HAS(resource, "embeddingState") || HAS(resource, "embeddedAt")
          || (@isImage && (HAS(resource, "ownerKey") || HAS(resource, "requestHash")))
        SORT resource._key
        LIMIT 50
        RETURN resource
    `, { '@collection': collectionName, after, dimensions, isImage: collectionName === 'images' });
    const resources = await cursor.all();
    if (resources.length === 0) break;
    const updates: Array<Record<string, unknown>> = [];
    for (const resource of resources) {
      let embedding = resource.embedding;
      const hasEmbeddingMetadata = resource.embeddingProvider !== undefined || resource.embeddingModel !== undefined || resource.embeddingDimensions !== undefined;
      if ((hasEmbeddingMetadata && (resource.embeddingProvider !== EMBEDDING_PROVIDER_ID || resource.embeddingModel !== EMBEDDING_MODEL || resource.embeddingDimensions !== dimensions)) || !Array.isArray(embedding) || embedding.length !== dimensions || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        const text = collectionName === 'images' ? buildImageEmbeddingText({
          filename: String(resource.filename ?? ''), caption: String(resource.caption ?? ''),
          city: typeof resource.city === 'string' ? resource.city : null, country: typeof resource.country === 'string' ? resource.country : null,
          countryCode: typeof resource.countryCode === 'string' ? resource.countryCode : null,
          placeName: typeof resource.placeName === 'string' ? resource.placeName : null, placeSummary: typeof resource.placeSummary === 'string' ? resource.placeSummary : null,
        }) : buildEmbeddingText(embedKeys, resource);
        if (!text) throw new Error(`Cannot migrate ${collectionName}: ${String(resource._key)} has no semantic embedding input.`);
        embedding = await generateEmbedding(text);
      }
      updates.push({ _key: resource._key, _rev: resource._rev, embedding });
    }
    await runMigrationTransaction(targetDb, collectionName, `
      FOR patch IN @updates
        LET resource = DOCUMENT(@@collection, patch._key)
        FILTER resource != null && resource._rev == patch._rev
        REPLACE resource WITH UNSET(MERGE(resource, { embedding: patch.embedding }), "ownerKey", "requestHash", "embeddingProvider", "embeddingModel", "embeddingDimensions", "embeddingState", "embeddedAt") IN @@collection
    `, { '@collection': collectionName, updates });
    after = String(resources.at(-1)!._key);
  }
  const verification = await targetDb.query<number>(`
    RETURN LENGTH(FOR resource IN @@collection
      FILTER !IS_ARRAY(resource.embedding) || LENGTH(resource.embedding) != @dimensions
        || LENGTH(resource.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || HAS(resource, "embeddingProvider") || HAS(resource, "embeddingModel") || HAS(resource, "embeddingDimensions")
        || HAS(resource, "embeddingState") || HAS(resource, "embeddedAt")
        || (@isImage && (HAS(resource, "ownerKey") || HAS(resource, "requestHash")))
      RETURN 1)
  `, { '@collection': collectionName, dimensions, isImage: collectionName === 'images' });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`${collectionName} exact semantic migration verification failed for ${invalid} row(s).`);
}

export async function migrateContentVersions(targetDb: Database) {
  const dimensions = EMBEDDING_DIMENSIONS;
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR snapshot IN documentVersions
        FILTER snapshot._key > @after
        FILTER HAS(snapshot, "html") || (snapshot._semanticChunkingSkipped != true && (HAS(snapshot, "json") || HAS(snapshot, "storageKey") || HAS(snapshot, "sizeBytes") || HAS(snapshot, "updatedAt")
          || !IS_STRING(snapshot.content) || LENGTH(TRIM(snapshot.content)) == 0
          || !IS_ARRAY(snapshot.embedding) || LENGTH(snapshot.embedding) == 0
          || LENGTH(snapshot.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || (@dimensions > 0 && LENGTH(snapshot.embedding) != @dimensions)
          || !IS_ARRAY(snapshot.chunkEmbeddings)
          || snapshot.semanticChunkCount != LENGTH(snapshot.chunkEmbeddings)
          || snapshot.semanticContentHash != SHA256(snapshot.content)
          || LENGTH(snapshot.chunkEmbeddings[* FILTER !IS_ARRAY(CURRENT) || LENGTH(CURRENT) != @dimensions]) > 0
          || LENGTH(FLATTEN(snapshot.chunkEmbeddings)[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || HAS(snapshot, "embeddingProvider") || HAS(snapshot, "embeddingModel") || HAS(snapshot, "embeddingDimensions")
          || HAS(snapshot, "embeddingState") || HAS(snapshot, "embeddedAt")))
        SORT snapshot._key
        LIMIT 50
        RETURN snapshot
    `, { after, dimensions });
    const snapshots = await cursor.all();
    if (snapshots.length === 0) break;
    const updates: Array<Record<string, unknown>> = [];
    for (const snapshot of snapshots) {
      const historicalContent = nonEmptyString(snapshot.content) ?? (Array.isArray(snapshot.content) ? snapshot.content.filter((value): value is string => typeof value === 'string').join('') : null);
      const sourceHtml = nonEmptyString(snapshot.html);
      const content = sourceHtml ? recoverLegacyHtmlContent(sourceHtml) : historicalContent ?? '';
      if (!content.trim()) throw new Error(`Cannot migrate documentVersions: ${String(snapshot._key)} has no recoverable content.`);
      const contentChunks = migrationContentChunks(content);
      if (!contentChunks) {
        const fallbackChunk = migrationFallbackChunk(content);
        const fallbackEmbedding = isCurrentVector(snapshot.embedding) ? snapshot.embedding : (await generateEmbeddings([[nonEmptyString(snapshot.label), fallbackChunk].filter(Boolean).join('\n\n')]))[0]!;
        updates.push({
          _key: snapshot._key, _rev: snapshot._rev, source: { html: snapshot.html, content: snapshot.content },
          content, embedding: fallbackEmbedding,
          semanticChunkCount: 1, semanticContentHash: documentSemanticHash(content), _semanticChunkingSkipped: true,
        });
        continue;
      }
      const metadataCurrent = snapshot.embeddingProvider === undefined || (snapshot.embeddingProvider === EMBEDDING_PROVIDER_ID && snapshot.embeddingModel === EMBEDDING_MODEL && snapshot.embeddingDimensions === dimensions);
      const reusable = metadataCurrent && historicalContent === content
        ? currentChunkEmbeddings(snapshot.chunkEmbeddings, contentChunks.length) ?? (contentChunks.length === 1 && isCurrentVector(snapshot.embedding) ? [snapshot.embedding] : null)
        : null;
      const chunkEmbeddings = reusable ?? await generateEmbeddings(documentEmbeddingTexts(nonEmptyString(snapshot.label) ?? '', contentChunks));
      const embedding = chunkEmbeddings[0]!;
      updates.push({
        _key: snapshot._key,
        _rev: snapshot._rev,
        source: { html: snapshot.html, content: snapshot.content },
        content,
        embedding,
        chunkEmbeddings,
        semanticChunkCount: contentChunks.length,
        semanticContentHash: documentSemanticHash(content),
      });
    }
    await runMigrationTransaction(targetDb, 'documentVersions', `
      FOR patch IN @updates
        LET snapshot = DOCUMENT(documentVersions, patch._key)
        FILTER snapshot != null && snapshot._rev == patch._rev
        LET replacement = patch._semanticChunkingSkipped == true ? UNSET(MERGE(snapshot, UNSET(patch, "_key", "_rev", "source")), "chunkEmbeddings") : MERGE(snapshot, UNSET(patch, "_key", "_rev", "source"))
        /* Legacy version objects are intentionally retired as metadata-only orphans here.
           Object lifecycle reconciliation is external; migration must not infer deletion ownership. */
        REPLACE snapshot WITH UNSET(replacement, "html", "json", "storageKey", "sizeBytes", "updatedAt", "embeddingProvider", "embeddingModel", "embeddingDimensions", "embeddingState", "embeddedAt") IN documentVersions
    `, { updates });
    after = String(snapshots.at(-1)!._key);
  }
  const verification = await targetDb.query<number>(`
    RETURN LENGTH(FOR snapshot IN documentVersions
      FILTER HAS(snapshot, "html") || (snapshot._semanticChunkingSkipped != true && (HAS(snapshot, "json") || HAS(snapshot, "storageKey") || HAS(snapshot, "sizeBytes") || HAS(snapshot, "updatedAt")
        || !IS_STRING(snapshot.content) || LENGTH(TRIM(snapshot.content)) == 0
        || !IS_ARRAY(snapshot.embedding) || LENGTH(snapshot.embedding) == 0
        || LENGTH(snapshot.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || (@dimensions > 0 && LENGTH(snapshot.embedding) != @dimensions)
        || !IS_ARRAY(snapshot.chunkEmbeddings)
        || snapshot.semanticChunkCount != LENGTH(snapshot.chunkEmbeddings)
        || snapshot.semanticContentHash != SHA256(snapshot.content)
        || LENGTH(snapshot.chunkEmbeddings[* FILTER !IS_ARRAY(CURRENT) || LENGTH(CURRENT) != @dimensions]) > 0
        || LENGTH(FLATTEN(snapshot.chunkEmbeddings)[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || HAS(snapshot, "embeddingProvider") || HAS(snapshot, "embeddingModel") || HAS(snapshot, "embeddingDimensions")
        || HAS(snapshot, "embeddingState") || HAS(snapshot, "embeddedAt")))
      RETURN 1)
  `, { dimensions });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`documentVersions migration verification failed for ${invalid} stale row(s), including any concurrent edit conflicts; rerun the migration.`);
}

export async function migrateContentDocuments(targetDb: Database) {
  const dimensions = EMBEDDING_DIMENSIONS;
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR document IN documents
        FILTER document._key > @after
        FILTER HAS(document, "html") || (document._semanticChunkingSkipped != true && (HAS(document, "json")
          || !IS_STRING(document.content) || LENGTH(TRIM(document.content)) == 0
          || !IS_ARRAY(document.embedding) || LENGTH(document.embedding) == 0
          || LENGTH(document.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || (@dimensions > 0 && LENGTH(document.embedding) != @dimensions)
          || !IS_ARRAY(document.contentChunks) || LENGTH(document.contentChunks) == 0
          || LENGTH(document.contentChunks[* FILTER !IS_STRING(CURRENT) || LENGTH(TRIM(CURRENT)) == 0]) > 0
          || !IS_ARRAY(document.chunkEmbeddings) || LENGTH(document.chunkEmbeddings) != LENGTH(document.contentChunks)
          || CONCAT_SEPARATOR("", document.contentChunks) != document.content
          || document.semanticChunkCount != LENGTH(document.contentChunks)
          || document.semanticContentHash != SHA256(document.content)
          || LENGTH(document.chunkEmbeddings[* FILTER !IS_ARRAY(CURRENT) || LENGTH(CURRENT) != @dimensions]) > 0
          || LENGTH(FLATTEN(document.chunkEmbeddings)[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || HAS(document, "embeddingProvider") || HAS(document, "embeddingModel") || HAS(document, "embeddingDimensions")
          || HAS(document, "embeddingState") || HAS(document, "embeddedAt")))
        SORT document._key
        LIMIT 50
        RETURN document
    `, { after, dimensions });
    const documents = await cursor.all();
    if (documents.length === 0) break;
    const updates: Array<Record<string, unknown>> = [];
    for (const document of documents) {
      const historicalContent = nonEmptyString(document.content);
      const sourceHtml = nonEmptyString(document.html);
      const content = sourceHtml ? recoverLegacyHtmlContent(sourceHtml) : historicalContent ?? '';
      if (!content.trim()) throw new Error(`Cannot migrate documents: ${String(document._key)} has no recoverable content.`);
      const contentChunks = migrationContentChunks(content);
      if (!contentChunks) {
        const fallbackChunk = migrationFallbackChunk(content);
        const fallbackEmbedding = isCurrentVector(document.embedding) ? document.embedding : (await generateEmbeddings([`${String(document.name ?? '').trim()}\n\n${fallbackChunk}`.trim()]))[0]!;
        updates.push({
          _key: document._key, _rev: document._rev, source: { name: document.name, html: document.html, content: document.content },
          content, embedding: fallbackEmbedding, semanticChunkCount: 1,
          semanticContentHash: documentSemanticHash(content), _semanticChunkingSkipped: true,
        });
        continue;
      }
      const metadataCurrent = document.embeddingProvider === undefined || (document.embeddingProvider === EMBEDDING_PROVIDER_ID && document.embeddingModel === EMBEDDING_MODEL && document.embeddingDimensions === dimensions);
      const storedChunksCurrent = Array.isArray(document.contentChunks) && document.contentChunks.length === contentChunks.length && document.contentChunks.every((chunk, index) => chunk === contentChunks[index]);
      const reusable = metadataCurrent && historicalContent === content && (storedChunksCurrent || document.contentChunks === undefined)
        ? currentChunkEmbeddings(document.chunkEmbeddings, contentChunks.length) ?? (contentChunks.length === 1 && isCurrentVector(document.embedding) ? [document.embedding] : null)
        : null;
      const chunkEmbeddings = reusable ?? await generateEmbeddings(documentEmbeddingTexts(String(document.name ?? ''), contentChunks));
      const embedding = chunkEmbeddings[0]!;
      updates.push({
        _key: document._key,
        _rev: document._rev,
        source: { name: document.name, html: document.html, content: document.content },
        content,
        contentChunks,
        embedding,
        chunkEmbeddings,
        semanticChunkCount: contentChunks.length,
        semanticContentHash: documentSemanticHash(content),
      });
    }
    await runMigrationTransaction(targetDb, 'documents', `
      FOR patch IN @updates
        LET document = DOCUMENT(documents, patch._key)
        FILTER document != null && document._rev == patch._rev
        LET replacement = patch._semanticChunkingSkipped == true ? UNSET(MERGE(document, UNSET(patch, "_key", "_rev", "source")), "contentChunks", "chunkEmbeddings") : MERGE(document, UNSET(patch, "_key", "_rev", "source"))
        REPLACE document WITH UNSET(replacement, "html", "json", "embeddingProvider", "embeddingModel", "embeddingDimensions", "embeddingState", "embeddedAt") IN documents
    `, { updates });
    after = String(documents.at(-1)!._key);
  }
  const verification = await targetDb.query<number>(`
    RETURN LENGTH(FOR document IN documents
      FILTER HAS(document, "html") || (document._semanticChunkingSkipped != true && (HAS(document, "json")
        || !IS_STRING(document.content) || LENGTH(TRIM(document.content)) == 0
        || !IS_ARRAY(document.embedding) || LENGTH(document.embedding) == 0
        || LENGTH(document.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || (@dimensions > 0 && LENGTH(document.embedding) != @dimensions)
        || !IS_ARRAY(document.contentChunks) || LENGTH(document.contentChunks) == 0
        || LENGTH(document.contentChunks[* FILTER !IS_STRING(CURRENT) || LENGTH(TRIM(CURRENT)) == 0]) > 0
        || !IS_ARRAY(document.chunkEmbeddings) || LENGTH(document.chunkEmbeddings) != LENGTH(document.contentChunks)
        || CONCAT_SEPARATOR("", document.contentChunks) != document.content
        || document.semanticChunkCount != LENGTH(document.contentChunks)
        || document.semanticContentHash != SHA256(document.content)
        || LENGTH(document.chunkEmbeddings[* FILTER !IS_ARRAY(CURRENT) || LENGTH(CURRENT) != @dimensions]) > 0
        || LENGTH(FLATTEN(document.chunkEmbeddings)[* FILTER !IS_NUMBER(CURRENT)]) > 0
        || HAS(document, "embeddingProvider") || HAS(document, "embeddingModel") || HAS(document, "embeddingDimensions")
        || HAS(document, "embeddingState") || HAS(document, "embeddedAt")))
      RETURN 1)
  `, { dimensions });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) throw new Error(`documents migration verification failed for ${invalid} stale row(s), including any concurrent edit conflicts; rerun the migration.`);
}

export async function migrateContentShares(targetDb: Database) {
  const legacy = targetDb.collection('documentShares');
  if (!(await legacy.exists())) return;
  const target = targetDb.collection('shares');
  if (!(await target.exists())) await target.create();
  for (const index of [
    { fields: ['scopeKey'] },
    { fields: ['scopeKey', 'sourceType', 'sourceKey', 'revokedAt'] }, { fields: ['tokenHash'], unique: true }, { fields: ['expiresAt'], sparse: true },
  ]) await target.ensureIndex({ type: 'persistent', unique: false, sparse: false, ...index });

  const markerKey = 'content-document-shares-cutover';
  const marker = await target.document(markerKey).catch(() => null) as { state?: string } | null;
  const timestamp = new Date().toISOString();
  if (!marker) await target.save({ _key: markerKey, kind: 'content-share-cutover', state: 'dual', createdAt: timestamp, updatedAt: timestamp });
  const iso = z.string().datetime();
  const canonical = (share: Record<string, unknown>) => {
    const [patch] = stageLegacyDocumentShares([share]);
    const requiredDates = ['createdAt', 'updatedAt'] as const;
    for (const field of requiredDates) iso.parse(share[field]);
    for (const field of ['expiresAt', 'revokedAt'] as const) if (share[field] != null) iso.parse(share[field]);
    if (typeof share.scopeKey !== 'string' || typeof share.documentKey !== 'string') throw new Error(`Cannot migrate documentShares/${String(share._key)}: invalid scope or document key.`);
    return {
      _key: String(share._key), scopeKey: share.scopeKey, sourceType: 'document', sourceKey: share.documentKey,
      permission: patch!.permission, tokenHash: patch!.tokenHash,
      ...(share.passwordHash != null ? { passwordHash: share.passwordHash } : {}),
      ...(share.expiresAt != null ? { expiresAt: share.expiresAt } : {}),
      ...(share.revokedAt != null ? { revokedAt: share.revokedAt } : {}),
      createdAt: share.createdAt, updatedAt: share.updatedAt,
    };
  };
  const fields = ['scopeKey', 'sourceType', 'sourceKey', 'permission', 'tokenHash', 'passwordHash', 'expiresAt', 'revokedAt', 'createdAt', 'updatedAt'] as const;
  const equal = (left: Record<string, unknown>, right: Record<string, unknown>) => fields.every((field) => (left[field] ?? null) === (right[field] ?? null));
  const copyAndVerify = async () => {
    let after = '';
    while (true) {
      const page = await targetDb.query<Record<string, unknown>>('FOR share IN documentShares FILTER share._key > @after SORT share._key LIMIT 100 RETURN share', { after });
      const source = await page.all();
      if (!source.length) break;
      for (const row of source) {
        const prepared = canonical(row);
        const existing = await target.document(prepared._key).catch(() => null) as Record<string, unknown> | null;
        if (existing && (existing.sourceType !== 'document' || existing.sourceKey !== prepared.sourceKey || existing.scopeKey !== prepared.scopeKey || existing.tokenHash !== prepared.tokenHash)) throw new Error(`Cannot migrate documentShares: target key ${prepared._key} collides with a different share.`);
        const tokenCollision = await targetDb.query<string>('FOR share IN shares FILTER share._key != @key && share.tokenHash == @tokenHash LIMIT 1 RETURN share._key', { key: prepared._key, tokenHash: prepared.tokenHash });
        if (await tokenCollision.next()) throw new Error(`Cannot migrate documentShares: duplicate token hash ${prepared.tokenHash}.`);
        await target.save(prepared, { overwriteMode: 'replace' });
        const copied = await target.document(prepared._key) as Record<string, unknown>;
        if (!equal(copied, prepared)) throw new Error(`Cannot migrate documentShares: verification failed for ${prepared._key}.`);
      }
      after = String(source.at(-1)!._key);
    }
  };
  const verifyOnly = async () => {
    let after = '';
    while (true) {
      const page = await targetDb.query<Record<string, unknown>>('FOR share IN documentShares FILTER share._key > @after SORT share._key LIMIT 100 RETURN share', { after });
      const source = await page.all();
      if (!source.length) break;
      for (const row of source) {
        const prepared = canonical(row);
        const copied = await target.document(prepared._key).catch(() => null) as Record<string, unknown> | null;
        if (!copied || !equal(copied, prepared)) {
          throw new Error(`documentShares final verification failed for ${prepared._key}; retaining the legacy collection.`);
        }
      }
      after = String(source.at(-1)!._key);
    }
  };
  const snapshot = async () => {
    const cursor = await targetDb.query<{ count: number; revisionHash: number }>('RETURN { count: LENGTH(documentShares), revisionHash: SUM((FOR share IN documentShares RETURN HASH(CONCAT(share._key, share._rev)))) }');
    return await cursor.next();
  };
  let stable = false;
  for (let pass = 0; pass < 5 && !stable; pass += 1) {
    const before = await snapshot();
    if (marker?.state === 'global') await verifyOnly();
    else await copyAndVerify();
    const after = await snapshot();
    stable = before?.count === after?.count && before?.revisionHash === after?.revisionHash;
  }
  if (!stable) throw new Error('documentShares remained active during migration verification; retaining it for retry.');
  if (!marker) return;

  if (marker.state !== 'global') {
    await target.update(markerKey, { state: 'global', updatedAt: timestamp });
    return;
  }
  await legacy.drop();
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

const formerlyTombstonedCollections = [
  'scopes', 'scopeScopes', 'folders', 'images', 'visualIdentities', 'collections',
  'imageCollecitionHightlights', 'imageCollectionMemories', 'documents', 'documentVersions', 'documentShares',
  'shares', 'places', 'trips', 'books', 'emailThreads', 'messages',
] as const;

export async function removeLegacyTombstones(targetDb: Database): Promise<void> {
  const jobs = targetDb.collection('storageDeletionJobs');
  if (!await jobs.exists()) await jobs.create();
  await jobs.ensureIndex({ type: 'persistent', fields: ['storageKey'], unique: true });
  const existing = new Set((await targetDb.listCollections()).map(({ name }) => name));
  const exists = async (name: string) => existing.has(name);
  await withDatabaseTransaction(targetDb, { write: [...existing] }, async (transaction) => {
  const keysFor = async (name: string): Promise<string[]> => {
    if (!await exists(name)) return [];
    const cursor = await transaction.query(
      'FOR resource IN @@collection FILTER HAS(resource, @marker) && resource[@marker] != null RETURN resource._key',
      { '@collection': name, marker: LEGACY_REMOVAL_MARKER },
    );
    return cursor.all() as Promise<string[]>;
  };
  const removeKeys = async (name: string, keys: string[]) => {
    if (!keys.length || !await exists(name)) return;
    await transaction.query('FOR resource IN @@collection FILTER resource._key IN @keys REMOVE resource IN @@collection', { '@collection': name, keys });
  };
  const removeBy = async (name: string, field: string, keys: string[]) => {
    if (!keys.length || !await exists(name)) return;
    await transaction.query('FOR resource IN @@collection FILTER resource[@field] IN @keys REMOVE resource IN @@collection', { '@collection': name, field, keys });
  };
  const removeTyped = async (name: string, typeField: string, type: string, keys: string[], sourceCollection?: string) => {
    if (!keys.length || !await exists(name)) return;
    if (sourceCollection && await exists(sourceCollection) && name !== 'userHiddens') {
      await transaction.query('FOR source IN @@source FILTER source._key IN @keys FOR resource IN @@collection FILTER resource.scopeKey == source.scopeKey && resource[@typeField] == @type && resource.sourceKey == source._key REMOVE resource IN @@collection', { '@source': sourceCollection, '@collection': name, keys, typeField, type });
      return;
    }
    await transaction.query('FOR resource IN @@collection FILTER resource[@typeField] == @type && resource.sourceKey IN @keys REMOVE resource IN @@collection', { '@collection': name, keys, typeField, type });
  };
  const removeAttachmentTargets = async (targetType: string, keys: string[]) => {
    if (!keys.length || !await exists('tripAttachments')) return;
    await transaction.query('LET tripKeys = UNIQUE(FOR attachment IN tripAttachments FILTER attachment.targetType == @targetType && attachment.targetKey IN @keys RETURN attachment.tripKey) LET removed = (FOR attachment IN tripAttachments FILTER attachment.targetType == @targetType && attachment.targetKey IN @keys REMOVE attachment IN tripAttachments RETURN 1) LET touched = (FOR trip IN trips FILTER trip._key IN tripKeys UPDATE trip WITH { updatedAt: @now } IN trips RETURN 1) RETURN LENGTH(removed)', { targetType, keys, now: new Date().toISOString() });
  };
  const mergeKeys = (...values: string[][]) => [...new Set(values.flat())];

  const scopeKeys = await keysFor('scopes');
  const directFolderKeys = await keysFor('folders');
  const allFolderKeys = new Set(directFolderKeys);
  if (await exists('folders')) {
    let parents = directFolderKeys;
    while (parents.length) {
      const cursor = await transaction.query('FOR folder IN folders FILTER folder.parentFolderKey IN @parents RETURN folder._key', { parents });
      const children = ((await cursor.all()) as string[]).filter((key) => !allFolderKeys.has(key));
      for (const key of children) allFolderKeys.add(key);
      parents = children;
    }
  }
  const removedFolderKeys = [...allFolderKeys];
  const scopedFolderKeys = scopeKeys.length && await exists('folders') ? await (await transaction.query('FOR folder IN folders FILTER folder.scopeKey IN @scopeKeys RETURN folder._key', { scopeKeys })).all() as string[] : [];
  const documentKeys = mergeKeys(
    await keysFor('documents'),
    await exists('documents') && removedFolderKeys.length ? await (await transaction.query('FOR document IN documents FILTER document.folderKey IN @keys RETURN document._key', { keys: removedFolderKeys })).all() as string[] : [],
    await exists('documents') && scopeKeys.length ? await (await transaction.query('FOR document IN documents FILTER document.scopeKey IN @scopeKeys RETURN document._key', { scopeKeys })).all() as string[] : [],
  );
  const imageKeys = mergeKeys(
    await keysFor('images'),
    await exists('images') && scopeKeys.length ? await (await transaction.query('FOR image IN images FILTER image.scopeKey IN @scopeKeys RETURN image._key', { scopeKeys })).all() as string[] : [],
  );
  const collectionKeys = mergeKeys(
    await keysFor('collections'),
    await exists('collections') && scopeKeys.length ? await (await transaction.query('FOR collection IN collections FILTER collection.scopeKey IN @scopeKeys RETURN collection._key', { scopeKeys })).all() as string[] : [],
  );
  const summaryKeys = await exists('documentSummaries') && documentKeys.length ? await (await transaction.query('FOR summary IN documentSummaries FILTER summary.documentKey IN @keys RETURN summary._key', { keys: documentKeys })).all() as string[] : [];
  const uploadKeys = await exists('galleryUploads') ? await (await transaction.query('FOR upload IN galleryUploads FILTER upload.scopeKey IN @scopeKeys || upload.imageKey IN @imageKeys || DOCUMENT(images, upload.imageKey) == null RETURN upload._key', { scopeKeys, imageKeys })).all() as string[] : [];
  const storageKeys: string[] = [];
  if (documentKeys.length && await exists('documents')) storageKeys.push(...((await (await transaction.query('FOR document IN documents FILTER document._key IN @keys RETURN APPEND(APPEND(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : []), IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : [])', { keys: documentKeys })).all()) as string[][]).flat());
  if (imageKeys.length && await exists('images')) storageKeys.push(...await (await transaction.query('FOR image IN images FILTER image._key IN @keys && IS_STRING(image.storageKey) RETURN image.storageKey', { keys: imageKeys })).all() as string[]);
  if (documentKeys.length && await exists('documentAudioVersions')) storageKeys.push(...await (await transaction.query('FOR audio IN documentAudioVersions FILTER audio.documentKey IN @keys && IS_STRING(audio.storageKey) RETURN audio.storageKey', { keys: documentKeys })).all() as string[]);
  if (documentKeys.length && await exists('documentSummaryAudio')) storageKeys.push(...await (await transaction.query('FOR audio IN documentSummaryAudio FILTER audio.documentKey IN @keys && IS_STRING(audio.storageKey) RETURN audio.storageKey', { keys: documentKeys })).all() as string[]);
  if (uploadKeys.length && await exists('galleryUploads')) storageKeys.push(...await (await transaction.query('FOR upload IN galleryUploads FILTER upload._key IN @keys && IS_STRING(upload.storageKey) RETURN upload.storageKey', { keys: uploadKeys })).all() as string[]);
  await transaction.query('FOR storageKey IN UNIQUE(@storageKeys) FILTER IS_STRING(storageKey) && LENGTH(storageKey) > 0 UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { storageKeys, now: new Date().toISOString() });

  if (scopeKeys.length) {
    for (const name of [
      'scopeMembers', 'imageCaptions', 'visualIdentities', 'imageIdentities',
       'galleryUploads', 'collections', 'collectionImages', 'imageCollecitionHightlights', 'imageCollectionMemories',
      'collectionMembers', 'collectionInvites', 'tags', 'tagAssignments', 'documents',
      'documentVersions', 'documentAudioVersions', 'documentSummaries', 'documentSummaryAudio',
       'shares', 'places', 'generatedDocumentBindings', 'trips', 'tripCreationReceipts', 'tripPlaces', 'tripAttachments', 'placeVisits', 'books', 'bookContexts',
      'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress',
      'emailAccounts', 'emailThreads', 'emailMessages', 'emailContacts', 'emailWritingProfiles',
      'emailRules', 'emailReplyDrafts', 'channels', 'threads', 'messages', 'messageMentions',
      'messageReactions', 'polls', 'pollOptions', 'pollVotes',
    ]) await removeBy(name, 'scopeKey', scopeKeys);
    if (await exists('scopeScopes')) {
      await transaction.query('FOR relation IN scopeScopes FILTER relation.parentKey IN @keys || relation.childKey IN @keys REMOVE relation IN scopeScopes', { keys: scopeKeys });
    }
    await removeKeys('scopes', scopeKeys);
  }

  await removeDocumentDependents(documentKeys, removeBy, removeKeys, removeTyped, summaryKeys);
  await removeAttachmentTargets('folder', mergeKeys(removedFolderKeys, scopedFolderKeys));
  await removeTyped('userHiddens', 'source', 'folder', mergeKeys(removedFolderKeys, scopedFolderKeys));
  await removeKeys('folders', mergeKeys(removedFolderKeys, scopedFolderKeys));

  await removeAttachmentTargets('collection', collectionKeys);
  for (const name of ['collectionImages', 'collectionMembers', 'collectionInvites', 'imageCollecitionHightlights']) await removeBy(name, 'collectionKey', collectionKeys);
  await removeTyped('shares', 'sourceType', 'collection', collectionKeys, 'collections');
  await removeTyped('tagAssignments', 'sourceType', 'collection', collectionKeys, 'collections');
  await removeTyped('userHiddens', 'source', 'collection', collectionKeys);
  await removeKeys('collections', collectionKeys);

  for (const name of ['collectionImages', 'imageIdentities', 'imageCollectionMemories']) await removeBy(name, 'imageKey', imageKeys);
  await removeTyped('shares', 'sourceType', 'image', imageKeys, 'images');
  await removeTyped('tagAssignments', 'sourceType', 'image', imageKeys, 'images');
  await removeTyped('userHiddens', 'source', 'image', imageKeys);
  await removeBy('galleryUploads', 'imageKey', imageKeys);
  if (imageKeys.length && await exists('collections')) await transaction.query('FOR collection IN collections FILTER collection.coverImageKey IN @keys UPDATE collection WITH { coverImageKey: null } IN collections OPTIONS { keepNull: false }', { keys: imageKeys });
  if (imageKeys.length && await exists('trips')) await transaction.query('FOR trip IN trips FILTER trip.coverImageKey IN @keys UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }', { keys: imageKeys, now: new Date().toISOString() });
  if (imageKeys.length && await exists('visualIdentities')) {
    const cursor = await transaction.query('FOR identity IN visualIdentities FILTER identity.referenceImageKey IN @keys RETURN identity._key', { keys: imageKeys });
    const referencedIdentityKeys = await cursor.all() as string[];
    await removeBy('imageIdentities', 'identityKey', referencedIdentityKeys);
    await removeKeys('visualIdentities', referencedIdentityKeys);
  }
  await removeKeys('images', imageKeys);
  await removeKeys('galleryUploads', uploadKeys);
  if (await exists('imageCaptions')) await transaction.query('FOR caption IN imageCaptions FILTER LENGTH(FOR image IN images FILTER image.imageCaptionKey == caption._key LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions');

  const identityKeys = await keysFor('visualIdentities');
  await removeBy('imageIdentities', 'identityKey', identityKeys);
  await removeKeys('visualIdentities', identityKeys);

  const tripKeys = await keysFor('trips');
  await removeBy('generatedDocumentBindings', 'subjectKey', tripKeys);
  await removeBy('tripAttachments', 'tripKey', tripKeys);
  for (const name of ['tripPlaces', 'placeVisits']) await removeBy(name, 'tripKey', tripKeys);
  await removeTyped('shares', 'sourceType', 'trip', tripKeys, 'trips');
  await removeTyped('tagAssignments', 'sourceType', 'trip', tripKeys, 'trips');
  await removeKeys('trips', tripKeys);

  const placeKeys = await keysFor('places');
  await removeBy('generatedDocumentBindings', 'subjectKey', placeKeys);
  for (const name of ['tripPlaces', 'placeVisits']) await removeBy(name, 'placeKey', placeKeys);
  await removeTyped('shares', 'sourceType', 'place', placeKeys, 'places');
  await removeTyped('tagAssignments', 'sourceType', 'place', placeKeys, 'places');
  await removeKeys('places', placeKeys);

  const bookKeys = await keysFor('books');
  if (bookKeys.length && await exists('bookChapters')) {
    const cursor = await transaction.query('FOR chapter IN bookChapters FILTER chapter.bookKey IN @keys RETURN chapter._key', { keys: bookKeys });
    await removeBy('chapterContexts', 'chapterKey', await cursor.all() as string[]);
  }
  for (const name of ['bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'bookProgress']) await removeBy(name, 'bookKey', bookKeys);
  await removeKeys('books', bookKeys);

  const emailThreadKeys = await keysFor('emailThreads');
  for (const name of ['emailMessages', 'emailReplyDrafts']) await removeBy(name, 'threadKey', emailThreadKeys);
  await removeKeys('emailThreads', emailThreadKeys);

  const messageKeys = await keysFor('messages');
  const threadKeys = messageKeys.length && await exists('threads') ? await (await transaction.query('FOR thread IN threads FILTER thread.rootMessageKey IN @keys RETURN thread._key', { keys: messageKeys })).all() as string[] : [];
  const removedMessageKeys = mergeKeys(messageKeys, threadKeys.length && await exists('messages') ? await (await transaction.query('FOR message IN messages FILTER message.threadKey IN @threadKeys RETURN message._key', { threadKeys })).all() as string[] : []);
  if (removedMessageKeys.length && await exists('polls')) {
    const cursor = await transaction.query('FOR poll IN polls FILTER poll.messageKey IN @keys RETURN poll._key', { keys: removedMessageKeys });
    const pollKeys = await cursor.all() as string[];
    for (const name of ['pollOptions', 'pollVotes']) await removeBy(name, 'pollKey', pollKeys);
  }
  for (const name of ['messageMentions', 'messageReactions', 'polls']) await removeBy(name, 'messageKey', removedMessageKeys);
  await removeKeys('messages', removedMessageKeys);
  await removeKeys('threads', threadKeys);

  for (const name of formerlyTombstonedCollections) {
    const keys = await keysFor(name);
    await removeKeys(name, keys);
  }
  });

  for (const name of formerlyTombstonedCollections) {
    if (!await exists(name)) continue;
    const collection = targetDb.collection(name);
    for (const index of await collection.indexes()) {
      const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
      if (fields.includes(LEGACY_REMOVAL_MARKER)) await collection.dropIndex(index.id);
    }
    await targetDb.query(
      'FOR resource IN @@collection FILTER HAS(resource, @marker) UPDATE resource WITH ZIP([@marker], [null]) IN @@collection OPTIONS { keepNull: false }',
      { '@collection': name, marker: LEGACY_REMOVAL_MARKER },
    );
  }
}

async function removeDocumentDependents(
  documentKeys: string[],
  removeBy: (name: string, field: string, keys: string[]) => Promise<void>,
  removeKeys: (name: string, keys: string[]) => Promise<void>,
  removeTyped: (name: string, typeField: string, type: string, keys: string[], sourceCollection?: string) => Promise<void>,
  summaryKeys: string[],
) {
  if (!documentKeys.length) return;
  await removeBy('documentSummaryAudio', 'summaryKey', summaryKeys);
  for (const name of ['documentVersions', 'documentAudioVersions', 'documentSummaries']) await removeBy(name, 'documentKey', documentKeys);
  await removeBy('documentShares', 'documentKey', documentKeys);
  await removeTyped('shares', 'sourceType', 'document', documentKeys, 'documents');
  await removeTyped('tagAssignments', 'sourceType', 'document', documentKeys, 'documents');
  await removeTyped('userHiddens', 'source', 'document', documentKeys);
  await removeKeys('documents', documentKeys);
}

export const collections: CollectionSpec[] = [
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
      { fields: ['modelKey', 'actionSlug'], unique: true },
      { fields: ['actionSlug', 'enabled', 'priority'] },
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
  // Private per-user visibility overlay. Never expose through the generic node registry.
  { name: 'userHiddens', skipEmbedding: true, indexes: [{ fields: ['userKey', 'source', 'sourceKey'], unique: true }, { fields: ['userKey', 'createdAt'] }, { fields: ['source', 'sourceKey'] }] },
  {
    name: 'authSessions',
    skipEmbedding: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['refreshTokenHash'], unique: true },
      { fields: ['expiresAt'] },
      { fields: ['userId', 'revokedAt'] },
    ],
  },
  {
    name: 'events',
    skipEmbedding: true,
    indexes: [
      { fields: ['slug', 'createdAt'] },
      { fields: ['distinctId', 'createdAt'] },
      { fields: ['userId', 'createdAt'], sparse: true },
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
  {
    name: 'orchestrators',
    embedKeys: ['name', 'role'],
    indexes: [{ fields: ['name'] }],
  },
  {
    name: 'voices',
    embedKeys: ['voice', 'label', 'modelLabel', 'language'],
    indexes: [{ fields: ['provider', 'model', 'voice'], unique: true }],
  },
  { name: 'processedWebhookEvents', indexes: [{ fields: ['provider', 'eventId'], unique: true }] },
  {
    name: 'authChallenges',
    indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['identityKey', 'identityType', 'kind'] }, { fields: ['expiresAt'] }],
  },
  {
    name: 'organizations',
    embedKeys: ['name', 'slug', 'description'],
    indexes: [
      { fields: ['is_root'] },
      { fields: ['slug'], unique: true, sparse: true },
      { fields: ['personalOwnerUserId'], unique: true, sparse: true },
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
  // AI framework nodes. Creation + read-path indexes are owned by the
  // ensure*Collection modules under src/lib/ai (called from main below);
  // these entries exist so the generic embedding backfill covers them.
  // Embedding policy: only human text is embedded — ids, enums, and
  // timestamps are queryable with plain filters and are never embed text.
  { name: 'scopes', embedKeys: ['name', 'slug', 'description'] },
  { name: 'channels', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'position'] }, { fields: ['scopeKey', 'name'] }, { fields: ['organizationKey', 'kind', 'name'], unique: true, sparse: true }] },
  { name: 'channelParticipants', embedKeys: [], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['userOrganizationKey'], sparse: true }, { fields: ['orchestratorKey'], sparse: true }, { fields: ['channelKey', 'userOrganizationKey'], unique: true, sparse: true }, { fields: ['channelKey', 'orchestratorKey'], unique: true, sparse: true }] },
  { name: 'threads', embedKeys: ['title'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['rootMessageKey'], unique: true }, { fields: ['channelKey', 'status'] }] },
  { name: 'messages', embedKeys: ['content'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['threadKey'], sparse: true }, { fields: ['authorParticipantKey'] }, { fields: ['replyToMessageKey'], sparse: true }, { fields: ['channelKey', 'createdAt'] }, { fields: ['threadKey', 'createdAt'], sparse: true }] },
  { name: 'messageMentions', embedKeys: [], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['messageKey'] }, { fields: ['participantKey'] }, { fields: ['participantKey', 'handledAt'] }, { fields: ['messageKey', 'participantKey'], unique: true }] },
  { name: 'userMentions', embedKeys: [], indexes: [{ fields: ['userKey'] }, { fields: ['userKey', 'sourceId'], unique: true }] },
  { name: 'userReactions', embedKeys: [], indexes: [{ fields: ['userKey'] }, { fields: ['userKey', 'reactionSlug'], unique: true }] },
  { name: 'messageReactions', embedKeys: ['reaction'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['messageKey'] }, { fields: ['participantKey'] }, { fields: ['reaction'] }, { fields: ['messageKey', 'reaction'] }, { fields: ['messageKey', 'participantKey', 'reaction'], unique: true }] },
  { name: 'polls', embedKeys: ['question'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['messageKey'], unique: true }, { fields: ['channelKey', 'status'] }] },
  { name: 'pollOptions', embedKeys: ['text'], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['pollKey'] }, { fields: ['pollKey', 'position'], unique: true }] },
  { name: 'pollVotes', embedKeys: [], indexes: [{ fields: ['scopeKey'] }, { fields: ['channelKey'] }, { fields: ['pollKey'] }, { fields: ['optionKey'] }, { fields: ['participantKey'] }, { fields: ['pollKey', 'optionKey', 'participantKey'], unique: true }] },
  { name: 'folders', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'parentFolderKey'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['scopeKey', 'parentFolderKey', 'name'] }, { fields: ['scopeKey', 'purpose'], unique: true, sparse: true }] },
  { name: 'images', embedKeys: ['filename', 'caption', 'placeName', 'placeSummary', 'country', 'city', 'countryCode'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'createdAt'] }, { fields: ['scopeKey', 'latitude', 'longitude'], sparse: true }, { fields: ['imageCaptionKey'], sparse: true }, { fields: ['storageKey'], unique: true }] },
  { name: 'imageCaptions', skipEmbedding: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'hashAlgorithm', 'perceptualHash'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment0'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment1'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment2'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment3'], sparse: true }] },
  { name: 'visualIdentities', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'createdByKey'] }, { fields: ['scopeKey', 'createdByKey', 'name'] }, { fields: ['scopeKey', 'referenceImageKey'] }] },
  { name: 'imageIdentities', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'identityKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'identityKey', 'confidence'] }, { fields: ['scopeKey', 'imageKey'] }, { fields: ['scopeKey', 'imageKey', 'isReference'], sparse: true }] },
  { name: 'galleryUploads', skipEmbedding: true, indexes: [{ fields: ['actorKey', 'createdAt'] }, { fields: ['storageKey'], unique: true }, { fields: ['expiresAt'] }] },
  { name: 'collections', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'name'] }, { fields: ['scopeKey', 'purpose'], unique: true, sparse: true }, { fields: ['scopeKey', 'coverImageKey'], sparse: true }] },
  { name: 'collectionImages', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'collectionKey'] }, { fields: ['scopeKey', 'imageKey'] }] },
  { name: 'placeImages', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'placeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'placeKey', 'position'] }] },
  { name: 'imageCollecitionHightlights', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'createdAt'] }, { fields: ['scopeKey', 'createdByKey'] }] },
  { name: 'imageCollectionMemories', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'createdAt'] }] },
  { name: 'collectionMembers', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'memberKey'], unique: true }, { fields: ['scopeKey', 'collectionKey', 'role'] }, { fields: ['scopeKey', 'memberKey'] }] },
  { name: 'collectionInvites', skipEmbedding: true, indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['scopeKey', 'collectionKey'] }, { fields: ['expiresAt'] }, { fields: ['acceptedAt'], sparse: true }, { fields: ['revokedAt'], sparse: true }] },
  { name: 'tags', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'name'] }] },
  { name: 'tagAssignments', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'tagKey', 'sourceType', 'sourceKey'], unique: true }, { fields: ['scopeKey', 'sourceType', 'sourceKey'] }, { fields: ['scopeKey', 'tagKey'] }] },
  { name: 'documents', embedKeys: ['name', 'content'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'folderKey'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['storageKey'], unique: true, sparse: true }, { fields: ['folderKey', 'name'] }] },
  { name: 'documentVersions', embedKeys: ['label', 'content'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'documentKey'] }, { fields: ['documentKey', 'version'], unique: true }] },
  { name: 'documentAudioVersions', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'documentKey', 'version'], unique: true }, { fields: ['scopeKey', 'documentKey', 'createdAt'] }, { fields: ['scopeKey', 'documentKey', 'isCurrent'] }, { fields: ['storageKey'], unique: true }] },
  // Private immutable generated summaries. Never expose through the generic node registry.
  { name: 'documentSummaries', skipEmbedding: true, indexes: [{ fields: ['documentKey', 'version'], unique: true }, { fields: ['scopeKey', 'documentKey', 'createdAt'] }] },
  // Private one-to-one durable audio for generated summaries.
  { name: 'documentSummaryAudio', skipEmbedding: true, indexes: [{ fields: ['summaryKey'], unique: true }, { fields: ['scopeKey', 'documentKey', 'createdAt'] }, { fields: ['storageKey'], unique: true }] },
  { name: 'shares', skipEmbedding: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'sourceType', 'sourceKey'] }, { fields: ['scopeKey', 'sourceType', 'sourceKey', 'revokedAt'] }, { fields: ['tokenHash'], unique: true }, { fields: ['expiresAt'], sparse: true }] },
  { name: 'places', embedKeys: ['name', 'summary'], indexes: [{ fields: ['scopeKey', 'userKey', 'saved'] }, { fields: ['scopeKey', 'userKey', 'openedAt'], sparse: true }, { fields: ['scopeKey', 'userKey', 'countryCode'] }, { fields: ['scopeKey', 'userKey', 'countryCode', 'name'], unique: true }] },
  { name: 'generatedDocumentBindings', skipEmbedding: true, indexes: [{ fields: ['documentKey'], unique: true }, { fields: ['scopeKey', 'subjectType', 'subjectKey', 'kind', 'createdAt'] }, { fields: ['scopeKey', 'createdByKey', 'idempotencyKey'], unique: true }] },
  // Private Compass persistence. Access is only through the canonical travel service.
  { name: 'trips', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'userKey', 'createdAt'] }, { fields: ['scopeKey', 'coverImageKey'], sparse: true }] },
  { name: 'tripCreationReceipts', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'createdAt'] }, { fields: ['scopeKey', 'tripKey'], unique: true }] },
  { name: 'tripPlaces', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'tripKey', 'position'], unique: true }, { fields: ['scopeKey', 'tripKey', 'placeKey'], unique: true }, { fields: ['scopeKey', 'placeKey'] }] },
  { name: 'tripAttachments', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'tripKey', 'position'], unique: true }, { fields: ['scopeKey', 'tripKey', 'targetType', 'targetKey'], unique: true }, { fields: ['scopeKey', 'targetType', 'targetKey'] }] },
  { name: 'countries', embedKeys: ['name'], indexes: [{ fields: ['countryCode'], unique: true }, { fields: ['name'] }] },
  { name: 'books', embedKeys: ['title', 'subtitle', 'description', 'goal', 'audience', 'outcome'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'status'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['scopeKey', 'generationRequestKey'], unique: true, sparse: true }] },
  { name: 'bookContexts', embedKeys: ['userContext', 'priorKnowledge', 'priorBookContext', 'personalizationContext', 'researchContext', 'noveltyContext', 'generationBrief'], indexes: [{ fields: ['scopeKey', 'bookKey'], unique: true }] },
  { name: 'bookThemes', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }] },
  { name: 'bookSources', embedKeys: ['title', 'content', 'relevance'], indexes: [{ fields: ['scopeKey', 'bookKey'] }, { fields: ['scopeKey', 'bookKey', 'sourceType'] }, { fields: ['scopeKey', 'sourceType', 'sourceKey'], sparse: true }] },
  { name: 'bookParts', embedKeys: ['title', 'description', 'objective'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }] },
  { name: 'bookChapters', embedKeys: ['title', 'description', 'objective', 'topics', 'content'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }, { fields: ['scopeKey', 'partKey'], sparse: true }] },
  { name: 'chapterContexts', embedKeys: ['previousContext', 'objectiveContext', 'sourceContext', 'personalizationContext', 'noveltyContext', 'nextContext', 'generationBrief'], indexes: [{ fields: ['scopeKey', 'chapterKey'], unique: true }] },
  { name: 'bookProgress', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'bookKey', 'chapterKey'], unique: true }, { fields: ['scopeKey', 'userKey', 'bookKey'] }, { fields: ['scopeKey', 'userKey', 'isCompleted'] }] },
  { name: 'emailAccounts', skipEmbedding: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'provider', 'providerAccountId'], unique: true }, { fields: ['scopeKey', 'email'] }, { fields: ['email', 'syncEnabled'] }, { fields: ['syncEnabled', 'watchExpiresAt'] }, { fields: ['scopeKey', 'syncEnabled'] }] },
  { name: 'emailThreads', embedKeys: ['subject', 'summary', 'intent', 'action'], indexes: [{ fields: ['scopeKey', 'accountKey', 'providerThreadId'], unique: true }, { fields: ['scopeKey', 'accountKey', 'lastMessageAt'] }, { fields: ['scopeKey', 'state', 'priority'] }] },
  { name: 'emailMessages', embedKeys: ['subject', 'body', 'summary'], indexes: [{ fields: ['scopeKey', 'accountKey', 'providerMessageId'], unique: true }, { fields: ['scopeKey', 'threadKey', 'sentAt'] }, { fields: ['scopeKey', 'direction', 'sentAt'] }] },
  { name: 'emailContacts', embedKeys: ['name', 'relationship', 'context'], indexes: [{ fields: ['scopeKey', 'email'], unique: true }, { fields: ['scopeKey', 'emailWritingProfileKey'], sparse: true }] },
  { name: 'emailWritingProfiles', embedKeys: ['name', 'description', 'tone', 'style', 'structure', 'vocabulary', 'conventions'], indexes: [{ fields: ['scopeKey', 'name'], unique: true }] },
  { name: 'emailRules', embedKeys: ['name', 'description', 'condition', 'instruction'], indexes: [{ fields: ['scopeKey', 'name'], unique: true }, { fields: ['scopeKey', 'isEnabled', 'action'] }] },
  { name: 'emailReplyDrafts', embedKeys: ['generatedContent', 'finalContent'], indexes: [{ fields: ['scopeKey', 'threadKey'] }, { fields: ['scopeKey', 'messageKey'] }, { fields: ['scopeKey', 'status', 'updatedAt'] }] },
  // Private replay ledger. Responses may contain one-time share tokens, so this
  // collection is deliberately not registered as a generic application node.
  { name: 'contentIdempotency', skipEmbedding: true, indexes: [{ fields: ['organizationKey', 'actorKey', 'tool', 'idempotencyKey'], unique: true }, { fields: ['leaseExpiresAt'], sparse: true }, { fields: ['expiresAt'], sparse: true }] },
  // Private global user history. Identity is deliberately independent of every product and scope.
  { name: 'userSearches', skipEmbedding: true, indexes: [{ fields: ['userKey', 'normalizedQuery'], unique: true }, { fields: ['userKey', 'searchedAt'] }] },
  // Private durable outbox for object deletion after metadata commits.
  { name: 'storageDeletionJobs', skipEmbedding: true, indexes: [{ fields: ['storageKey'], unique: true }, { fields: ['createdAt'] }] },
  // Private Archive contextual replay cache. The collection itself identifies the context.
  { name: 'contentSearchQueries', skipEmbedding: true, indexes: [{ fields: ['actorKey', 'scopeKey', 'normalizedQuery', 'folderKey', 'includeDescendants'], unique: true }, { fields: ['actorKey', 'scopeKey', 'searchedAt'] }] },
  // Pure link nodes (scope tree edges, scope memberships) — ids only, so
];

const droppedCollections = [
  'tasks',
  'milestones',
  'projects',
  'artifactDependencies',
  'artifactSnapshots',
  'artifacts',
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
  'agents',
  'skills',
  'agentSkills',
  'scopeAgents',
  'agentMembers',
  'agentRuns',
  'agentRunSteps',
  'agentRunCalls',
  'agentRunSources',
  'agentArtifacts',
  'agentArtifactChecks',
  'agentMemories',
  'runtimeVariables',
  'capabilities',
  'mindCapabilities',
  'minds',
  'actions',
  'agentArtifactsLegacy',
  'agentRunsLegacy',
  'agent_runs',
  'agentTools',
  'toolActions',
  'tools',
  'templates',
  'placeVisits',
];

async function main() {
  const systemDb = new Database({ url, auth: { username, password } });
  const existingDatabases = await systemDb.listDatabases();
  if (!existingDatabases.includes(databaseName)) {
    await systemDb.createDatabase(databaseName);
    console.log(`Created database ${databaseName}`);
  }
  const targetDb = systemDb.database(databaseName);

  await removeLegacyTombstones(targetDb);
  await migrateGenericContentContracts(targetDb);
  await retireUserSettings(targetDb);
  await migrateModelActionSlugs(targetDb);
  await migrateMinimalPlacesAndRetireTrips(targetDb);
  await migrateTripAttachments(targetDb);

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
  await ensureScopeScopesCollection(targetDb);
  await ensureScopeMembersCollection(targetDb);
  await targetDb.query(`FOR member IN scopeMembers FILTER !HAS(member, "status") UPDATE member WITH { status: "active" } IN scopeMembers`);
  await targetDb.query(`FOR member IN scopeMembers FILTER !HAS(member, "source") UPDATE member WITH { source: "explicit" } IN scopeMembers`);

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
    if (spec.name === 'processedWebhookEvents') {
      await targetDb.query(`
        FOR event IN processedWebhookEvents
          FILTER event.provider == "polar"
          REMOVE event IN processedWebhookEvents
      `);
    }
    if (spec.name === 'folders' || spec.name === 'images' || spec.name === 'collections' || spec.name === 'documents' || spec.name === 'emailThreads') {
      await migrateContentFavorites(targetDb, spec.name);
    }
    if (spec.name === 'images') await targetDb.query('FOR image IN images FILTER !HAS(image, "mutationPolicy") UPDATE image WITH { mutationPolicy: "user" } IN images');
    if (spec.name === 'collections') await targetDb.query('FOR collection IN collections FILTER !HAS(collection, "mutationPolicy") || !HAS(collection, "purpose") UPDATE collection WITH { mutationPolicy: HAS(collection, "mutationPolicy") ? collection.mutationPolicy : "user", purpose: HAS(collection, "purpose") ? collection.purpose : null } IN collections OPTIONS { keepNull: true }');
    if (spec.name === 'tripCreationReceipts') await migrateTripCreationReceipts(targetDb);
    if (spec.name === 'imageCaptions') {
      await migrateImageCaptions(targetDb);
      await migrateExactSemanticRecords(targetDb, 'imageCaptions', ['caption']);
    }
    if (spec.name === 'imageCollectionMemories') {
      await targetDb.query('FOR memory IN imageCollectionMemories SORT memory.createdAt ASC, memory._key ASC COLLECT scopeKey = memory.scopeKey, imageKey = memory.imageKey INTO grouped FOR duplicate IN SLICE(grouped, 1) REMOVE duplicate.memory IN imageCollectionMemories');
      await targetDb.query('FOR memory IN imageCollectionMemories FILTER HAS(memory, "collectionKey") UPDATE memory WITH { collectionKey: null } IN imageCollectionMemories OPTIONS { keepNull: false }');
      for (const index of await collection.indexes()) {
        if (JSON.stringify(index.fields ?? []) === JSON.stringify(['scopeKey', 'collectionKey', 'imageKey'])) await collection.dropIndex(index.id);
      }
    }
    if (spec.name === 'emailMessages') await migrateEmailReplyMetadata(targetDb);
    if (spec.name === 'contentSearchQueries') {
      await targetDb.query('FOR query IN contentSearchQueries FILTER IS_STRING(query.expiresAt) && query.expiresAt <= DATE_ISO8601(DATE_NOW()) && query.output != null UPDATE query WITH { output: null } IN contentSearchQueries');
      await targetDb.query('FOR query IN contentSearchQueries FILTER !HAS(query, "folderKey") || !HAS(query, "includeDescendants") UPDATE query WITH { folderKey: null, includeDescendants: false } IN contentSearchQueries');
      await targetDb.query('FOR query IN contentSearchQueries FILTER !HAS(query, "usageCount") UPDATE query WITH { usageCount: HAS(query, "count") ? query.count : 1 } IN contentSearchQueries');
      const backfill = await targetDb.query<{ userKey: string; query: string; normalizedQuery: string; usageCount: number; searchedAt: string }>(`
        FOR cached IN contentSearchQueries
          FILTER IS_STRING(cached.actorKey) && IS_STRING(cached.query) && IS_STRING(cached.normalizedQuery) && IS_STRING(cached.searchedAt)
          COLLECT userKey = cached.actorKey, normalizedQuery = cached.normalizedQuery
            AGGREGATE usageCount = SUM(cached.usageCount), searchedAt = MAX(cached.searchedAt)
          LET latest = FIRST(FOR candidate IN contentSearchQueries FILTER candidate.actorKey == userKey && candidate.normalizedQuery == normalizedQuery SORT candidate.searchedAt DESC LIMIT 1 RETURN candidate.query)
          RETURN { userKey, query: latest, normalizedQuery, usageCount, searchedAt }
      `);
      for (const search of await backfill.all()) {
        await targetDb.query(`
          UPSERT { userKey: @userKey, normalizedQuery: @normalizedQuery }
            INSERT MERGE(@search, { _key: @key })
            UPDATE {
              query: OLD.searchedAt < @searchedAt ? @query : OLD.query,
              searchedAt: OLD.searchedAt < @searchedAt ? @searchedAt : OLD.searchedAt,
              usageCount: MAX([OLD.usageCount, @usageCount])
            } IN userSearches
        `, { ...search, search, key: newId() });
      }
      for (const index of await collection.indexes()) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (fields.includes('contextDomain')) await collection.dropIndex(index.id);
      }
      await targetDb.query(`
        FOR query IN contentSearchQueries
          SORT query.searchedAt DESC
          COLLECT actorKey = query.actorKey, scopeKey = query.scopeKey, normalizedQuery = query.normalizedQuery, folderKey = query.folderKey, includeDescendants = query.includeDescendants INTO duplicates = query
          FOR duplicate IN SLICE(duplicates, 1)
            REMOVE duplicate IN contentSearchQueries
      `);
      await targetDb.query('FOR query IN contentSearchQueries FILTER HAS(query, "count") UPDATE query WITH { count: null } IN contentSearchQueries OPTIONS { keepNull: false }');
      await targetDb.query('FOR query IN contentSearchQueries FILTER HAS(query, "expiresAt") UPDATE query WITH { expiresAt: null } IN contentSearchQueries OPTIONS { keepNull: false }');
      await targetDb.query('FOR query IN contentSearchQueries UPDATE query WITH { contextDomain: null, usageCount: null } IN contentSearchQueries OPTIONS { keepNull: false }');
    }
    if (spec.name === 'folders') {
      await targetDb.query('FOR folder IN folders FILTER !HAS(folder, "mutationPolicy") UPDATE folder WITH { mutationPolicy: "user" } IN folders');
      await migrateExactSemanticRecords(targetDb, 'folders', ['name', 'description']);
    }
    if (spec.name === 'images') await migrateExactSemanticRecords(targetDb, 'images', ['filename', 'caption']);
    if (spec.name === 'collections') await migrateExactSemanticRecords(targetDb, 'collections', ['name', 'description']);
    if (spec.name === 'tags') await migrateExactSemanticRecords(targetDb, 'tags', ['name', 'description']);
    if (spec.name === 'visualIdentities') await migrateExactSemanticRecords(targetDb, 'visualIdentities', ['name', 'description']);
    if (spec.name === 'collections' || spec.name === 'tags') {
      await targetDb.query(`FOR resource IN @@collection FILTER IS_STRING(resource.description) && LENGTH(TRIM(resource.description)) == 0 UPDATE resource WITH { description: null } IN @@collection OPTIONS { keepNull: false }`, { '@collection': spec.name });
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
    if (spec.name === 'documents') {
      const cursor = await targetDb.query<number>(`
        RETURN LENGTH(
          FOR document IN documents
            FILTER !HAS(document, "scopeKey")
              || ((!HAS(document, "content") || !IS_STRING(document.content) || LENGTH(TRIM(document.content)) == 0)
                && (!HAS(document, "html") || !IS_STRING(document.html) || LENGTH(TRIM(document.html)) == 0))
            RETURN 1
        )
      `);
      const incompatibleDocuments = await cursor.next() ?? 0;
      if (incompatibleDocuments > 0) {
        throw new Error(`Cannot migrate documents: ${incompatibleDocuments} existing row(s) lack required Content ingestion fields.`);
      }
      await migrateContentDocuments(targetDb);
    }
    if (spec.name === 'documentVersions') {
      await migrateContentVersions(targetDb);
    }
    if (spec.name === 'shares') {
      await migrateContentShares(targetDb);
    }
    if (spec.name === 'bookProgress') {
      // Progress created before reader ownership was introduced cannot be
      // assigned safely. Remove those rows and the scope-shared indexes before
      // creating the per-user constraints.
      await targetDb.query('FOR progress IN bookProgress FILTER !HAS(progress, "userKey") REMOVE progress IN bookProgress');
      for (const index of await collection.indexes()) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (fields.join('\0') === ['scopeKey', 'bookKey', 'chapterKey'].join('\0') || fields.join('\0') === ['scopeKey', 'bookKey'].join('\0') || fields.join('\0') === ['scopeKey', 'isCompleted'].join('\0')) {
          await collection.dropIndex(index.id);
          console.log(`Dropped obsolete scope-shared book progress index ${index.id}`);
        }
      }
    }
    const existingIndexes = await collection.indexes();
    for (const index of existingIndexes) {
      const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
      if (isLegacyIndex(spec.name, fields, (spec.indexes ?? []).map((desired) => desired.fields))) {
        await collection.dropIndex(index.id);
        console.log(`Dropped legacy index ${index.id} on ${spec.name}(${fields.join(', ')})`);
      }
    }
    if (spec.name === 'channels') {
      for (const index of await collection.indexes()) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (fields.length === 2 && fields[0] === 'scopeKey' && fields[1] === 'name' && 'unique' in index && index.unique === true) {
          await collection.dropIndex(index.id);
          console.log(`Dropped obsolete unique channel-name index ${index.id}`);
        }
      }
    }
    if (spec.name === 'folders') {
      for (const index of await collection.indexes()) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (fields.join('\0') === ['scopeKey', 'parentFolderKey', 'name'].join('\0') && 'unique' in index && index.unique === true) {
          await collection.dropIndex(index.id);
          console.log(`Dropped obsolete unique folder-name index ${index.id}`);
        }
      }
    }
    if (spec.name === 'imageCaptions') {
      for (const index of await collection.indexes()) {
        const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
        if (fields.join('\0') === ['scopeKey', 'hashAlgorithm', 'perceptualHash'].join('\0') && 'unique' in index && index.unique === true) {
          await collection.dropIndex(index.id);
          console.log(`Dropped obsolete unique image-caption pHash index ${index.id}`);
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

  await migrateGeneratedTravelDocuments(targetDb);

  await targetDb.query(`
    FOR audio IN documentAudioVersions
      FILTER !HAS(audio, "isCurrent") || !HAS(audio, "playbackPositionMs")
      UPDATE audio WITH {
        isCurrent: HAS(audio, "isCurrent") ? audio.isCurrent : false,
        playbackPositionMs: HAS(audio, "playbackPositionMs") ? audio.playbackPositionMs : 0
      } IN documentAudioVersions
  `);

  // Existing users predate country tracking. Sweden is the historical fallback;
  // new web signups provide their detected code.
  await targetDb.query(`
    FOR user IN users
      FILTER !HAS(user, "countryCode") || user.countryCode == null || user.countryCode == ""
      UPDATE user WITH { countryCode: "SE" } IN users
  `);

  // AI-layer collections rename: the first cut shipped snake_case names;
  // every other collection is camelCase plural, so copy the documents
  // across (preserving _key) and retire the legacy collections. Runs
  // BEFORE the ensure* calls below so indexes land on the new names.
  // overwriteMode ignore makes reruns no-ops.
  const aiCollectionRenames: Array<{ legacy: string; current: string }> = [
    { legacy: 'organization_providers', current: 'organizationProviders' },
    { legacy: 'organization_scopes', current: 'organizationScopes' },
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
  await ensureOrganizationConnectorsCollection(targetDb);
  await retireTranscriptionDomain(targetDb);
  await retireAiPersistence(targetDb);

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
        embedding,
      });
    }
    actualScopeKeys.set(seed.key, scopeKey);
  }
  const nexusScopeId = actualScopeKeys.get(NEXUS_SCOPE_KEY);
  if (!nexusScopeId) throw new Error('Cannot resolve canonical Nexus scope');
  const archiveScopeId = actualScopeKeys.get('cmrnlzf650001qc7k4p5zem5w');
  if (!archiveScopeId) throw new Error('Cannot resolve canonical Archive scope');
  await retireMomentumScope(targetDb, rootOrganizationId, archiveScopeId);

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
    });
  }
  const scopeHierarchyCursor = await targetDb.query<{ parentKey: string; childKey: string }>(`
    FOR relation IN scopeScopes
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

  await targetDb.query(`
    FOR u IN users
      FILTER !HAS(u, "is_subscribed_to_updates")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash")
        || !HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at")
        || !HAS(u, "refreshTokenHash")
        || !HAS(u, "refreshTokenExpiresAt")
        || !HAS(u, "lastLoginAt")
        || !HAS(u, "isOnboarded")
        || !HAS(u, "guestBootstrapSecretHash")
        || HAS(u, "waitlistNumber")
        || HAS(u, "isOnWaitlist")
        || HAS(u, "isWaitlistApproved")
        || HAS(u, "events")
      UPDATE u WITH {
        events: null,
        waitlistNumber: null,
        isOnWaitlist: null,
        isWaitlistApproved: null,
        is_subscribed_to_updates: HAS(u, "is_subscribed_to_updates") ? u.is_subscribed_to_updates : (HAS(u, "isSubscribedToNewsletter") ? u.isSubscribedToNewsletter : true),
        is_subscribed_to_updates_unsubscribe_token_hash: HAS(u, "is_subscribed_to_updates_unsubscribe_token_hash") ? u.is_subscribed_to_updates_unsubscribe_token_hash : null,
        is_subscribed_to_updates_unsubscribe_requested_at: HAS(u, "is_subscribed_to_updates_unsubscribe_requested_at") ? u.is_subscribed_to_updates_unsubscribe_requested_at : null,
        refreshTokenHash: HAS(u, "refreshTokenHash") ? u.refreshTokenHash : null,
        refreshTokenExpiresAt: HAS(u, "refreshTokenExpiresAt") ? u.refreshTokenExpiresAt : null,
        lastLoginAt: HAS(u, "lastLoginAt") ? u.lastLoginAt : null,
        isOnboarded: HAS(u, "isOnboarded") ? u.isOnboarded : false,
        guestBootstrapSecretHash: HAS(u, "guestBootstrapSecretHash") ? u.guestBootstrapSecretHash : null
      } IN users OPTIONS { keepNull: false }
  `);

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
  }>(`
    FOR u IN users
      FILTER !HAS(u, "alias") || u.alias == null
        || !HAS(u, "alias_slug") || u.alias_slug == null || u.alias_slug == ""
      SORT u.createdAt ASC
      RETURN { _key: u._key, alias: u.alias, alias_slug: u.alias_slug }
  `);
  const usersMissingAlias = await usersMissingAliasCursor.all();
  for (const user of usersMissingAlias) {
    const patch: Record<string, unknown> = {};
    const alias = user.alias ?? generateAlias(user._key);
    if (user.alias == null) patch.alias = alias;
    if (user.alias_slug == null || user.alias_slug === '') {
      patch.alias_slug = allocateAliasSlug(alias, user._key);
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

  // Canonical memberships are now available. Materialize every active
  // organization member into every organization scope without changing any
  // direct scope role or suspension that was already assigned explicitly.
  const organizationCursor = await targetDb.query<{ key: string }>(`
    FOR organization IN organizations
      RETURN { key: organization._key }
  `);
  let reconciledScopeMemberships = 0;
  for (const organization of await organizationCursor.all()) {
    const reconciliation = await reconcileOrganizationScopeMemberships(organization.key, {}, targetDb);
    reconciledScopeMemberships += reconciliation.created.length;
  }
  console.log(`Reconciled ${reconciledScopeMemberships} organization scope memberships`);

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

  await targetDb.query('FOR thread IN threads FILTER !HAS(thread, "title") || thread.title == null || TRIM(thread.title) == "" UPDATE thread WITH { title: "Thread" } IN threads');

  await targetDb.query('FOR member IN collectionMembers FILTER member.role == "member" || !HAS(member, "role") UPDATE member WITH { role: "collaborator" } IN collectionMembers');
  await targetDb.query('FOR invite IN collectionInvites FILTER !HAS(invite, "role") UPDATE invite WITH { role: "collaborator" } IN collectionInvites');
  await targetDb.query('FOR image IN images FILTER !HAS(image, "createdByKey") UPDATE image WITH { createdByKey: null } IN images');
  await withDatabaseTransaction(targetDb, { write: ['visualIdentities', 'imageIdentities'] }, async (transaction) => {
    await transaction.query('FOR identity IN visualIdentities FILTER !HAS(identity, "createdByKey") || !IS_STRING(identity.createdByKey) || LENGTH(TRIM(identity.createdByKey)) == 0 LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && IS_STRING(reference.createdByKey) && LENGTH(TRIM(reference.createdByKey)) > 0 UPDATE identity WITH { createdByKey: reference.createdByKey } IN visualIdentities');
    await transaction.query('FOR relation IN imageIdentities LET identity = DOCUMENT(visualIdentities, relation.identityKey) FILTER identity != null && (!HAS(identity, "createdByKey") || !IS_STRING(identity.createdByKey) || LENGTH(TRIM(identity.createdByKey)) == 0) REMOVE relation IN imageIdentities');
    await transaction.query('FOR identity IN visualIdentities FILTER !HAS(identity, "createdByKey") || !IS_STRING(identity.createdByKey) || LENGTH(TRIM(identity.createdByKey)) == 0 REMOVE identity IN visualIdentities');
  });
  await targetDb.query('FOR share IN shares FILTER share.sourceType == "collection" && share.permission IN ["read", "comment"] UPDATE share WITH { permission: share.permission == "comment" ? "collaborator" : "viewer" } IN shares');

  // Retire the private per-orchestrator conversations. Their messages and all
  // dependent communication records must disappear with the channels so they
  // cannot be read through the shared #general channel implementation.
  const directChannelCursor = await targetDb.query<{ key: string }>('FOR channel IN channels FILTER channel.kind == "direct" RETURN { key: channel._key }');
  const directChannelKeys = (await directChannelCursor.all()).map(({ key }) => key);
  for (const collection of ['messageMentions', 'messageReactions', 'pollVotes', 'pollOptions', 'polls', 'threads', 'messages', 'channelParticipants']) {
    await targetDb.query(`FOR document IN ${collection} FILTER document.channelKey IN @channelKeys REMOVE document IN ${collection}`, { channelKeys: directChannelKeys });
  }
  await targetDb.query('FOR channel IN channels FILTER channel._key IN @channelKeys REMOVE channel IN channels', { channelKeys: directChannelKeys });
  await targetDb.query(`
    FOR channel IN channels
      FILTER channel.kind == "group" && channel.name == "general" && !HAS(channel, "organizationKey")
      LET scope = DOCUMENT(scopes, channel.scopeKey)
      FILTER scope != null
      UPDATE channel WITH { organizationKey: scope.organizationKey } IN channels
  `);

  // Retire collections whose data is no longer part of the platform. The
  // organization-era collections below have already been copied above.
  for (const retiredCollectionName of [
    'userEvents',
    'intelligenceFragments',
    'userWaitlistLeaderboardChanges',
    'products',
    'paymentCheckouts',
    'paymentOrders',
    'subscriptions',
    'userEntitlements',
    'platforms',
    'teams',
    'teamMembers',
    'teamMemberInvites',
    'organizationMembers',
    'user_organization',
  ]) {
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
