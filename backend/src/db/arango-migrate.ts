import 'dotenv/config';
import { createHash } from 'node:crypto';
import { Database } from 'arangojs';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER_ID, LEGACY_EMBEDDING_DIMENSIONS, embedText, embedTexts, embeddingMetadata } from '../lib/embeddings';
import { ALIAS_SLUG_PREFIX_SPACE, generateAlias, generateAliasSlug } from '../lib/alias';
import { newId } from '../lib/ids';
import { ensureOrganizationConnectorsCollection } from '../lib/email-inbox/indexes';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from '../lib/ai/scopes/indexes';
import { reconcileOrganizationScopeMemberships } from '../lib/ai/scopes/membership-invariant';
import { buildEmbeddingText, toArangoDoc, withArangoKey } from '../lib/db/base';
import { NEXUS_SCOPE_KEY, SEEDED_SCOPES } from '../lib/db/seed';
import { isLegacyIndex, LEGACY_REMOVAL_MARKER } from './arango-migrate-indexes';
import { stageLegacyDocumentShares } from './content-migration';
import { htmlToPlainText } from '../lib/ai/document-processing/representation';
import { chunkDocumentContent, chunkDocumentText, documentEmbeddingTexts, documentSemanticHash } from '../lib/ai/document-processing/chunking';
import { z } from 'zod';
import { withDatabaseTransaction } from '../lib/db/client';
import { countryCodeSchema } from '../lib/db/users.node';
import { buildPlaceEmbeddingText, buildTripEmbeddingText, TRIP_EMBEDDING_CONTENT_VERSION } from '../lib/travel/semantic-text';
import { generatedPlaceDetailSchema } from '../lib/db/places.node';
import { isProviderError, type ProviderError } from '../lib/ai/providers/errors';
import { buildImageEmbeddingText } from '../lib/image-embedding';
import { decodeEmailTone, decodeEmailToneContent, emailMessageSemanticText, emailToneSemanticText, encodeEmailToneContent, legacyEmailArchiveContent } from '../lib/email-inbox/archive-payloads';
import { bookGenerationInputSchema } from '../lib/books/schemas';
import { LEGACY_BOOK_CHAPTER_WORD_MAX, LEGACY_BOOK_CHAPTER_WORD_MIN } from '../lib/db/book-chapters.node';
import { emailArchiveRootFolderKey, emailMediaCollectionKey } from '../lib/email-inbox/export-container-keys';
import { APP_KEYS, seedApps } from '../lib/apps/registry';
import { createAppsRepository } from '../lib/db/apps.node';

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

export const LEGACY_EVENT_APP_KEYS = {
  archive: APP_KEYS.ARCHIVE,
  gallery: APP_KEYS.GALLERY,
  compass: APP_KEYS.COMPASS,
  signal: APP_KEYS.SIGNAL,
  ascend: APP_KEYS.ASCEND,
  core: APP_KEYS.CORE,
} as const;

export async function migrateEventAppKeys(targetDb: Pick<Database, 'query'>): Promise<void> {
  await targetDb.query(`
    FOR event IN events
      LET mappedAppKey = event.domain == "archive" ? @archiveKey
        : event.domain == "gallery" ? @galleryKey
        : event.domain == "compass" ? @compassKey
        : event.domain == "signal" ? @signalKey
        : event.domain == "ascend" ? @ascendKey
        : event.domain == "core" ? @coreKey
        : null
      LET appKey = HAS(event, "domain") ? mappedAppKey : event.appKey
      LET app = IS_STRING(appKey) ? DOCUMENT(apps, appKey) : null
      LET scopeKey = HAS(event, "scopeKey") ? event.scopeKey : event.scopeId
      LET scope = IS_STRING(scopeKey) ? DOCUMENT(scopes, scopeKey) : null
      FILTER app == null
        OR !HAS(event, "userId")
        OR scope == null
        OR !IS_STRING(event.slug)
        OR !REGEX_TEST(event.slug, "^[a-z][a-z0-9-]*(\\\\.[a-z][a-z0-9-]*)+$")
        OR HAS(event, "distinctId")
        OR HAS(event, "data")
        OR HAS(event, "embedding")
      REMOVE event IN events
  `, Object.fromEntries(Object.entries(LEGACY_EVENT_APP_KEYS).map(([domain, key]) => [`${domain}Key`, key])));
  await targetDb.query(`
    FOR event IN events
      LET mappedAppKey = event.domain == "archive" ? @archiveKey
        : event.domain == "gallery" ? @galleryKey
        : event.domain == "compass" ? @compassKey
        : event.domain == "signal" ? @signalKey
        : event.domain == "ascend" ? @ascendKey
        : event.domain == "core" ? @coreKey
        : null
      LET appKey = HAS(event, "domain") ? mappedAppKey : event.appKey
      LET scopeKey = HAS(event, "scopeKey") ? event.scopeKey : event.scopeId
      UPDATE event WITH {
        appKey,
        scopeKey,
        status: event.status IN ["completed", "failed"] ? event.status : "completed",
        microSparks: IS_NUMBER(event.microSparks) && event.microSparks >= 0 ? FLOOR(event.microSparks) : (IS_NUMBER(event.sparks) && event.sparks >= 0 ? FLOOR(event.sparks * 1000000) : 0),
        sparkTransactionKey: IS_STRING(event.sparkTransactionKey) ? event.sparkTransactionKey : null,
        domain: null,
        scopeId: null,
        sparks: null
      } IN events OPTIONS { keepNull: false }
  `, Object.fromEntries(Object.entries(LEGACY_EVENT_APP_KEYS).map(([domain, key]) => [`${domain}Key`, key])));
}

export async function migrateUserCurrentScopes(targetDb: Pick<Database, 'query'>): Promise<void> {
  const cursor = await targetDb.query<{ key: string; name?: string | null; email: string }>(`
    FOR user IN users
      RETURN { key: user._key, name: user.name, email: user.email }
  `);
  for (const user of await cursor.all()) {
    const now = new Date().toISOString();
    const fallbackName = user.email.split('@')[0]?.trim() || 'Personal';
    const organizationName = `${user.name?.trim() || fallbackName}'s Organization`;
    await targetDb.query(`
      LET user = DOCUMENT(users, @userKey)
      FILTER user != null
      LET selectedScope = IS_STRING(user.currentScopeKey) ? DOCUMENT(scopes, user.currentScopeKey) : null
      UPSERT { personalOwnerUserId: @userKey }
        INSERT {
          _key: @organizationKey, personalOwnerUserId: @userKey, name: @organizationName,
          is_root: false, slug: @organizationSlug, description: null, isActive: true,
          mfa_enabled: false, metadata: {}, createdAt: @now, updatedAt: @now, embedding: []
        }
        UPDATE { isActive: true, updatedAt: @now } IN organizations
      LET organization = NEW
      UPSERT { organizationId: organization._key, userId: @userKey }
        INSERT {
          _key: @membershipKey, organizationId: organization._key, userId: @userKey,
          orgRole: "owner", orgTitle: "Owner", orchestratorKey: null, status: "active",
          joinedAt: @now, isMfaEnabled: false, totpSecret: null, lastTotpTimeStep: null,
          mfaVersion: 0, mfaRecoveryPending: false, createdAt: @now, updatedAt: @now, embedding: []
        }
        UPDATE { orgRole: "owner", status: "active", updatedAt: @now } IN userOrganizations
      LET membership = NEW
      UPSERT { organizationKey: organization._key, slug: "main" }
        INSERT {
          _key: @scopeKey, organizationKey: organization._key, slug: "main", name: "Main",
          summary: "Main personal workspace", description: "Main personal workspace",
          position: 1, level: 1, embedding: []
        }
        UPDATE {} IN scopes
      LET scope = NEW
      UPSERT { scopeKey: scope._key, userOrganizationKey: membership._key }
        INSERT {
          _key: @scopeMembershipKey, scopeKey: scope._key, userOrganizationKey: membership._key,
          role: "owner", status: "active", source: "explicit"
        }
        UPDATE { role: "owner", status: "active" } IN scopeMembers
      UPDATE user WITH {
        currentScopeKey: selectedScope == null ? scope._key : selectedScope._key,
        updatedAt: @now
      } IN users
    `, {
      userKey: user.key,
      organizationKey: newId(),
      organizationName,
      organizationSlug: `personal-${user.key}`,
      membershipKey: newId(),
      scopeKey: newId(),
      scopeMembershipKey: newId(),
      now,
    });
  }
}

export async function migrateSparkAccounts(targetDb: Pick<Database, 'query'>): Promise<void> {
  const cursor = await targetDb.query<{ key: string; currentScopeKey: string }>(`
    FOR user IN users
      FILTER IS_STRING(user.currentScopeKey)
      RETURN { key: user._key, currentScopeKey: user.currentScopeKey }
  `);
  for (const user of await cursor.all()) {
    const transactionKey = newId();
    const eventKey = newId();
    const now = new Date().toISOString();
    await targetDb.query(`
      LET user = DOCUMENT(users, @userKey)
      FILTER user != null
      LET existing = FIRST(FOR item IN sparkTransactions FILTER item.userKey == @userKey && item.idempotencyKey == "account-grant:v1" LIMIT 1 RETURN item)
      LET priorBalance = MAX([0, SUM(FOR item IN sparkTransactions FILTER item.userKey == @userKey RETURN item.deltaMicroSparks)])
      LET appliedEventKey = existing == null ? @eventKey : existing.eventKey
      LET analytics = DOCUMENT(events, appliedEventKey)
      LET applied = existing == null ? FIRST(
        INSERT {
          _key: @transactionKey,
          userKey: @userKey,
          kind: "account-grant",
          deltaMicroSparks: 50000000,
          balanceAfterMicroSparks: priorBalance + 50000000,
          idempotencyKey: "account-grant:v1",
          requestHash: "account-grant:v1:50-sparks",
          eventKey: appliedEventKey,
          createdAt: @now
        } INTO sparkTransactions
        RETURN NEW
      ) : existing
      LET balance = priorBalance + (existing == null ? 50000000 : 0)
      UPDATE user WITH { microSparkBalance: balance } IN users
      LET insertedEvent = analytics == null ? FIRST(
        INSERT {
          _key: appliedEventKey,
          userId: @userKey,
          scopeKey: @scopeKey,
          slug: "account.created",
          appKey: @appKey,
          status: "completed",
          microSparks: 50000000,
          sparkTransactionKey: applied._key,
          createdAt: @now
        } INTO events
        RETURN NEW
      ) : analytics
      RETURN { transaction: applied._key, event: insertedEvent._key, balance }
    `, { userKey: user.key, scopeKey: user.currentScopeKey, transactionKey, eventKey, appKey: APP_KEYS.CORE, now });
  }
}

export async function migrateInboxBilling(targetDb: Pick<Database, 'query'>, goLiveAt = new Date().toISOString()): Promise<void> {
  const timestamp = z.string().datetime().parse(goLiveAt);
  await targetDb.query(`
    FOR connector IN organizationConnectors
      FILTER connector.provider == "gmail"
      LET membership = DOCUMENT(userOrganizations, connector.createdByMembershipKey)
      LET user = membership == null ? null : DOCUMENT(users, membership.userId)
      LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == connector.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
      LET lifecycleActive = connector.status == "active" && connector.syncEnabled == true
      LET ownershipValid = membership != null && membership.status == "active" && membership.organizationId == connector.organizationKey && user != null && scopeMembership != null
      LET payerValid = connector.billingUserKey == null || (ownershipValid && connector.billingUserKey == user._key)
      LET eligible = lifecycleActive && ownershipValid && payerValid
      LET openPeriods = (FOR period IN inboxBillingPeriods FILTER period.connectorKey == connector._key && period.endedAt == null SORT period.startedAt DESC, period._key ASC RETURN period)
      LET canonicalPeriod = eligible ? FIRST(FOR period IN openPeriods FILTER period.billingVersion == 1 && period.userKey == user._key && period.organizationKey == connector.organizationKey && period.scopeKey == connector.scopeKey && period.startedAt <= @goLiveAt LIMIT 1 RETURN period) : null
      FOR period IN openPeriods
        FILTER canonicalPeriod == null || period._key != canonicalPeriod._key
        UPDATE period WITH { endedAt: period.startedAt } IN inboxBillingPeriods
  `, { goLiveAt: timestamp });
  await targetDb.query(`
    FOR connector IN organizationConnectors
      FILTER connector.provider == "gmail" && connector.status == "active" && connector.syncEnabled == true
      LET membership = DOCUMENT(userOrganizations, connector.createdByMembershipKey)
      LET user = membership == null ? null : DOCUMENT(users, membership.userId)
      LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == connector.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
      LET ownershipValid = membership != null && membership.status == "active" && membership.organizationId == connector.organizationKey && user != null && scopeMembership != null
      FILTER ownershipValid && (connector.billingUserKey == null || connector.billingUserKey == user._key)
      LET canonicalPeriod = FIRST(FOR period IN inboxBillingPeriods FILTER period.connectorKey == connector._key && period.endedAt == null && period.billingVersion == 1 && period.userKey == user._key && period.organizationKey == connector.organizationKey && period.scopeKey == connector.scopeKey && period.startedAt <= @goLiveAt SORT period.startedAt DESC, period._key ASC LIMIT 1 RETURN period)
      LET periodKey = SHA256(CONCAT("inbox-period\\u0000", connector._key, "\\u0000", @goLiveAt))
      LET insertedPeriod = canonicalPeriod == null ? FIRST(INSERT { _key: periodKey, billingVersion: 1, connectorKey: connector._key, userKey: user._key, organizationKey: connector.organizationKey, scopeKey: connector.scopeKey, startedAt: @goLiveAt } INTO inboxBillingPeriods RETURN NEW) : canonicalPeriod
      LET validPeriod = canonicalPeriod == null ? insertedPeriod : canonicalPeriod
      UPDATE connector WITH { billingUserKey: user._key, billingStatus: "funded", billingPeriodStartedAt: validPeriod.startedAt } IN organizationConnectors
  `, { goLiveAt: timestamp });
  await targetDb.query(`
    FOR connector IN organizationConnectors
      FILTER connector.provider == "gmail"
      LET membership = DOCUMENT(userOrganizations, connector.createdByMembershipKey)
      LET user = membership == null ? null : DOCUMENT(users, membership.userId)
      LET scopeMembership = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == connector.scopeKey && item.userOrganizationKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
      LET lifecycleActive = connector.status == "active" && connector.syncEnabled == true
      LET ownershipValid = membership != null && membership.status == "active" && membership.organizationId == connector.organizationKey && user != null && scopeMembership != null
      LET eligible = lifecycleActive && ownershipValid && (connector.billingUserKey == null || connector.billingUserKey == user._key)
      FILTER !eligible
      UPDATE connector WITH (lifecycleActive
        ? { billingStatus: "unfunded", syncEnabled: false, syncStatus: "idle", status: "error", lastError: "Connected inbox billing owner is unavailable", syncLeaseToken: null, syncLeaseExpiresAt: null, sendLeaseToken: null, sendLeaseExpiresAt: null, updatedAt: @goLiveAt }
        : { billingStatus: "disabled", syncEnabled: false, syncStatus: "idle", syncLeaseToken: null, syncLeaseExpiresAt: null, sendLeaseToken: null, sendLeaseExpiresAt: null, updatedAt: @goLiveAt })
      IN organizationConnectors OPTIONS { keepNull: false }
  `, { goLiveAt: timestamp });
}

export async function migrateTicketTypes(targetDb: Pick<Database, 'query'>): Promise<void> {
  await targetDb.query(`
    FOR ticket IN tickets
      FILTER !HAS(ticket, "type") || (ticket.type == "feedback" && (!HAS(ticket, "upvotes") || !HAS(ticket, "downvotes")))
      UPDATE ticket WITH {
        type: HAS(ticket, "type") ? ticket.type : "issue",
        upvotes: ticket.type == "feedback" ? (HAS(ticket, "upvotes") && IS_NUMBER(ticket.upvotes) && ticket.upvotes >= 0 ? ticket.upvotes : 0) : null,
        downvotes: ticket.type == "feedback" ? (HAS(ticket, "downvotes") && IS_NUMBER(ticket.downvotes) && ticket.downvotes >= 0 ? ticket.downvotes : 0) : null
      } IN tickets OPTIONS { keepNull: false }
  `);
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

/** Repairs app-logo presentation metadata on containers created before that field existed. */
export async function migrateContainerPresentations(targetDb: Database): Promise<void> {
  const emailContainerCursor = await targetDb.query<{ scopeKey: string; connectorKey: string }>(`
    FOR inbox IN emailInboxes
      FILTER IS_STRING(inbox.scopeKey) && IS_STRING(inbox.connectorKey)
      COLLECT scopeKey = inbox.scopeKey, connectorKey = inbox.connectorKey
      RETURN { scopeKey, connectorKey }
  `);
  const emailContainers = await emailContainerCursor.all();
  const communicationFolderKeys = [...new Set(emailContainers.map(({ scopeKey }) => emailArchiveRootFolderKey(scopeKey)))];
  const communicationCollectionKeys = [...new Set(emailContainers.map(({ scopeKey }) => emailMediaCollectionKey(scopeKey)))];
  await targetDb.query(`
    FOR folder IN folders
      LET presentation = folder.parentFolderKey != null ? null
        : folder.presentation IN ["travel", "communication", "learning"] ? folder.presentation
        : folder._key IN @communicationFolderKeys ? "communication"
        : folder.purpose IN ["generated-documents-root", "generated-documents-guide", "generated-documents-brief", "generated-documents-accommodations", "generated-documents-restaurants", "generated-documents-activities"] ? "travel"
        : folder.purpose IN ["communication-mail-root", "communication-mail-inboxes", "communication-mail-threads", "communication-mail-drafts", "communication-mail-tones", "communication-mail-reply-context"] || STARTS_WITH(folder.managedPurpose || "", "mail-") ? "communication"
        : folder.purpose == "generated-audio-root" ? "learning"
        : null
      FILTER (presentation != null && folder.presentation != presentation) || (presentation == null && HAS(folder, "presentation"))
      UPDATE folder WITH { presentation } IN folders OPTIONS { keepNull: false }
  `, { communicationFolderKeys });
  await targetDb.query(`
    FOR collection IN collections
      LET presentation = collection.presentation IN ["travel", "communication", "learning"] ? collection.presentation
        : collection._key IN @communicationCollectionKeys ? "communication"
        : collection.purpose == "place-media" ? "travel"
        : collection.purpose == "email-media" ? "communication"
        : null
      FILTER presentation != null && collection.presentation != presentation
      UPDATE collection WITH { presentation } IN collections
  `, { communicationCollectionKeys });
}

/** Restores managed collection semantics without overwriting a user-renamed Core collection. */
export async function migrateManagedGeneratedMedia(targetDb: Database): Promise<void> {
  await targetDb.query('FOR collection IN collections FILTER collection.purpose == "generated-media" && collection.name == "Generated media" UPDATE collection WITH { name: "Core" } IN collections');
  await targetDb.query('FOR collection IN collections FILTER collection.purpose == "generated-media" && collection.mutationPolicy != "system-only" UPDATE collection WITH { mutationPolicy: "system-only" } IN collections');
  await targetDb.query('FOR imageKey IN UNIQUE(FOR relation IN collectionImages LET collection = DOCUMENT(collections, relation.collectionKey) FILTER collection != null && collection.purpose == "generated-media" RETURN relation.imageKey) LET image = DOCUMENT(images, imageKey) FILTER image != null && image.origin == "generated" && image.mutationPolicy == "system-only" UPDATE image WITH { mutationPolicy: "user" } IN images');
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
  return Array.isArray(value) && value.length === chunkCount && value.every((embedding) => isCurrentVector(embedding) && embedding.some((item) => item !== 0)) ? value : null;
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

export async function migrateContentFavorites(targetDb: Database, collectionName: 'folders' | 'documents' | 'images' | 'collections') {
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
  await targetDb.query('FOR guide IN tripGuides FILTER !HAS(guide, "content") && IS_STRING(guide.summary) UPDATE guide WITH { content: guide.summary, contentChunks: [guide.summary], chunkEmbeddings: [guide.embedding], semanticChunkCount: 1, semanticContentHash: SHA256(guide.summary), idempotencyKey: CONCAT("migration:", guide._key), updatedAt: guide.createdAt, summary: null } IN tripGuides OPTIONS { keepNull: false }');
  await targetDb.query(`FOR binding IN generatedDocumentBindings FILTER binding.subjectType == "trip" && binding.kind == "guide"
    LET document = DOCUMENT(documents, binding.documentKey) LET trip = DOCUMENT(trips, binding.subjectKey)
    FILTER document != null && trip != null && document.scopeKey == binding.scopeKey && trip.scopeKey == binding.scopeKey
    LET value = { _key: binding._key, scopeKey: binding.scopeKey, userKey: binding.createdByKey, tripKey: binding.subjectKey, name: document.name, content: document.content, embedding: document.embedding, contentChunks: document.contentChunks || [document.content], chunkEmbeddings: document.chunkEmbeddings || [document.embedding], semanticChunkCount: document.semanticChunkCount || 1, semanticContentHash: document.semanticContentHash || SHA256(document.content), idempotencyKey: binding.idempotencyKey, requestHash: binding.requestHash, createdAt: binding.createdAt, updatedAt: binding.updatedAt }
    UPSERT { _key: binding._key } INSERT value UPDATE {} IN tripGuides`);
  await targetDb.query(`FOR binding IN generatedDocumentBindings FILTER binding.subjectType == "place" && binding.kind IN ["brief", "accommodations", "restaurants", "activities"]
    LET document = DOCUMENT(documents, binding.documentKey) LET place = DOCUMENT(places, binding.subjectKey)
    FILTER document != null && place != null && document.scopeKey == binding.scopeKey && place.scopeKey == binding.scopeKey
    LET value = { _key: binding._key, scopeKey: binding.scopeKey, userKey: binding.createdByKey, placeKey: binding.subjectKey, kind: binding.kind, name: document.name, content: document.content, embedding: document.embedding, contentChunks: document.contentChunks || [document.content], chunkEmbeddings: document.chunkEmbeddings || [document.embedding], semanticChunkCount: document.semanticChunkCount || 1, semanticContentHash: document.semanticContentHash || SHA256(document.content), idempotencyKey: binding.idempotencyKey, requestHash: binding.requestHash, createdAt: binding.createdAt, updatedAt: binding.updatedAt }
    UPSERT { _key: binding._key } INSERT value UPDATE {} IN placeReferences`);
  if (await targetDb.collection('placeReports').exists()) await targetDb.query(`FOR report IN placeReports
    LET value = { _key: report._key, scopeKey: report.scopeKey, userKey: report.userKey, placeKey: report.placeKey, kind: "brief", name: report.name, content: report.summary, embedding: report.embedding, contentChunks: [report.summary], chunkEmbeddings: [report.embedding], semanticChunkCount: 1, semanticContentHash: SHA256(report.summary), idempotencyKey: CONCAT("migration:", report._key), requestHash: report.requestHash, createdAt: report.createdAt, updatedAt: report.createdAt }
    UPSERT { _key: report._key } INSERT value UPDATE {} IN placeReferences`);
  for (const collectionName of ['tripGuides', 'placeReferences'] as const) {
    const records = await (await targetDb.query<Record<string, unknown>>(`FOR record IN ${collectionName} RETURN record`)).all();
    for (const record of records) {
      if (typeof record._key !== 'string' || typeof record.name !== 'string' || typeof record.content !== 'string') continue;
      const contentChunks = migrationContentChunks(record.content);
      if (!contentChunks?.length) continue;
      const semanticContentHash = documentSemanticHash(record.content);
      const existingChunks = record.contentChunks;
      const chunksCurrent = Array.isArray(existingChunks) && existingChunks.length === contentChunks.length && existingChunks.every((chunk, index) => chunk === contentChunks[index]);
      const chunkEmbeddings = currentChunkEmbeddings(record.chunkEmbeddings, contentChunks.length);
      if (chunksCurrent && chunkEmbeddings && isCurrentVector(record.embedding) && record.embedding.some((item) => item !== 0) && record.semanticChunkCount === contentChunks.length && record.semanticContentHash === semanticContentHash) continue;
      const embeddings = await generateEmbeddings(documentEmbeddingTexts(record.name, contentChunks));
      await targetDb.query(`UPDATE @key WITH { embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash } IN ${collectionName}`, { key: record._key, embedding: embeddings[0], contentChunks, chunkEmbeddings: embeddings, semanticChunkCount: contentChunks.length, semanticContentHash });
    }
    const invalid = await (await targetDb.query<number>(`RETURN LENGTH(FOR record IN ${collectionName} FILTER !IS_ARRAY(record.embedding) || LENGTH(record.embedding) != @dimensions || LENGTH(record.embedding[* FILTER CURRENT != 0]) == 0 || !IS_ARRAY(record.chunkEmbeddings) || LENGTH(record.chunkEmbeddings) != record.semanticChunkCount || LENGTH(record.chunkEmbeddings[* FILTER !IS_ARRAY(CURRENT) || LENGTH(CURRENT) != @dimensions || LENGTH(CURRENT[* FILTER CURRENT != 0]) == 0]) > 0 || !IS_ARRAY(record.contentChunks) || LENGTH(record.contentChunks) != record.semanticChunkCount RETURN 1)`, { dimensions: EMBEDDING_DIMENSIONS })).next() ?? 0;
    if (invalid > 0) throw new Error(`${collectionName} semantic migration failed for ${invalid} row(s).`);
  }
  await targetDb.query(`FOR place IN places FILTER IS_STRING(place.coverImageKey)
    LET image = DOCUMENT(images, place.coverImageKey) FILTER image != null && image.scopeKey == place.scopeKey && IS_STRING(image.storageKey)
    LET value = { _key: CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "place-hero-media", place.scopeKey, place.userKey, place._key)), 24)), scopeKey: place.scopeKey, userKey: place.userKey, placeKey: place._key, storageKey: image.storageKey, contentHash: SHA256(image.storageKey), mimeType: "image/png", sizeBytes: image.sizeBytes, width: 1536, height: 1024, createdAt: image.createdAt, updatedAt: image.updatedAt }
    UPSERT { scopeKey: place.scopeKey, userKey: place.userKey, placeKey: place._key } INSERT value UPDATE {} IN placeHeroMedia`);
  await targetDb.query('FOR folder IN folders FILTER STARTS_WITH(folder.purpose || "", "generated-documents-") UPDATE folder WITH { purpose: null, managedPurpose: null, managedOwnerKey: null, mutationPolicy: "user" } IN folders OPTIONS { keepNull: false }');
}

export async function migrateEmailInitialSyncCompletion(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('organizationConnectors').exists()) return;
  await targetDb.query(`FOR connector IN organizationConnectors
    FILTER connector.provider == "gmail" && !HAS(connector, "initialSyncCompleted")
    UPDATE connector WITH { initialSyncCompleted: HAS(connector, "lastSyncedAt") } IN organizationConnectors`);
}

/** Restores private Signal rows from the managed Archive/Gallery representation shipped by the previous migration. */
export async function migrateCanonicalEmailPersistence(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('documents').exists()) return;
  await targetDb.query(`FOR folder IN folders FILTER folder.managedPurpose == "mail-inbox" && IS_STRING(folder.managedOwnerKey)
    LET connector = DOCUMENT(organizationConnectors, folder.managedOwnerKey) FILTER connector != null && connector.scopeKey == folder.scopeKey
    LET value = { _key: folder._key, organizationKey: connector.organizationKey, scopeKey: folder.scopeKey, connectorKey: connector._key, name: folder.name, description: folder.description, coverImageKey: folder.coverImageKey, isFavorite: folder.isFavorite || false, embedding: folder.embedding, createdAt: folder.createdAt, updatedAt: folder.updatedAt }
    UPSERT { _key: folder._key } INSERT value UPDATE {} IN emailInboxes OPTIONS { keepNull: false }`);
  await targetDb.query('FOR inbox IN emailInboxes FILTER inbox.description == null || inbox.coverImageKey == null UPDATE inbox WITH { description: inbox.description, coverImageKey: inbox.coverImageKey } IN emailInboxes OPTIONS { keepNull: false }');
  const records = [
    { kind: 'mail-thread', collection: 'emailThreads' },
    { kind: 'mail-message', collection: 'emailMessages' },
    { kind: 'mail-reply-draft', collection: 'emailDrafts' },
    { kind: 'mail-new-draft', collection: 'emailDrafts' },
    { kind: 'mail-reply-context', collection: 'emailReplyContext' },
    { kind: 'mail-writing-profile', collection: 'emailWritingProfiles' },
  ] as const;
  for (const { kind, collection } of records) await targetDb.query(`FOR document IN documents FILTER document.mutationPolicy == "system-only" && IS_STRING(document.content) LET payload = JSON_PARSE(document.content) FILTER payload != null && payload.version == 1 && payload.kind == @kind LET targetKey = @kind == "mail-thread" ? CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "mail-thread", document.scopeKey, payload.data.accountKey, payload.data.providerThreadId)), 24)) : @kind == "mail-message" ? CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "mail-message", document.scopeKey, payload.data.accountKey, payload.data.providerMessageId)), 24)) : document._key LET value = MERGE(payload.data, { _key: targetKey, scopeKey: document.scopeKey, embedding: document.embedding, developmentFixtureIdentifier: document.developmentFixtureIdentifier, createdAt: document.createdAt, updatedAt: document.updatedAt }) UPSERT { _key: targetKey } INSERT value UPDATE {} IN @@collection OPTIONS { keepNull: false }`, { kind, '@collection': collection });
  const toneDocuments = await (await targetDb.query<Record<string, unknown>>('FOR document IN documents FILTER IS_STRING(document.content) LET payload = JSON_PARSE(document.content) FILTER payload != null && payload.version == 1 && payload.kind == "mail-tone" || CONTAINS(document.content, "<!-- vorinthex-mail-tone ") RETURN document')).all();
  for (const raw of toneDocuments) {
    try {
      const document = withArangoKey(raw);
      if (!isCanonicalEmailToneDocument(document)) continue;
      const tone = decodeEmailTone(document);
      await targetDb.query('UPSERT { _key: @key } INSERT @value UPDATE {} IN emailTones', { key: tone.key, value: toArangoDoc(tone) });
    } catch { /* Unrelated or malformed ordinary Archive documents remain untouched. */ }
  }
  for (const collection of ['emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles']) await targetDb.query('FOR value IN @@collection FILTER value.developmentFixtureIdentifier == null UPDATE value WITH { developmentFixtureIdentifier: null } IN @@collection OPTIONS { keepNull: false }', { '@collection': collection });
  if (await targetDb.collection('emailAttachmentBindings').exists()) await targetDb.query(`FOR binding IN emailAttachmentBindings
    LET target = binding.targetType == "document" ? DOCUMENT(documents, binding.targetKey) : DOCUMENT(images, binding.targetKey)
    LET storageKey = target != null ? target.storageKey : null
    FILTER binding.status != "completed" || IS_STRING(storageKey)
    LET value = { _key: binding._key, organizationKey: binding.organizationKey, scopeKey: binding.scopeKey, connectorKey: binding.connectorKey, providerMessageId: binding.providerMessageId, partPath: binding.partPath, contentHash: binding.contentHash, kind: binding.targetType, filename: binding.sourceFilename, mimeType: binding.sourceMimeType, sizeBytes: binding.sourceSize, storageKey, status: binding.status, leaseToken: binding.leaseToken, leaseExpiresAt: binding.leaseExpiresAt, archiveDocumentKey: binding.targetType == "document" ? binding.targetKey : null, galleryImageKey: binding.targetType == "image" ? binding.targetKey : null, createdAt: binding.createdAt, updatedAt: binding.updatedAt }
    UPSERT { _key: binding._key } INSERT value UPDATE {} IN emailAttachments OPTIONS { keepNull: false }`);
  await targetDb.query('FOR document IN documents FILTER document.mutationPolicy == "system-only" && IS_STRING(document.content) LET payload = JSON_PARSE(document.content) FILTER payload != null && STARTS_WITH(payload.kind || "", "mail-") UPDATE document WITH { managedPurpose: null, managedOwnerKey: null, mutationPolicy: "user", archiveVisibility: "visible" } IN documents OPTIONS { keepNull: false }');
  const archivedEnvelopes = await (await targetDb.query<Record<string, unknown>>('FOR document IN documents FILTER IS_STRING(document.content) LET payload = JSON_PARSE(document.content) FILTER payload != null && payload.version == 1 && (STARTS_WITH(payload.kind || "", "mail-") || STARTS_WITH(payload.type || "", "mail-")) RETURN KEEP(document, "_key", "name", "content")')).all();
  for (const document of archivedEnvelopes) {
    if (typeof document._key !== 'string' || typeof document.name !== 'string' || typeof document.content !== 'string') continue;
    const content = legacyEmailArchiveContent(document.content);
    if (!content) continue;
    const contentChunks = chunkDocumentContent(content);
    const chunkEmbeddings = await generateEmbeddings(documentEmbeddingTexts(document.name, contentChunks));
    await targetDb.query('UPDATE @key WITH { content: @content, embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash } IN documents', { key: document._key, content, embedding: chunkEmbeddings[0], contentChunks, chunkEmbeddings, semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(content) });
  }
  await targetDb.query('FOR folder IN folders FILTER STARTS_WITH(folder.purpose || "", "communication-mail-") || STARTS_WITH(folder.managedPurpose || "", "mail-") UPDATE folder WITH { purpose: null, managedPurpose: null, managedOwnerKey: null, mutationPolicy: "user", archiveVisibility: "visible" } IN folders OPTIONS { keepNull: false }');
  await targetDb.query('FOR collection IN collections FILTER collection.purpose == "email-media" UPDATE collection WITH { purpose: null, mutationPolicy: "user" } IN collections OPTIONS { keepNull: false }');
}

export async function migrateCanonicalEmailEmbeddings(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('emailMessages').exists()) return;
  const cursor = await targetDb.query<Record<string, unknown>>('FOR message IN emailMessages FILTER message.embeddingContentVersion != 4 || !IS_ARRAY(message.embedding) || LENGTH(message.embedding) != @dimensions || LENGTH(message.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0 || LENGTH(message.embedding[* FILTER CURRENT != 0]) == 0 RETURN message', { dimensions: EMBEDDING_DIMENSIONS });
  for (const message of await cursor.all()) {
    if (typeof message._key !== 'string' || typeof message.from !== 'string' || typeof message.subject !== 'string' || typeof message.body !== 'string') continue;
    const embedding = await generateEmbedding(emailMessageSemanticText({ from: message.from, subject: message.subject, body: message.body }));
    await targetDb.query('UPDATE @key WITH { embedding: @embedding, embeddingContentVersion: 4 } IN emailMessages', { key: message._key, embedding });
  }
  await targetDb.query(`FOR thread IN emailThreads
    LET latest = FIRST(FOR message IN emailMessages FILTER message.scopeKey == thread.scopeKey && message.threadKey == thread._key && message.embeddingContentVersion == 4 SORT message.sentAt DESC, message._key DESC LIMIT 1 RETURN message)
    FILTER latest != null && (thread.embeddingContentVersion != 4 || thread.embedding != latest.embedding)
    UPDATE thread WITH { embedding: latest.embedding, embeddingContentVersion: 4 } IN emailThreads`);
  for (const [collectionName, fields] of [['emailInboxes', ['name', 'description']], ['emailDrafts', ['subject', 'generatedContent', 'finalContent']], ['emailTones', ['name']], ['emailReplyContext', ['name', 'text']], ['emailWritingProfiles', ['name', 'description', 'tone', 'style', 'structure', 'vocabulary', 'conventions']]] as const) await migrateExactSemanticRecords(targetDb, collectionName, fields);
  const invalid = await (await targetDb.query<number>('RETURN LENGTH(FOR message IN emailMessages FILTER message.embeddingContentVersion != 4 || !IS_ARRAY(message.embedding) || LENGTH(message.embedding) != @dimensions || LENGTH(message.embedding[* FILTER CURRENT != 0]) == 0 RETURN 1)', { dimensions: EMBEDDING_DIMENSIONS })).next() ?? 0;
  if (invalid > 0) throw new Error(`Canonical email embedding migration failed for ${invalid} message(s).`);
}

export async function migrateProviderIndependentEmailDrafts(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('documents').exists() || !await targetDb.collection('organizationConnectors').exists() || !await targetDb.collection('scopes').exists()) return;
  const batchSize = 100;
  const updatedAt = new Date().toISOString();
  let after = '';
  while (true) {
    const cursor = await targetDb.query<{ key: string; revision: string; content: string; updatedAt: string }>(`FOR document IN documents
      FILTER document._key > @after
      LET payload = JSON_PARSE(document.content)
      FILTER payload.kind == "mail-new-draft" && payload.data.accountKey == document.scopeKey && payload.data.status IN ["generated", "edited"]
      LET scope = DOCUMENT(scopes, document.scopeKey)
      LET connectors = (FOR connector IN organizationConnectors
        FILTER scope != null && connector.organizationKey == scope.organizationKey && connector.scopeKey == document.scopeKey
        FILTER connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false
        LIMIT 2 RETURN connector)
      FILTER LENGTH(connectors) == 1
      LET nextPayload = MERGE(payload, { data: MERGE(payload.data, { accountKey: connectors[0]._key }) })
      SORT document._key
      LIMIT @batchSize
      RETURN { key: document._key, revision: document._rev, content: JSON_STRINGIFY(nextPayload), updatedAt: MAX([document.updatedAt, @updatedAt]) }`, { after, batchSize, updatedAt });
    const patches = await cursor.all();
    if (patches.length === 0) break;
    await targetDb.query(`FOR patch IN @patches
      UPDATE { _key: patch.key, _rev: patch.revision }
      WITH { content: patch.content, updatedAt: patch.updatedAt } IN documents
      OPTIONS { ignoreRevs: false, ignoreErrors: true }`, { patches });
    after = patches.at(-1)!.key;
    if (patches.length < batchSize) break;
  }
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

export function needsExactSemanticEmbedding(embedding: unknown, dimensions = EMBEDDING_DIMENSIONS) {
  return !Array.isArray(embedding)
    || embedding.length !== dimensions
    || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
    || embedding.every((value) => value === 0);
}

let deferredSemanticEmbeddingError: ProviderError | null = null;

export async function migrateExactSemanticRecords(targetDb: Database, collectionName: 'folders' | 'images' | 'collections' | 'tags' | 'imageCaptions' | 'visualIdentities' | 'books' | 'bookContexts' | 'bookThemes' | 'bookSources' | 'bookParts' | 'bookChapters' | 'chapterContexts' | 'emailInboxes' | 'emailDrafts' | 'emailTones' | 'emailReplyContext' | 'emailWritingProfiles', embedKeys: readonly string[]) {
  const dimensions = EMBEDDING_DIMENSIONS;
  let after = '';
  while (true) {
    const cursor = await targetDb.query<Record<string, unknown>>(`
      FOR resource IN @@collection
        FILTER resource._key > @after
        FILTER !IS_ARRAY(resource.embedding) || LENGTH(resource.embedding) != @dimensions
          || LENGTH(resource.embedding[* FILTER !IS_NUMBER(CURRENT)]) > 0
          || LENGTH(resource.embedding[* FILTER CURRENT != 0]) == 0
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
      if (needsExactSemanticEmbedding(embedding, dimensions)) {
        const text = collectionName === 'images' ? buildImageEmbeddingText({
          filename: String(resource.filename ?? ''), caption: String(resource.caption ?? ''),
          city: typeof resource.city === 'string' ? resource.city : null, country: typeof resource.country === 'string' ? resource.country : null,
          countryCode: typeof resource.countryCode === 'string' ? resource.countryCode : null,
          placeName: typeof resource.placeName === 'string' ? resource.placeName : null, placeSummary: typeof resource.placeSummary === 'string' ? resource.placeSummary : null,
        }) : buildEmbeddingText(embedKeys, resource);
        if (!text) throw new Error(`Cannot migrate ${collectionName}: ${String(resource._key)} has no semantic embedding input.`);
        if (deferredSemanticEmbeddingError) continue;
        try {
          embedding = await generateEmbedding(text);
        } catch (error) {
          if (!isProviderError(error) || !error.retryable) throw error;
          deferredSemanticEmbeddingError = error;
          console.warn(`${collectionName}: semantic embedding migration deferred because ${error.providerId} is unavailable (${error.code}).`);
          continue;
        }
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
        || LENGTH(resource.embedding[* FILTER CURRENT != 0]) == 0
        || HAS(resource, "embeddingProvider") || HAS(resource, "embeddingModel") || HAS(resource, "embeddingDimensions")
        || HAS(resource, "embeddingState") || HAS(resource, "embeddedAt")
        || (@isImage && (HAS(resource, "ownerKey") || HAS(resource, "requestHash")))
      RETURN 1)
  `, { '@collection': collectionName, dimensions, isImage: collectionName === 'images' });
  const invalid = await verification.next() ?? 0;
  if (invalid > 0) {
    if (deferredSemanticEmbeddingError) {
      console.warn(`${collectionName}: ${invalid} semantic row(s) remain eligible for retry after the provider recovers.`);
      return;
    }
    throw new Error(`${collectionName} exact semantic migration verification failed for ${invalid} row(s).`);
  }
}

export async function migrateScopeTags(targetDb: Database): Promise<void> {
  const tags = targetDb.collection('tags');
  if (!await tags.exists()) return;
  const assignments = targetDb.collection('tagAssignments');
  if (await assignments.exists()) {
    await targetDb.query('LET legacyTagKeys = (FOR tag IN tags FILTER !IS_STRING(tag.userKey) || LENGTH(TRIM(tag.userKey)) == 0 RETURN tag._key) LET removedAssignments = (FOR assignment IN tagAssignments FILTER assignment.tagKey IN legacyTagKeys REMOVE assignment IN tagAssignments RETURN 1) FOR tag IN tags FILTER tag._key IN legacyTagKeys REMOVE tag IN tags RETURN LENGTH(removedAssignments)');
    return;
  }
  await targetDb.query('FOR tag IN tags FILTER !IS_STRING(tag.userKey) || LENGTH(TRIM(tag.userKey)) == 0 REMOVE tag IN tags');
}

export async function dropVerifiedLegacyInboxes(targetDb: Database) {
  const legacy = targetDb.collection('inboxes');
  if (await legacy.exists()) {
    const drop = legacy.drop.bind(legacy);
    await drop();
    console.log('Dropped verified legacy collection inboxes');
  }
}

export async function retireUnsupportedEmailConnectors(targetDb: Database) {
  if (!await targetDb.collection('organizationConnectors').exists()) return;
  await targetDb.query(`FOR connector IN organizationConnectors
    FILTER connector.provider != "gmail"
    FILTER connector.status != "revoked" || connector.syncEnabled != false || HAS(connector, "encryptedCredentials") || HAS(connector, "encryptionKeyId") || HAS(connector, "accessTokenFingerprint") || HAS(connector, "syncLeaseToken") || HAS(connector, "sendLeaseToken")
    UPDATE connector WITH {
      status: "revoked", syncEnabled: false, syncStatus: "idle", revokedAt: connector.revokedAt != null ? connector.revokedAt : DATE_ISO8601(DATE_NOW()),
      encryptedCredentials: null, encryptionKeyId: null, accessTokenFingerprint: null,
      syncLeaseToken: null, syncLeaseExpiresAt: null, sendLeaseToken: null, sendLeaseExpiresAt: null,
      historyId: null, watchRegisteredAt: null, watchExpiresAt: null, updatedAt: DATE_ISO8601(DATE_NOW())
    } IN organizationConnectors OPTIONS { keepNull: false }`);
}

export async function migrateEmailAttachmentAvailability(targetDb: Database) {
  if (!await targetDb.collection('emailMessages').exists()) return;
  await targetDb.query(`FOR message IN emailMessages
    FILTER !HAS(message, "attachmentAvailability")
    LET availability = message.hasAttachments == true ? "failed" : "none"
    LET unavailable = message.hasAttachments == true ? { unavailableAttachmentCount: 1 } : {}
    UPDATE message WITH MERGE({ attachmentAvailability: availability }, unavailable) IN emailMessages`);
}

function emailToneSemanticsCurrent(document: Record<string, unknown>, canonicalContent: string, contentChunks: string[], semanticText: string, dimensions: number) {
  const embedding = document.embedding;
  const storedChunks = document.contentChunks;
  const chunkEmbeddings = document.chunkEmbeddings;
  return document.content === canonicalContent && document.emailToneEmbeddingVersion === 1
    && Array.isArray(embedding) && embedding.length === dimensions && embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
    && Array.isArray(storedChunks) && storedChunks.length === contentChunks.length && storedChunks.every((value, index) => value === contentChunks[index])
    && Array.isArray(chunkEmbeddings) && chunkEmbeddings.length === contentChunks.length
    && chunkEmbeddings.every((value) => Array.isArray(value) && value.length === dimensions && value.every((item, index) => typeof item === 'number' && Number.isFinite(item) && item === embedding[index]))
    && document.semanticChunkCount === contentChunks.length && document.semanticContentHash === documentSemanticHash(semanticText);
}

function isCanonicalEmailToneDocument(document: Record<string, unknown>) {
  if (typeof document.scopeKey !== 'string') return false;
  const key = `c${createHash('sha256').update(`managed-mail-folder\0${document.scopeKey}\0communication-mail-tones`).digest('hex').slice(0, 24)}`;
  return document.folderKey === key;
}

export async function migrateEmailToneEmbeddings(targetDb: Database) {
  if (!await targetDb.collection('documents').exists() || !await targetDb.collection('folders').exists()) return;
  const dimensions = EMBEDDING_DIMENSIONS;
  const cursor = await targetDb.query<Record<string, unknown>>(`FOR document IN documents
    LET folder = DOCUMENT(folders, document.folderKey)
    FILTER folder != null && folder.scopeKey == document.scopeKey && folder.purpose == "communication-mail-tones"
    RETURN document`);
  for (const document of await cursor.all()) {
    if (!isCanonicalEmailToneDocument(document)) continue;
    let tone;
    try { tone = decodeEmailToneContent(String(document.content)); } catch { continue; }
    const semanticText = emailToneSemanticText(tone);
    const canonicalContent = encodeEmailToneContent(tone);
    const contentChunks = chunkDocumentContent(semanticText);
    if (emailToneSemanticsCurrent(document, canonicalContent, contentChunks, semanticText, dimensions)) continue;
    const embedding = await embedText({ text: semanticText });
    await targetDb.query('FOR document IN documents FILTER document._key == @key && document._rev == @revision UPDATE document WITH { name: @name, content: @content, embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash, emailToneEmbeddingVersion: 1 } IN documents', { key: document._key, revision: document._rev, name: tone.name, content: canonicalContent, embedding, contentChunks, chunkEmbeddings: contentChunks.map(() => embedding), semanticChunkCount: contentChunks.length, semanticContentHash: documentSemanticHash(semanticText) });
  }
  const verification = await targetDb.query<Record<string, unknown>>(`FOR document IN documents
    LET folder = DOCUMENT(folders, document.folderKey)
    FILTER folder != null && folder.scopeKey == document.scopeKey && folder.purpose == "communication-mail-tones"
    RETURN document`);
  let invalid = 0;
  for (const document of await verification.all()) {
    if (!isCanonicalEmailToneDocument(document)) continue;
    let tone;
    try { tone = decodeEmailToneContent(String(document.content)); } catch { continue; }
    const semanticText = emailToneSemanticText(tone);
    const canonicalContent = encodeEmailToneContent(tone);
    const contentChunks = chunkDocumentContent(semanticText);
    if (!emailToneSemanticsCurrent(document, canonicalContent, contentChunks, semanticText, dimensions)) invalid += 1;
  }
  if (invalid > 0) throw new Error(`Email tone semantic migration failed for ${invalid} stale row(s), including any concurrent edit conflicts; rerun the migration.`);
}

export async function migrateRetiredEmailDefaultTones(targetDb: Database) {
  const retiredTones = [
    { slug: 'warm', name: 'Warm', description: 'Friendly and considerate.', instruction: 'Sound approachable, appreciative, and human.' },
    { slug: 'concise', name: 'Concise', instruction: 'Lead with the point, use short sentences, and include only necessary details.' },
  ];
  await targetDb.query(`FOR document IN documents
    LET folder = DOCUMENT(folders, document.folderKey)
    FILTER folder != null && folder.scopeKey == document.scopeKey && folder.purpose == "communication-mail-tones"
    LET retired = FIRST(FOR tone IN @retiredTones LET key = CONCAT("c", SUBSTRING(SHA256(CONCAT("mail-tone", "\\u0000", document.scopeKey, "\\u0000", tone.slug)), 0, 24)) FILTER document._key == key RETURN tone)
    FILTER retired != null
    LET legacyContent = retired.description == null ? null : CONCAT("# ", retired.name, "\\n\\n<!-- vorinthex-mail-tone ", JSON_STRINGIFY({ version: 1, slug: retired.slug }), " -->\\n\\n", retired.description, "\\n\\n## Instruction\\n\\n", retired.instruction)
    LET canonicalContent = CONCAT("# ", retired.name, "\\n\\n<!-- vorinthex-mail-tone ", JSON_STRINGIFY({ version: 1, slug: retired.slug }), " -->\\n\\n## Instruction\\n\\n", retired.instruction)
    LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == document.scopeKey && summary.documentKey == document._key RETURN summary._key)
    LET hasDependents = LENGTH(FOR version IN documentVersions FILTER version.scopeKey == document.scopeKey && version.documentKey == document._key LIMIT 1 RETURN 1) > 0
      || LENGTH(summaryKeys) > 0
      || LENGTH(FOR audio IN documentAudioVersions FILTER audio.scopeKey == document.scopeKey && audio.documentKey == document._key LIMIT 1 RETURN 1) > 0
      || LENGTH(FOR audio IN documentSummaryAudio FILTER audio.scopeKey == document.scopeKey && (audio.documentKey == document._key || audio.summaryKey IN summaryKeys) LIMIT 1 RETURN 1) > 0
    LET untouched = (document.content == canonicalContent || legacyContent != null && document.content == legacyContent) && document.name == retired.name && document.isFavorite != true && document.coverImageKey == null && document.createdAt == document.updatedAt && !hasDependents
    FILTER untouched
    REMOVE document IN documents`, { retiredTones });
  await targetDb.query(`FOR document IN documents
    LET folder = DOCUMENT(folders, document.folderKey)
    FILTER folder != null && folder.scopeKey == document.scopeKey && folder.purpose == "communication-mail-tones"
    LET retired = FIRST(FOR tone IN @retiredTones LET key = CONCAT("c", SUBSTRING(SHA256(CONCAT("mail-tone", "\\u0000", document.scopeKey, "\\u0000", tone.slug)), 0, 24)) FILTER document._key == key RETURN tone)
    FILTER retired != null
    LET customContent = SUBSTITUTE(document.content, JSON_STRINGIFY({ version: 1, slug: retired.slug }), JSON_STRINGIFY({ version: 1 }))
    FILTER customContent != document.content
    UPDATE document WITH { content: customContent, updatedAt: DATE_ISO8601(DATE_NOW()) } IN documents`, { retiredTones });
}

export async function migrateEmailInboxCategoriesAndDefaultTones(targetDb: Database) {
  if (!await targetDb.collection('documents').exists() || !await targetDb.collection('folders').exists()) return;
  const defaultTones = [
    { slug: 'casual', name: 'Casual', instruction: 'Use conversational language, natural contractions, and an approachable tone.' },
    { slug: 'formal', name: 'Formal', instruction: 'Use professional language, complete sentences, and a clear conventional structure.' },
    { slug: 'direct', name: 'Direct', instruction: 'Lead with the answer or action and avoid hedging.' },
  ];
  await targetDb.query(`FOR folder IN folders
    FILTER folder.purpose == "communication-mail-tones"
    FOR tone IN @defaultTones
      LET key = CONCAT("c", SUBSTRING(SHA256(CONCAT("mail-tone", "\\u0000", folder.scopeKey, "\\u0000", tone.slug)), 0, 24))
      LET content = CONCAT("# ", tone.name, "\\n\\n<!-- vorinthex-mail-tone ", JSON_STRINGIFY({ version: 1, slug: tone.slug }), " -->\\n\\n## Instruction\\n\\n", tone.instruction)
      LET timestamp = DATE_ISO8601(DATE_NOW())
      UPSERT { _key: key }
      INSERT { _key: key, scopeKey: folder.scopeKey, folderKey: folder._key, name: tone.name, content, embedding: @placeholder, mutationPolicy: "user", isFavorite: false, createdAt: timestamp, updatedAt: timestamp }
      UPDATE {} IN documents`, { defaultTones, placeholder: Array(EMBEDDING_DIMENSIONS).fill(0) });
  await targetDb.query(`FOR document IN documents
    FILTER document.mutationPolicy == "system-only" && STARTS_WITH(TRIM(document.content), "{")
    LET payload = JSON_PARSE(document.content)
    FILTER payload.version == 1 && payload.kind IN ["mail-thread", "mail-message"]
    LET labels = payload.data.labels || []
    LET inboxCategory = "SPAM" IN labels || "TRASH" IN labels || payload.data.state == "filtered" ? "Filtered" : payload.data.priority == "urgent" ? "Urgent" : "Important"
    LET inInbox = "INBOX" IN labels || "SPAM" IN labels || "TRASH" IN labels
    FILTER payload.data.inboxCategory != inboxCategory || (payload.kind == "mail-thread" && payload.data.inInbox != inInbox)
    UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, payload.kind == "mail-thread" ? { inboxCategory, inInbox } : { inboxCategory }) })) } IN documents`);
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
        FILTER document.emailToneEmbeddingVersion != 1 && document.emailReplyContextEmbeddingVersion != 1
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
      FILTER document.emailToneEmbeddingVersion != 1 && document.emailReplyContextEmbeddingVersion != 1
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
  'shares', 'places', 'trips', 'books', 'messages',
] as const;

const currentBookStatuses = new Set(['queued', 'planning', 'researching', 'writing', 'finalizing', 'narrating', 'ready', 'failed', 'cancelled']);
const currentBookStages = new Set(['accepted', 'outline', 'research', 'draft', 'continuity', 'audio', 'art', 'publish', 'complete']);
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export function legacyBookPatch(book: Record<string, unknown>) {
  const originalStatus = typeof book.status === 'string' ? book.status : 'failed';
  const hasGenerationInput = bookGenerationInputSchema.safeParse(book.generationInput).success;
  const hasGenerationOwner = z.string().cuid().safeParse(book.generationOwnerKey).success;
  const interrupted = originalStatus !== 'ready' && originalStatus !== 'cancelled' && (!hasGenerationInput || !hasGenerationOwner);
  const status = originalStatus === 'generating' || interrupted ? 'failed' : currentBookStatuses.has(originalStatus) ? originalStatus : 'failed';
  const chapterCount = typeof book.chapterCount === 'number' && Number.isInteger(book.chapterCount) && book.chapterCount >= 0 ? book.chapterCount : 0;
  const generationTotalUnits = typeof book.generationTotalUnits === 'number' && Number.isInteger(book.generationTotalUnits) && book.generationTotalUnits >= 0 ? book.generationTotalUnits : chapterCount * 3 + 4;
  const inferredStage = status === 'ready' ? 'complete' : status === 'researching' ? 'research' : status === 'planning' ? 'outline' : status === 'narrating' ? 'audio' : status === 'finalizing' ? 'continuity' : status === 'writing' || originalStatus === 'generating' ? 'draft' : 'accepted';
  const brief = JSON.stringify([book.title ?? '', book.goal ?? '', book.audience ?? '', book.language ?? '', chapterCount]);
  return {
    status, generationStage: currentBookStages.has(String(book.generationStage)) ? book.generationStage : inferredStage,
    generationCompletedUnits: status === 'ready' ? generationTotalUnits : typeof book.generationCompletedUnits === 'number' && Number.isInteger(book.generationCompletedUnits) && book.generationCompletedUnits >= 0 ? Math.min(generationTotalUnits, book.generationCompletedUnits) : 0,
    generationTotalUnits, generationAttempt: typeof book.generationAttempt === 'number' && Number.isInteger(book.generationAttempt) && book.generationAttempt >= 0 ? book.generationAttempt : 0,
    generationBriefFingerprint: typeof book.generationBriefFingerprint === 'string' && /^[a-f0-9]{64}$/.test(book.generationBriefFingerprint) ? book.generationBriefFingerprint : sha256(brief),
    narratorVoiceKey: ['calm', 'clear', 'warm'].includes(String(book.narratorVoiceKey)) ? book.narratorVoiceKey : 'clear',
    narrationPace: typeof book.narrationPace === 'number' && book.narrationPace >= 0.75 && book.narrationPace <= 2 ? book.narrationPace : 1,
    ...((originalStatus === 'generating' || interrupted) && typeof book.generationError !== 'string' ? { generationError: hasGenerationInput && hasGenerationOwner ? 'Generation was interrupted during the durable-generation migration. Retry the audio book.' : 'This legacy generation has no resumable input. Create a new audio book.' } : {}),
  };
}
export function legacyBookChapterPatch(chapter: Record<string, unknown>) {
  const objective = typeof chapter.objective === 'string' && chapter.objective.trim() ? chapter.objective : String(chapter.description ?? chapter.title ?? 'Complete this chapter.');
  return {
    evidenceKeyPoints: Array.isArray(chapter.evidenceKeyPoints) && chapter.evidenceKeyPoints.length ? chapter.evidenceKeyPoints : [objective],
    priorTransition: typeof chapter.priorTransition === 'string' && chapter.priorTransition.trim() ? chapter.priorTransition : 'Continue naturally from the preceding chapter.',
    nextTransition: typeof chapter.nextTransition === 'string' && chapter.nextTransition.trim() ? chapter.nextTransition : 'Prepare the reader for the following chapter.',
    repetitionBoundaries: Array.isArray(chapter.repetitionBoundaries) && chapter.repetitionBoundaries.length ? chapter.repetitionBoundaries : [`Avoid repeating the core material from ${String(chapter.title ?? 'this chapter')}.`],
    targetWordMin: LEGACY_BOOK_CHAPTER_WORD_MIN, targetWordMax: LEGACY_BOOK_CHAPTER_WORD_MAX,
  };
}
export function legacyBookSourcePatch(source: Record<string, unknown>) {
  const content = typeof source.content === 'string' ? source.content : String(source.content ?? '');
  return { contentHash: typeof source.contentHash === 'string' && /^[a-f0-9]{64}$/.test(source.contentHash) ? source.contentHash : sha256(content), ...(source.sourceType !== 'web' && typeof source.sourceUpdatedAt !== 'string' ? { sourceUpdatedAt: source.createdAt } : {}) };
}
export function legacyReadyBookPatch(book: Record<string, unknown>, chapters: Record<string, unknown>[], publishedDocumentKeys: ReadonlySet<string>) {
  if (book.status !== 'ready') return {};
  const expectedChapterCount = typeof book.chapterCount === 'number' && Number.isInteger(book.chapterCount) && book.chapterCount > 0 ? book.chapterCount : 0;
  const hasCover = typeof book.coverStorageKey === 'string' && book.coverStorageKey.trim().length > 0;
  const hasExpectedChapters = expectedChapterCount > 0 && chapters.length === expectedChapterCount;
  const hasPlayableAudio = hasExpectedChapters && chapters.every((chapter) => typeof chapter.audioStorageKey === 'string' && chapter.audioStorageKey.trim().length > 0 && typeof chapter.audioDurationSeconds === 'number' && Number.isInteger(chapter.audioDurationSeconds) && chapter.audioDurationSeconds > 0);
  const bookKey = String(book._key ?? book.key);
  const isPublished = (chapter: Record<string, unknown>) => typeof book.archiveFolderKey === 'string' && typeof chapter.archiveDocumentKey === 'string' && typeof chapter._key === 'string' && publishedDocumentKeys.has(`${String(book.scopeKey)}:${bookKey}:${book.archiveFolderKey}:${chapter.archiveDocumentKey}:${chapter._key}`);
  const hasCanonicalPublication = hasExpectedChapters && chapters.every(isPublished);
  if (hasCover && hasPlayableAudio && hasCanonicalPublication) return {};
  const resumable = bookGenerationInputSchema.safeParse(book.generationInput).success && z.string().cuid().safeParse(book.generationOwnerKey).success;
  const missingTranscript = chapters.some((chapter) => !(typeof chapter.content === 'string' && chapter.content.trim()) && !isPublished(chapter));
  const generationStage = missingTranscript ? 'draft' : !hasPlayableAudio ? 'audio' : 'publish';
  return {
    status: 'failed', generationStage,
    generationError: resumable
      ? 'This legacy ready audio book is missing playable audio or canonical Archive publication. Retry the audio book to repair it.'
      : 'This legacy ready audio book is missing playable audio or canonical Archive publication and has no resumable input. Create a new audio book.',
  };
}
export async function migrateDurableBookGeneration(targetDb: Database): Promise<void> {
  if (!await targetDb.collection('books').exists()) return;
  await targetDb.query(`FOR folder IN folders FILTER folder.managedPurpose == "audio-book" && IS_OBJECT(folder.audioBook)
    LET cover = IS_STRING(folder.coverImageKey) ? DOCUMENT(images, folder.coverImageKey) : null
    LET value = MERGE(folder.audioBook, { _key: folder._key, scopeKey: folder.scopeKey, title: folder.name, description: folder.description, coverStorageKey: cover != null ? cover.storageKey : null, isFavorite: folder.isFavorite || false, embedding: folder.embedding, archiveFolderKey: folder._key, createdAt: folder.createdAt, updatedAt: folder.updatedAt })
    UPSERT { _key: folder._key } INSERT value UPDATE {} IN books OPTIONS { keepNull: false }`);
  await targetDb.query(`FOR document IN documents FILTER document.managedPurpose == "audio-chapter" && IS_OBJECT(document.audioChapter)
    LET value = MERGE(document.audioChapter, { _key: document._key, scopeKey: document.scopeKey, title: document.name, content: document.content, archiveDocumentKey: document._key, embedding: document.embedding, createdAt: document.createdAt, updatedAt: document.updatedAt })
    UPSERT { _key: document._key } INSERT value UPDATE {} IN bookChapters OPTIONS { keepNull: false }`);
  for (const [field, collectionName] of [['bookContext', 'bookContexts'], ['sources', 'bookSources'], ['themes', 'bookThemes'], ['parts', 'bookParts']] as const) {
    await targetDb.query(`FOR folder IN folders FILTER folder.managedPurpose == "audio-book" LET records = @single ? (IS_OBJECT(folder.audioBook[@field]) ? [folder.audioBook[@field]] : []) : (IS_ARRAY(folder.audioBook[@field]) ? folder.audioBook[@field] : []) FOR record IN records FILTER IS_STRING(record.key) LET value = MERGE(record, { _key: record.key, scopeKey: folder.scopeKey, bookKey: folder._key }) UPSERT { _key: record.key } INSERT UNSET(value, "key") UPDATE {} IN @@collection`, { field, single: field === 'bookContext', '@collection': collectionName });
  }
  await targetDb.query('FOR document IN documents FILTER document.managedPurpose == "audio-chapter" && IS_OBJECT(document.audioChapter.chapterContext) LET record = document.audioChapter.chapterContext FILTER IS_STRING(record.key) LET value = MERGE(record, { _key: record.key, scopeKey: document.scopeKey, chapterKey: document._key }) UPSERT { _key: record.key } INSERT UNSET(value, "key") UPDATE {} IN chapterContexts');
  await targetDb.query('FOR document IN documents FILTER document.managedPurpose == "audio-chapter" && IS_ARRAY(document.audioChapter.readerProgress) FOR record IN document.audioChapter.readerProgress FILTER IS_STRING(record.key) && IS_STRING(record.userKey) LET value = MERGE(record, { _key: record.key, scopeKey: document.scopeKey, bookKey: document.audioChapter.bookKey, chapterKey: document._key }) UPSERT { _key: record.key } INSERT UNSET(value, "key") UPDATE {} IN bookProgress');
  for (const [collectionName, patch] of [['books', legacyBookPatch], ['bookChapters', legacyBookChapterPatch], ['bookSources', legacyBookSourcePatch]] as const) {
    const records = await (await targetDb.query(`FOR record IN ${collectionName} RETURN record`)).all() as Record<string, unknown>[];
    for (const raw of records) { const record = withArangoKey(raw); await targetDb.query(`UPDATE @key WITH @patch IN ${collectionName}`, { key: record.key, patch: patch(record) }); }
  }
  await targetDb.query('FOR progress IN bookProgress FILTER !HAS(progress, "userKey") REMOVE progress IN bookProgress');
  await targetDb.query('FOR folder IN folders FILTER folder.managedPurpose == "audio-book" UPDATE folder WITH { audioBook: null, managedPurpose: null, managedOwnerKey: null, mutationPolicy: "user" } IN folders OPTIONS { keepNull: false }');
  await targetDb.query('FOR document IN documents FILTER document.managedPurpose == "audio-chapter" UPDATE document WITH { audioChapter: null, managedPurpose: null, managedOwnerKey: null, mutationPolicy: "user" } IN documents OPTIONS { keepNull: false }');
  await targetDb.query('FOR binding IN generatedDocumentBindings FILTER binding.subjectType == "chapter" && binding.kind == "chapter" LET document = DOCUMENT(documents, binding.documentKey) FILTER document != null && document.scopeKey == binding.scopeKey UPDATE document WITH { extension: null, mimeType: null, storageKey: null, sizeBytes: null, sourceStorageKeys: null } IN documents OPTIONS { keepNull: false }');
  await targetDb.query('FOR collection IN collections FILTER collection.purpose == "audio-book-media" UPDATE collection WITH { purpose: null, mutationPolicy: "user" } IN collections OPTIONS { keepNull: false }');
  for (const [collectionName, embedKeys] of [['books', ['title', 'subtitle', 'description', 'goal', 'audience', 'outcome']], ['bookContexts', ['userContext', 'priorKnowledge', 'priorBookContext', 'personalizationContext', 'researchContext', 'noveltyContext', 'generationBrief']], ['bookThemes', ['name', 'description']], ['bookSources', ['title', 'content', 'relevance']], ['bookParts', ['title', 'description', 'objective']], ['bookChapters', ['title', 'description', 'objective', 'content']], ['chapterContexts', ['previousContext', 'objectiveContext', 'sourceContext', 'personalizationContext', 'noveltyContext', 'nextContext', 'generationBrief']]] as const) await migrateExactSemanticRecords(targetDb, collectionName, embedKeys);
}

export async function removeLegacyTombstones(targetDb: Database): Promise<void> {
  const jobs = targetDb.collection('storageDeletionJobs');
  if (!await jobs.exists()) await jobs.create();
  await jobs.ensureIndex({ type: 'persistent', fields: ['storageKey'], unique: true });
  const existing = new Set((await targetDb.listCollections()).map(({ name }) => name));
  const exists = async (name: string) => existing.has(name);
  await withDatabaseTransaction(targetDb, { write: [...existing] }, async (transaction) => {
  const cleanupAt = new Date().toISOString();
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
  const bookKeys = mergeKeys(
    await keysFor('books'),
    await exists('books') && scopeKeys.length ? await (await transaction.query('FOR book IN books FILTER book.scopeKey IN @scopeKeys RETURN book._key', { scopeKeys })).all() as string[] : [],
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
  if (bookKeys.length && await exists('books')) storageKeys.push(...await (await transaction.query('FOR book IN books FILTER book._key IN @keys && IS_STRING(book.coverStorageKey) RETURN book.coverStorageKey', { keys: bookKeys })).all() as string[]);
  if (bookKeys.length && await exists('bookChapters')) storageKeys.push(...((await (await transaction.query('FOR chapter IN bookChapters FILTER chapter.bookKey IN @keys RETURN REMOVE_VALUE([chapter.audioStorageKey], null)', { keys: bookKeys })).all()) as string[][]).flat().filter((key): key is string => typeof key === 'string' && key.length > 0));
  if (scopeKeys.length && await exists('emailAttachments')) storageKeys.push(...await (await transaction.query('FOR attachment IN emailAttachments FILTER attachment.scopeKey IN @scopeKeys && IS_STRING(attachment.storageKey) RETURN attachment.storageKey', { scopeKeys })).all() as string[]);
  if (scopeKeys.length && await exists('placeHeroMedia')) storageKeys.push(...await (await transaction.query('FOR media IN placeHeroMedia FILTER media.scopeKey IN @scopeKeys && IS_STRING(media.storageKey) RETURN media.storageKey', { scopeKeys })).all() as string[]);
  await transaction.query('FOR storageKey IN UNIQUE(@storageKeys) FILTER IS_STRING(storageKey) && LENGTH(storageKey) > 0 UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs', { storageKeys, now: cleanupAt });

  if (scopeKeys.length) {
    for (const name of [
      'scopeMembers', 'imageCaptions', 'visualIdentities', 'imageIdentities',
       'galleryUploads', 'collections', 'collectionImages', 'imageCollecitionHightlights', 'imageCollectionMemories',
      'collectionMembers', 'collectionInvites', 'tags', 'tagAssignments', 'documents',
      'documentVersions', 'documentAudioVersions', 'documentSummaries', 'documentSummaryAudio',
        'shares', 'places', 'generatedDocumentBindings', 'trips', 'tripCreationReceipts', 'tripPlaces', 'tripAttachments', 'tripGuides', 'placeReferences', 'placeHeroMedia', 'placeVisits',
        'books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'bookExtensions',
        'emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles', 'emailAttachments',
       'organizationConnectors', 'channels', 'threads', 'messages', 'messageMentions',
      'messageReactions', 'polls', 'pollOptions', 'pollVotes',
    ]) await removeBy(name, 'scopeKey', scopeKeys);
    await removeBy('events', 'scopeKey', scopeKeys);
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
  if (imageKeys.length && await exists('collections')) await transaction.query('FOR collection IN collections FILTER collection.coverImageKey IN @keys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false }', { keys: imageKeys, now: cleanupAt });
  if (imageKeys.length && await exists('folders')) await transaction.query('FOR folder IN folders FILTER folder.coverImageKey IN @keys UPDATE folder WITH { coverImageKey: null, updatedAt: @now } IN folders OPTIONS { keepNull: false }', { keys: imageKeys, now: cleanupAt });
  if (imageKeys.length && await exists('documents')) await transaction.query('FOR document IN documents FILTER document.coverImageKey IN @keys UPDATE document WITH { coverImageKey: null, updatedAt: @now } IN documents OPTIONS { keepNull: false }', { keys: imageKeys, now: cleanupAt });
  if (imageKeys.length && await exists('trips')) await transaction.query('FOR trip IN trips FILTER trip.coverImageKey IN @keys UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }', { keys: imageKeys, now: cleanupAt });
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

  const chapterKeys = bookKeys.length && await exists('bookChapters') ? await (await transaction.query('FOR chapter IN bookChapters FILTER chapter.bookKey IN @keys RETURN chapter._key', { keys: bookKeys })).all() as string[] : [];
  await removeBy('chapterContexts', 'chapterKey', chapterKeys);
  for (const name of ['bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'bookProgress', 'bookExtensions']) await removeBy(name, 'bookKey', bookKeys);
  await removeTyped('shares', 'sourceType', 'book', bookKeys, 'books');
  await removeKeys('books', bookKeys);

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
  { name: 'apps', skipEmbedding: true, indexes: [{ fields: ['slug'], unique: true }] },
  {
    name: 'users',
    embedKeys: ['email', 'name'],
    indexes: [
      { fields: ['organizationId'] },
      { fields: ['email'], unique: true },
      { fields: ['emailHash'], unique: true },
      { fields: ['alias_slug'], unique: true, sparse: true },
      { fields: ['refreshTokenHash'], unique: true, sparse: true },
      { fields: ['profileStorageKey'], unique: true, sparse: true },
      { fields: ['currentScopeKey'] },
    ],
  },
  {
    name: 'sparkTransactions',
    skipEmbedding: true,
    indexes: [
      { fields: ['userKey', 'idempotencyKey'], unique: true },
      { fields: ['userKey', 'createdAt'] },
      { fields: ['eventKey'], unique: true, sparse: true },
    ],
  },
  {
    name: 'billingExecutions',
    skipEmbedding: true,
    indexes: [
      { fields: ['userKey', 'executionIdentity'], unique: true },
      { fields: ['status', 'leaseExpiresAt'] },
      { fields: ['chargeTransactionKey'], unique: true },
    ],
  },
  { name: 'storageObjects', skipEmbedding: true, indexes: [{ fields: ['storageKey', 'deletedAt'] }, { fields: ['userKey', 'storedAt'] }, { fields: ['storedAt'] }] },
  { name: 'storageChargingHours', skipEmbedding: true, indexes: [{ fields: ['kind', 'hourEnd'] }, { fields: ['userKey', 'hourStart'], unique: true, sparse: true }, { fields: ['status', 'hourStart'] }] },
  { name: 'storageChargingMeters', skipEmbedding: true, indexes: [{ fields: ['userKey'], unique: true }] },
  { name: 'storageRetentionStates', skipEmbedding: true, indexes: [{ fields: ['userKey'], unique: true }, { fields: ['wipeDueAt'] }, { fields: ['fundedAt', 'wipedAt'] }] },
  { name: 'inboxBillingPeriods', skipEmbedding: true, indexes: [{ fields: ['connectorKey', 'startedAt'], unique: true }, { fields: ['startedAt'] }, { fields: ['scopeKey'] }, { fields: ['userKey'] }] },
  { name: 'inboxChargingHours', skipEmbedding: true, indexes: [{ fields: ['kind', 'hourEnd'] }, { fields: ['connectorKey', 'hourStart'], unique: true, sparse: true }, { fields: ['status', 'hourStart'] }] },
  { name: 'inboxChargingMeters', skipEmbedding: true, indexes: [{ fields: ['connectorKey'], unique: true }] },
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
      { fields: ['appKey', 'createdAt'] },
      { fields: ['userId', 'createdAt'], sparse: true },
      { fields: ['scopeKey', 'createdAt'] },
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
  { name: 'folders', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'parentFolderKey'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['scopeKey', 'parentFolderKey', 'name'] }, { fields: ['scopeKey', 'purpose'], unique: true, sparse: true }, { fields: ['scopeKey', 'managedPurpose', 'managedOwnerKey'], unique: true, sparse: true }] },
  { name: 'images', embedKeys: ['filename', 'caption', 'placeName', 'placeSummary', 'country', 'city', 'countryCode'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'createdAt'] }, { fields: ['scopeKey', 'latitude', 'longitude'], sparse: true }, { fields: ['imageCaptionKey'], sparse: true }, { fields: ['storageKey'], unique: true }] },
  { name: 'imageCaptions', skipEmbedding: true, indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'hashAlgorithm', 'perceptualHash'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment0'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment1'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment2'], sparse: true }, { fields: ['scopeKey', 'hashAlgorithm', 'hashSegment3'], sparse: true }] },
  { name: 'visualIdentities', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'createdByKey'] }, { fields: ['scopeKey', 'createdByKey', 'name'] }, { fields: ['scopeKey', 'referenceImageKey'] }] },
  { name: 'imageIdentities', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'identityKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'identityKey', 'confidence'] }, { fields: ['scopeKey', 'imageKey'] }, { fields: ['scopeKey', 'imageKey', 'isReference'], sparse: true }] },
  { name: 'galleryUploads', skipEmbedding: true, indexes: [{ fields: ['actorKey', 'createdAt'] }, { fields: ['storageKey'], unique: true }, { fields: ['expiresAt'] }] },
  { name: 'collections', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'name'] }, { fields: ['scopeKey', 'purpose'], unique: true, sparse: true }, { fields: ['scopeKey', 'coverImageKey'], sparse: true }] },
  { name: 'emailAttachmentBindings', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'connectorKey', 'providerMessageId', 'partPath'], unique: true }, { fields: ['targetType', 'targetKey'], unique: true }, { fields: ['scopeKey'] }, { fields: ['leaseExpiresAt'], sparse: true }] },
  { name: 'collectionImages', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'collectionKey'] }, { fields: ['scopeKey', 'imageKey'] }] },
  { name: 'placeImages', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'placeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'placeKey', 'position'] }] },
  { name: 'imageCollecitionHightlights', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'createdAt'] }, { fields: ['scopeKey', 'createdByKey'] }] },
  { name: 'imageCollectionMemories', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'imageKey'], unique: true }, { fields: ['scopeKey', 'createdAt'] }] },
  { name: 'collectionMembers', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'collectionKey', 'memberKey'], unique: true }, { fields: ['scopeKey', 'collectionKey', 'role'] }, { fields: ['scopeKey', 'memberKey'] }] },
  { name: 'collectionInvites', skipEmbedding: true, indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['scopeKey', 'collectionKey'] }, { fields: ['expiresAt'] }, { fields: ['acceptedAt'], sparse: true }, { fields: ['revokedAt'], sparse: true }] },
  { name: 'tags', embedKeys: ['normalizedName', 'description'], indexes: [{ fields: ['scopeKey', 'userKey', 'normalizedName'], unique: true }] },
  { name: 'tagAssignments', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'tagKey', 'sourceType', 'sourceKey'], unique: true }, { fields: ['scopeKey', 'sourceType', 'sourceKey'] }, { fields: ['scopeKey', 'tagKey'] }] },
  { name: 'documents', embedKeys: ['name', 'content'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'folderKey'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['storageKey'], unique: true, sparse: true }, { fields: ['folderKey', 'name'] }, { fields: ['scopeKey', 'managedPurpose', 'managedOwnerKey'], unique: true, sparse: true }] },
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
  { name: 'tripGuides', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'tripKey', 'createdAt'] }, { fields: ['scopeKey', 'userKey', 'idempotencyKey'], unique: true }] },
  { name: 'placeReferences', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'placeKey', 'kind', 'createdAt'] }, { fields: ['scopeKey', 'userKey', 'idempotencyKey'], unique: true }] },
  { name: 'placeHeroMedia', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'placeKey'], unique: true }, { fields: ['storageKey'], unique: true }] },
  { name: 'countries', embedKeys: ['name'], indexes: [{ fields: ['countryCode'], unique: true }, { fields: ['name'] }] },
  { name: 'books', embedKeys: ['title', 'subtitle', 'description', 'goal', 'audience', 'outcome'], indexes: [{ fields: ['scopeKey'] }, { fields: ['scopeKey', 'status'] }, { fields: ['status', 'generationLeaseExpiresAt'] }, { fields: ['scopeKey', 'isFavorite'] }, { fields: ['scopeKey', 'generationRequestKey'], unique: true, sparse: true }, { fields: ['scopeKey', 'archiveFolderKey'], unique: true, sparse: true }] },
  { name: 'bookContexts', embedKeys: ['userContext', 'priorKnowledge', 'priorBookContext', 'personalizationContext', 'researchContext', 'noveltyContext', 'generationBrief'], indexes: [{ fields: ['scopeKey', 'bookKey'], unique: true }] },
  { name: 'bookThemes', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }] },
  { name: 'bookSources', embedKeys: ['title', 'content', 'relevance'], indexes: [{ fields: ['scopeKey', 'bookKey'] }, { fields: ['scopeKey', 'bookKey', 'sourceType'] }, { fields: ['scopeKey', 'sourceType', 'sourceKey'], sparse: true }] },
  { name: 'bookParts', embedKeys: ['title', 'description', 'objective'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }] },
  { name: 'bookChapters', embedKeys: ['title', 'description', 'objective', 'topics', 'content'], indexes: [{ fields: ['scopeKey', 'bookKey', 'position'], unique: true }, { fields: ['scopeKey', 'bookKey'] }, { fields: ['scopeKey', 'partKey'], sparse: true }, { fields: ['scopeKey', 'archiveDocumentKey'], unique: true, sparse: true }] },
  { name: 'chapterContexts', embedKeys: ['previousContext', 'objectiveContext', 'sourceContext', 'personalizationContext', 'noveltyContext', 'nextContext', 'generationBrief'], indexes: [{ fields: ['scopeKey', 'chapterKey'], unique: true }] },
  { name: 'bookProgress', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'bookKey', 'chapterKey'], unique: true }, { fields: ['scopeKey', 'userKey', 'bookKey'] }, { fields: ['scopeKey', 'userKey', 'isCompleted'] }] },
  // Private durable extension intents consumed by the existing per-book generation queue.
  { name: 'bookExtensions', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'bookKey', 'requestKey'], unique: true }, { fields: ['scopeKey', 'bookKey', 'status'] }] },
  // Private exact-once outbox for terminal fixed-charge refunds.
  { name: 'bookRefundIntents', skipEmbedding: true, indexes: [{ fields: ['chargeTransactionKey'], unique: true }, { fields: ['status', 'createdAt'] }, { fields: ['leaseExpiresAt'], sparse: true }] },
  // Private Signal persistence. These collections are intentionally absent from NODE_REGISTRY.
  { name: 'emailInboxes', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'connectorKey'], unique: true }, { fields: ['organizationKey', 'scopeKey'] }] },
  { name: 'emailThreads', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'accountKey', 'providerThreadId'], unique: true }, { fields: ['scopeKey', 'accountKey', 'lastMessageAt'] }, { fields: ['scopeKey', 'accountKey', 'inboxCategory'] }] },
  { name: 'emailMessages', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'accountKey', 'providerMessageId'], unique: true }, { fields: ['scopeKey', 'threadKey', 'sentAt'] }, { fields: ['scopeKey', 'accountKey', 'embeddingContentVersion'] }] },
  { name: 'emailDrafts', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'status', 'updatedAt'] }, { fields: ['scopeKey', 'threadKey'], sparse: true }, { fields: ['scopeKey', 'accountKey'], sparse: true }, { fields: ['providerMessageId'], unique: true, sparse: true }] },
  { name: 'emailTones', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'slug'], unique: true, sparse: true }, { fields: ['scopeKey', 'isFavorite'] }] },
  { name: 'emailReplyContext', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'updatedAt'] }] },
  { name: 'emailWritingProfiles', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'updatedAt'] }] },
  { name: 'emailAttachments', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'connectorKey', 'providerMessageId', 'partPath'], unique: true }, { fields: ['storageKey'], unique: true, sparse: true }, { fields: ['scopeKey', 'status'] }, { fields: ['leaseExpiresAt'], sparse: true }] },
  // Private replay ledger. Responses may contain one-time share tokens, so this
  // collection is deliberately not registered as a generic application node.
  { name: 'contentIdempotency', skipEmbedding: true, indexes: [{ fields: ['organizationKey', 'actorKey', 'tool', 'idempotencyKey'], unique: true }, { fields: ['leaseExpiresAt'], sparse: true }, { fields: ['expiresAt'], sparse: true }] },
  // Private global user history. Identity is deliberately independent of every product and scope.
  { name: 'userSearches', skipEmbedding: true, indexes: [{ fields: ['userKey', 'normalizedQuery'], unique: true }, { fields: ['userKey', 'searchedAt'] }] },
  // Private Core conversations. Assistant embeddings are written only after completed turns.
  { name: 'conversations', skipEmbedding: true, indexes: [{ fields: ['organizationKey', 'scopeKey', 'userKey', 'isFavorite', 'updatedAt'] }, { fields: ['organizationKey', 'scopeKey', 'userKey', 'updatedAt'] }] },
  { name: 'conversationMessages', skipEmbedding: true, indexes: [{ fields: ['conversationKey', 'userKey', 'turnKey', 'role'], unique: true }, { fields: ['organizationKey', 'scopeKey', 'userKey', 'conversationKey', 'createdAt'] }, { fields: ['conversationKey', 'role', 'status'] }] },
  // Private support requests. Access is only through the canonical ticket service.
  { name: 'tickets', embedKeys: ['message'], indexes: [{ fields: ['organizationKey', 'scopeKey', 'type', 'createdAt'] }, { fields: ['organizationKey', 'scopeKey', 'userKey', 'createdAt'] }, { fields: ['organizationKey', 'userKey', 'idempotencyKey'], unique: true }] },
  // Private per-user feedback votes. Counts on tickets are derived from this collection.
  { name: 'ticketVotes', skipEmbedding: true, indexes: [{ fields: ['ticketKey', 'userKey'], unique: true }, { fields: ['scopeKey', 'ticketKey'] }, { fields: ['userKey'] }] },
  // Private generation prompt history. Generated media and storage references never belong here.
  { name: 'userGenerations', skipEmbedding: true, indexes: [{ fields: ['userKey', 'type', 'normalizedPrompt'], unique: true }, { fields: ['userKey', 'type', 'generatedAt'] }] },
  // Private durable outbox for object deletion after metadata commits.
  { name: 'storageDeletionJobs', skipEmbedding: true, indexes: [{ fields: ['storageKey'], unique: true }, { fields: ['createdAt'] }, { fields: ['status'] }, { fields: ['reservationExpiresAt'], sparse: true }, { fields: ['claimedAt'], sparse: true }] },
  // Private Archive contextual replay cache. The collection itself identifies the context.
  { name: 'contentSearchQueries', skipEmbedding: true, indexes: [{ fields: ['actorKey', 'scopeKey', 'normalizedQuery', 'folderKey', 'includeDescendants'], unique: true }, { fields: ['actorKey', 'scopeKey', 'searchedAt'] }] },
  // Pure link nodes (scope tree edges, scope memberships) — ids only, so
];

const droppedCollections = [
  'orgCredentials',
  'organizationProviders',
  'organization_providers',
  'modelProviders',
  'models',
  'providers',
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
  'modelActions',
  'agentArtifactsLegacy',
  'agentRunsLegacy',
  'agent_runs',
  'agentTools',
  'toolActions',
  'tools',
  'templates',
  'placeVisits',
  'emailAccounts',
  'emailContacts',
  'emailRules',
  'emailReplyDrafts',
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
  await migrateMinimalPlacesAndRetireTrips(targetDb);
  await migrateTripAttachments(targetDb);
  await migrateEmailInitialSyncCompletion(targetDb);

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
  for (const spec of collections) {
    const collection = targetDb.collection(spec.name);
    const exists = await collection.exists();
    if (!exists) {
      await collection.create();
      console.log(`Created collection ${spec.name}`);
    }
    if (spec.name === 'apps') {
      await collection.ensureIndex({ type: 'persistent', fields: ['slug'], unique: true, sparse: false });
      await seedApps(createAppsRepository(targetDb));
    }
    if (spec.name === 'processedWebhookEvents') {
      await targetDb.query(`
        FOR event IN processedWebhookEvents
          FILTER event.provider == "polar"
          REMOVE event IN processedWebhookEvents
      `);
    }
    if (spec.name === 'tickets') await migrateTicketTypes(targetDb);
    if (spec.name === 'folders' || spec.name === 'images' || spec.name === 'collections' || spec.name === 'documents') {
      await migrateContentFavorites(targetDb, spec.name);
    }
    if (spec.name === 'images') {
      await targetDb.query('FOR image IN images FILTER !HAS(image, "origin") UPDATE image WITH { origin: "uploaded" } IN images');
      await targetDb.query('FOR image IN images FILTER !HAS(image, "mutationPolicy") UPDATE image WITH { mutationPolicy: "user" } IN images');
    }
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
    if (spec.name === 'conversationMessages') {
      await targetDb.query('FOR message IN conversationMessages FILTER !HAS(message, "type") UPDATE message WITH { type: "TEXT" } IN conversationMessages');
      await targetDb.query('FOR message IN conversationMessages FILTER !IS_STRING(message.requestHash) || !REGEX_TEST(message.requestHash, "^[a-f0-9]{64}$") LET userMessage = message.role == "USER" ? message : FIRST(FOR candidate IN conversationMessages FILTER candidate.conversationKey == message.conversationKey && candidate.turnKey == message.turnKey && candidate.role == "USER" LIMIT 1 RETURN candidate) LET payload = userMessage == null ? message.content : userMessage.content UPDATE message WITH { requestHash: SHA256(CONCAT_SEPARATOR("\\u0000", message.conversationKey, payload)) } IN conversationMessages');
    }
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
    if (spec.name === 'tags') {
      await migrateScopeTags(targetDb);
      await migrateExactSemanticRecords(targetDb, 'tags', ['normalizedName', 'description']);
    }
    if (spec.name === 'visualIdentities') await migrateExactSemanticRecords(targetDb, 'visualIdentities', ['name', 'description']);
    if (spec.name === 'collections' || spec.name === 'tags') {
      await targetDb.query(`FOR resource IN @@collection FILTER IS_STRING(resource.description) && LENGTH(TRIM(resource.description)) == 0 UPDATE resource WITH { description: null } IN @@collection OPTIONS { keepNull: false }`, { '@collection': spec.name });
    }
    if (spec.name === 'documents') {
      await targetDb.query(`FOR document IN documents
        LET folder = DOCUMENT(folders, document.folderKey)
        FILTER folder != null && folder.scopeKey == document.scopeKey && folder.purpose == "communication-mail-tones" && STARTS_WITH(TRIM(document.content), "{")
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-tone" && payload.version == 1
        LET tone = payload.data
        LET metadata = MERGE({ version: 1 }, tone.identifier != null ? { identifier: tone.identifier } : {}, tone.slug != null ? { slug: tone.slug } : {})
        LET content = CONCAT("# ", tone.name, "\n\n<!-- vorinthex-mail-tone ", JSON_STRINGIFY(metadata), " -->\n\n## Instruction\n\n", tone.instruction)
        UPDATE document WITH { content, mutationPolicy: "user" } IN documents`);
      await migrateEmailInboxCategoriesAndDefaultTones(targetDb);
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
      await migrateEmailToneEmbeddings(targetDb);
      await migrateContentDocuments(targetDb);
    }
    if (spec.name === 'documentVersions') {
      await migrateContentVersions(targetDb);
    }
    if (spec.name === 'shares') {
      await migrateContentShares(targetDb);
    }
    if (spec.name === 'events') {
      await migrateEventAppKeys(targetDb);
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

  await migrateRetiredEmailDefaultTones(targetDb);
  await migrateDurableBookGeneration(targetDb);
  await migrateGeneratedTravelDocuments(targetDb);
  await migrateManagedGeneratedMedia(targetDb);

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

  await ensureOrganizationConnectorsCollection(targetDb);
  await retireUnsupportedEmailConnectors(targetDb);
  await migrateProviderIndependentEmailDrafts(targetDb);
  await migrateCanonicalEmailPersistence(targetDb);
  await migrateCanonicalEmailEmbeddings(targetDb);
  await migrateEmailAttachmentAvailability(targetDb);
  await migrateContainerPresentations(targetDb);
  await dropVerifiedLegacyInboxes(targetDb);

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
        || !HAS(u, "microSparkBalance")
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
        guestBootstrapSecretHash: HAS(u, "guestBootstrapSecretHash") ? u.guestBootstrapSecretHash : null,
        microSparkBalance: HAS(u, "microSparkBalance") && IS_NUMBER(u.microSparkBalance) ? MAX([0, u.microSparkBalance]) : 0
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
  await migrateUserCurrentScopes(targetDb);
  await migrateSparkAccounts(targetDb);

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
  await migrateInboxBilling(targetDb);

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
