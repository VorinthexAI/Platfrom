import { describe, expect, test } from 'bun:test';
import { isLegacyIndex, LEGACY_REMOVAL_MARKER, normalizeLegacyDocumentSharePermission } from './arango-migrate-indexes';
import { stageLegacyDocumentShares } from './content-migration';
import { collections, migrateContainerPresentations, migrateContentDocuments, migrateContentFavorites, migrateContentVersions, migrateGeneratedTravelDocuments, migrateImageCaptions, migrateManagedGeneratedMedia, migrateMinimalPlacesAndRetireTrips, migratePlaceReports, migrateProviderIndependentEmailDrafts, migrateRetiredEmailDefaultTones, migrateTicketTypes, migrateTripAttachments, migrateTripCreationReceipts, migrateTripGuides, needsExactSemanticEmbedding, retireMomentumScope, retireUserSettings } from './arango-migrate';
import { EMBEDDING_DIMENSIONS, LEGACY_EMBEDDING_DIMENSIONS, embeddingMetadata } from '../lib/embeddings';
import { DOCUMENT_CHUNK_MAX_WORDS, DOCUMENT_MAX_CHUNKS, documentSemanticHash } from '../lib/ai/document-processing/chunking';
import { emailArchiveRootFolderKey, emailMediaCollectionKey } from '../lib/email-inbox/export-container-keys';

function migrationDatabase(collection: 'documents' | 'documentVersions', row: Record<string, unknown>) {
  let page = 0;
  let update: { query: string; bindVars?: Record<string, unknown> } | undefined;
  const database = {
    async query(query: string, bindVars?: Record<string, unknown>) {
      if (query.includes(`RETURN ${collection === 'documents' ? 'document' : 'snapshot'}`) && !query.includes('RETURN LENGTH')) {
        const rows = page++ === 0 ? [row] : [];
        return { async all() { return rows; }, async next() { return undefined; } };
      }
      if (query.includes('FOR patch IN @updates')) {
        update = { query, bindVars };
        return { async all() { return []; }, async next() { return undefined; } };
      }
      if (query.includes('RETURN LENGTH')) return { async all() { return []; }, async next() { return 0; } };
      throw new Error(`Unexpected migration query: ${query}`);
    },
    async beginTransaction() {
      return { async step(run: () => Promise<void>) { await run(); }, async commit() {}, async abort() {} };
    },
  };
  return { database: database as never, get update() { return update; } };
}

describe('Arango migration indexes', () => {
  test('backfills app-logo presentation metadata for legacy managed containers', async () => {
    const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
    const connectorKey = 'cmrnlzf650002qc7k4p5zem5w';
    const queries: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    await migrateContainerPresentations({ query: async (query: string, bindVars?: Record<string, unknown>) => {
      queries.push({ query, bindVars });
      return { all: async () => query.includes('FOR inbox IN emailInboxes') ? [{ scopeKey, connectorKey }] : [] };
    } } as never);
    expect(queries).toHaveLength(3);
    expect(queries[1]!.query).toContain('folder.parentFolderKey != null ? null');
    expect(queries[1]!.query).toContain('folder._key IN @communicationFolderKeys ? "communication"');
    expect(queries[1]!.query).toContain('folder.purpose == "generated-audio-root" ? "learning"');
    expect(queries[1]!.query).toContain('STARTS_WITH(folder.managedPurpose || "", "mail-") ? "communication"');
    expect(queries[1]!.query).toContain('folder.purpose IN ["generated-documents-root"');
    expect(queries[1]!.query).toContain('OPTIONS { keepNull: false }');
    expect(queries[1]!.bindVars?.communicationFolderKeys).toEqual([emailArchiveRootFolderKey(scopeKey)]);
    expect(queries[2]!.query).toContain('collection._key IN @communicationCollectionKeys ? "communication"');
    expect(queries[2]!.query).toContain('collection.purpose == "place-media" ? "travel"');
    expect(queries[2]!.query).toContain('collection.purpose == "email-media" ? "communication"');
    expect(queries[2]!.bindVars?.communicationCollectionKeys).toEqual([emailMediaCollectionKey(scopeKey)]);
    expect(queries.slice(1).every(({ query }) => query.includes('presentation != null') && query.includes('presentation != presentation'))).toBe(true);
  });

  test('renames the generated-media collection and makes its generated images user-mutable', async () => {
    const queries: string[] = [];
    await migrateManagedGeneratedMedia({ query: async (query: string) => { queries.push(query); return { all: async () => [] }; } } as never);
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('collection.name == "Generated media"');
    expect(queries[0]).toContain('{ name: "Core" }');
    expect(queries[1]).toContain('collection.purpose == "generated-media"');
    expect(queries[1]).toContain('{ mutationPolicy: "user" }');
    expect(queries[2]).toContain('collection.purpose == "generated-media"');
    expect(queries[2]).toContain('{ mutationPolicy: "user" }');
  });

  test('regenerates only malformed exact semantic vectors', () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => index + 1);

    expect(needsExactSemanticEmbedding(embedding)).toBe(false);
    expect(needsExactSemanticEmbedding(embedding.slice(1))).toBe(true);
    expect(needsExactSemanticEmbedding(Array(EMBEDDING_DIMENSIONS).fill(0))).toBe(true);
    expect(needsExactSemanticEmbedding([...embedding.slice(0, -1), Number.NaN])).toBe(true);
  });

  test('defers retryable semantic provider outages without masking data errors', async () => {
    const migration = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const backfill = await Bun.file(new URL('../../scripts/backfill-semantic-embeddings.ts', import.meta.url)).text();

    expect(migration).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
    expect(migration).toContain('remain eligible for retry after the provider recovers');
    expect(backfill).toContain('Semantic embedding backfill deferred because');
    expect(backfill).toContain('if (!isProviderError(error) || !error.retryable) throw error;');
  });

  test('retires non-Gmail connector credentials before strict Gmail backfill reads', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(image, "origin") UPDATE image WITH { origin: "uploaded" } IN images');
    const retire = source.indexOf('await retireUnsupportedEmailConnectors(targetDb)');
    const backfill = source.indexOf('await migrateCanonicalEmailPersistence(targetDb)');
    expect(retire).toBeGreaterThan(-1);
    expect(retire).toBeLessThan(backfill);
    expect(source).toContain('FILTER connector.provider != "gmail"');
    expect(source).toContain('encryptedCredentials: null');
    expect(source).toContain('await migrateEmailAttachmentAvailability(targetDb)');
  });
  test('hard-drops retired persistence without recreating it and retains collaboration collections', async () => {
    const retired = ['orgCredentials', 'organizationProviders', 'organization_providers', 'modelProviders', 'models', 'providers', 'agents', 'skills', 'agentSkills', 'scopeAgents', 'agentMembers', 'agentRuns', 'agentRunSteps', 'agentRunCalls', 'agentRunSources', 'agentArtifacts', 'agentArtifactChecks', 'agentMemories', 'runtimeVariables', 'capabilities', 'mindCapabilities', 'minds', 'actions', 'modelActions', 'agentArtifactsLegacy', 'agentRunsLegacy', 'agent_runs', 'agentTools', 'toolActions', 'tools', 'templates'];
    expect(collections.filter(({ name }) => retired.includes(name))).toEqual([]);
    for (const retained of ['scopes', 'channels', 'channelParticipants', 'orchestrators']) expect(collections.some(({ name }) => name === retained)).toBe(true);
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    for (const retained of ['ensureScopeScopesCollection', 'ensureScopeMembersCollection']) expect(source).toContain(retained);
    for (const name of retired) {
      expect(source).toContain(`'${name}',`);
      expect(source).not.toContain(`{ name: '${name}'`);
      expect(source).not.toContain(`collection('${name}').create`);
    }
    expect(source).not.toMatch(/ensure(?:Agent|RuntimeVariable|Skill|Action|Capability|Mind)/);
    expect(source).not.toContain('migrateModelActionSlugs');
    expect(source).not.toContain('IN modelActions');
  });
  test('removes retired actions from semantic backfill and global retrieval policy', async () => {
    const backfill = await Bun.file(new URL('../../scripts/backfill-semantic-embeddings.ts', import.meta.url)).text();
    const base = await Bun.file(new URL('../lib/db/base.ts', import.meta.url)).text();
    expect(backfill).not.toContain("'actions'");
    expect(base).not.toContain("'actions'");
  });
  test('creates persistent highlights under the exact required collection name with read indexes', () => {
    const spec = collections.find(({ name }) => name === 'imageCollecitionHightlights');
    expect(spec).toEqual(expect.objectContaining({ name: 'imageCollecitionHightlights', skipEmbedding: true }));
    expect(spec?.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: ['scopeKey', 'collectionKey', 'createdAt'] }),
      expect.objectContaining({ fields: ['scopeKey', 'createdByKey'] }),
    ]));
  });
  test('creates one memory per scoped image and owner-scoped identities', () => {
    const spec = collections.find(({ name }) => name === 'imageCollectionMemories');
    expect(spec).toEqual(expect.objectContaining({ name: 'imageCollectionMemories', skipEmbedding: true }));
    expect(spec?.indexes).toContainEqual({ fields: ['scopeKey', 'imageKey'], unique: true });
    const identities = collections.find(({ name }) => name === 'visualIdentities');
    expect(identities?.indexes).toEqual(expect.arrayContaining([{ fields: ['scopeKey', 'createdByKey'] }, { fields: ['scopeKey', 'createdByKey', 'name'] }]));
  });
  test('backfills visual identity owners and transactionally removes unresolved identities after their relations', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const transaction = source.indexOf("withDatabaseTransaction(targetDb, { write: ['visualIdentities', 'imageIdentities'] }");
    const backfill = source.indexOf('UPDATE identity WITH { createdByKey: reference.createdByKey }', transaction);
    const relationCleanup = source.indexOf('REMOVE relation IN imageIdentities', backfill);
    const identityCleanup = source.indexOf('REMOVE identity IN visualIdentities', relationCleanup);
    expect(transaction).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(transaction);
    expect(relationCleanup).toBeGreaterThan(backfill);
    expect(identityCleanup).toBeGreaterThan(relationCleanup);
    expect(source.slice(transaction, identityCleanup)).toContain('!IS_STRING(identity.createdByKey) || LENGTH(TRIM(identity.createdByKey)) == 0');
  });
  test('creates the private user hidden overlay with unique and cleanup indexes', async () => {
    const spec = collections.find(({ name }) => name === 'userHiddens');
    expect(spec).toEqual(expect.objectContaining({ name: 'userHiddens', skipEmbedding: true }));
    expect(spec?.indexes).toEqual(expect.arrayContaining([
      { fields: ['userKey', 'source', 'sourceKey'], unique: true },
      { fields: ['userKey', 'createdAt'] },
      { fields: ['source', 'sourceKey'] },
    ]));
    const registry = await Bun.file(new URL('../lib/db/registry.ts', import.meta.url)).text();
    expect(registry).not.toContain('userHiddens:');
  });
  test('backfills legacy ticket types and declares private feedback vote indexes', async () => {
    const calls: string[] = [];
    await migrateTicketTypes({ query: async (query: string) => { calls.push(query); return {} as never; } } as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('type: HAS(ticket, "type") ? ticket.type : "issue"');
    expect(calls[0]).toContain('ticket.type == "feedback"');
    expect(collections.find(({ name }) => name === 'tickets')?.indexes).toContainEqual({ fields: ['organizationKey', 'scopeKey', 'type', 'createdAt'] });
    expect(collections.find(({ name }) => name === 'ticketVotes')).toEqual({ name: 'ticketVotes', skipEmbedding: true, indexes: [{ fields: ['ticketKey', 'userKey'], unique: true }, { fields: ['scopeKey', 'ticketKey'] }, { fields: ['userKey'] }] });
  });
  test('physically retires the legacy settings blob when users already exist', async () => {
    const calls: string[] = [];
    const database = {
      collection() { return { async exists() { return true; } }; },
      async query(query: string) { calls.push(query); return { async all() { return []; }, async next() { return undefined; } }; },
    };
    await retireUserSettings(database as never);
    expect(calls).toEqual([expect.stringContaining('UPDATE user WITH { settings: null }')]);
    expect(calls[0]).toContain('OPTIONS { keepNull: false }');
  });
  test('additively backfills canonical image captions and image references', async () => {
    const calls: string[] = [];
    const database = {
      async query(query: string) {
        calls.push(query);
        return { async all() { return []; }, async next() { return 0; } };
      },
    };
    await migrateImageCaptions(database as never);
    expect(calls.some((query) => query.includes('INTO imageCaptions OPTIONS { overwriteMode: "ignore" }'))).toBe(true);
    expect(calls.filter((query) => query.includes('INTO imageCaptions')).every((query) => query.includes('FILTER image.imageCaptionKey == null'))).toBe(true);
    expect(calls.some((query) => query.includes('UPDATE image WITH { imageCaptionKey: image._key } IN images'))).toBe(true);
    expect(calls.some((query) => query.includes('caption.perceptualHash'))).toBe(false);
    expect(collections.find(({ name }) => name === 'imageCaptions')?.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ fields: ['scopeKey', 'hashAlgorithm', 'perceptualHash'], sparse: true }),
    ]));
    expect(collections.find(({ name }) => name === 'imageCaptions')?.indexes?.find(({ fields }) => fields.join('.') === 'scopeKey.hashAlgorithm.perceptualHash')?.unique).not.toBe(true);
    expect(calls.at(-1)).not.toContain('caption.embedding != image.embedding');
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('Dropped obsolete unique image-caption pHash index');
    expect(source).toContain("migrateExactSemanticRecords(targetDb, 'imageCaptions', ['caption'])");
    expect(source).toContain("migrateExactSemanticRecords(targetDb, 'visualIdentities', ['name', 'description'])");
  });
  test('removes the retired execution-workspace scope and access relations', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return query.includes('RETURN scope._key') ? ['scope-key'] : []; }, async next() { return undefined; } }; } };
    await retireMomentumScope(database as never, 'organization-key', 'archive-scope-key');
    expect(calls).toHaveLength(13);
    const contentMoves = calls.slice(1, 10);
    expect(contentMoves.map(({ bindVars }) => bindVars?.['@collection'])).toEqual(['folders', 'tags', 'tagAssignments', 'documents', 'documentVersions', 'documentAudioVersions', 'documentSummaries', 'documentSummaryAudio', 'shares']);
    expect(contentMoves.every(({ query, bindVars }) => query.includes('UPDATE resource WITH { scopeKey: @archiveScopeKey }') && bindVars?.archiveScopeKey === 'archive-scope-key')).toBe(true);
    expect(calls.map(({ query }) => query).join('\n')).toContain('REMOVE relation IN scopeScopes');
    expect(calls.map(({ query }) => query).join('\n')).toContain('REMOVE relation IN scopeMembers');
    expect(calls.at(-1)?.query).toContain('REMOVE scope IN scopes');
  });

  test('normalizes legacy share permissions without granting additional access', () => {
    expect(normalizeLegacyDocumentSharePermission('read')).toBe('read');
    expect(normalizeLegacyDocumentSharePermission('view')).toBe('read');
    expect(normalizeLegacyDocumentSharePermission('comment')).toBe('comment');
    expect(normalizeLegacyDocumentSharePermission('edit')).toBe('comment');
    expect(normalizeLegacyDocumentSharePermission(undefined)).toBe('read');
  });
  test('drops obsolete search uniqueness and expiry indexes', () => {
    expect(isLegacyIndex('contentSearchQueries', ['actorKey', 'scopeKey', 'normalizedQuery'])).toBe(true);
    expect(isLegacyIndex('contentSearchQueries', ['expiresAt'])).toBe(true);
    expect(isLegacyIndex('contentSearchQueries', ['actorKey', 'scopeKey', 'normalizedQuery', 'folderKey', 'includeDescendants'])).toBe(false);
    expect(isLegacyIndex('contentSearchQueries', ['actorKey', 'scopeKey', 'contextDomain', 'normalizedQuery', 'folderKey', 'includeDescendants'])).toBe(true);
  });
  test('never classifies a currently desired index as legacy', () => {
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['storageKey']])).toBe(false);
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['documentKey', 'version']])).toBe(true);
  });
  test('retires single Gmail binding uniqueness but preserves account uniqueness', () => {
    const desired = [['organizationKey', 'scopeKey', 'provider', 'providerAccountId']];
    expect(isLegacyIndex('organizationConnectors', ['organizationKey', 'scopeKey', 'provider'], desired)).toBe(true);
    expect(isLegacyIndex('organizationConnectors', desired[0]!, desired)).toBe(false);
  });
  test('declares the exact email attachment binding ownership and recovery indexes', () => {
    expect(collections.find(({ name }) => name === 'emailAttachmentBindings')).toEqual({
      name: 'emailAttachmentBindings',
      skipEmbedding: true,
      indexes: [
        { fields: ['scopeKey', 'connectorKey', 'providerMessageId', 'partPath'], unique: true },
        { fields: ['targetType', 'targetKey'], unique: true },
        { fields: ['scopeKey'] },
        { fields: ['leaseExpiresAt'], sparse: true },
      ],
    });
  });
  test('drops every obsolete tombstone index without preserving the retired field in source', () => {
    expect(isLegacyIndex('collections', ['scopeKey', LEGACY_REMOVAL_MARKER])).toBe(true);
    expect(isLegacyIndex('documents', ['scopeKey', 'folderKey', LEGACY_REMOVAL_MARKER])).toBe(true);
    expect(LEGACY_REMOVAL_MARKER).toBe(['deleted', 'At'].join(''));
  });
  test('hard-removes legacy tombstones and reconciles their indexes for every affected collection', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    for (const name of ['scopes', 'scopeScopes', 'folders', 'images', 'visualIdentities', 'collections', 'imageCollecitionHightlights', 'documents', 'documentVersions', 'shares', 'places', 'trips', 'books', 'messages']) {
      expect(source).toContain(`'${name}'`);
    }
    expect(source).toContain('resource[@marker] != null');
    expect(source).toContain('REMOVE resource IN @@collection');
    expect(source).toContain('attachment.targetType == @targetType && attachment.targetKey IN @keys');
    expect(source.indexOf("await removeAttachmentTargets('collection', collectionKeys)")).toBeLessThan(source.indexOf("await removeKeys('collections', collectionKeys)"));
    expect(source.indexOf('FOR trip IN trips FILTER trip.coverImageKey IN @keys')).toBeLessThan(source.indexOf("await removeKeys('images', imageKeys)"));
    for (const [owner, collection] of [['collection', 'collections'], ['folder', 'folders'], ['document', 'documents'], ['trip', 'trips']]) expect(source).toContain(`FOR ${owner} IN ${collection} FILTER ${owner}.coverImageKey IN @keys UPDATE ${owner} WITH { coverImageKey: null, updatedAt: @now }`);
    expect(source.indexOf("await removeBy('tripAttachments', 'tripKey', tripKeys)")).toBeLessThan(source.indexOf("await removeKeys('trips', tripKeys)"));
    expect(source.indexOf("await removeTyped('shares', 'sourceType', 'book', bookKeys, 'books')")).toBeLessThan(source.indexOf("await removeKeys('books', bookKeys)"));
    expect(source).toContain('fields.includes(LEGACY_REMOVAL_MARKER)');
    expect(source).toContain('OPTIONS { keepNull: false }');
  });
  test('declares private independent document audio version indexes', () => {
    const audio = collections.find(({ name }) => name === 'documentAudioVersions');
    expect(audio?.skipEmbedding).toBe(true);
    expect(audio?.indexes).toContainEqual({ fields: ['scopeKey', 'documentKey', 'version'], unique: true });
    expect(audio?.indexes).toContainEqual({ fields: ['scopeKey', 'documentKey', 'isCurrent'] });
    expect(audio?.indexes).toContainEqual({ fields: ['storageKey'], unique: true });
  });
  test('backfills document audio playback state without selecting legacy versions', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(audio, "isCurrent") || !HAS(audio, "playbackPositionMs")');
    expect(source).toContain('isCurrent: HAS(audio, "isCurrent") ? audio.isCurrent : false');
    expect(source).toContain('playbackPositionMs: HAS(audio, "playbackPositionMs") ? audio.playbackPositionMs : 0');
  });
  test('declares private immutable document summary indexes', () => {
    const summaries = collections.find(({ name }) => name === 'documentSummaries');
    expect(summaries?.skipEmbedding).toBe(true);
    expect(summaries?.indexes).toContainEqual({ fields: ['documentKey', 'version'], unique: true });
    expect(summaries?.indexes).toContainEqual({ fields: ['scopeKey', 'documentKey', 'createdAt'] });
  });
  test('declares sparse direct-channel identity uniqueness and poll vote uniqueness', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("{ fields: ['organizationKey', 'kind', 'name'], unique: true, sparse: true }");
    expect(source).toContain("{ fields: ['pollKey', 'optionKey', 'participantKey'], unique: true }");
    expect(source).toContain("fields[0] === 'scopeKey' && fields[1] === 'name'");
    expect(source).toContain('Dropped obsolete unique channel-name index');
    expect(source).toContain('@isImage && (HAS(resource, "ownerKey") || HAS(resource, "requestHash"))');
    expect(source).not.toContain('@collection == "images"');
    expect(source).not.toContain('{ after, dimensions, provider: EMBEDDING_PROVIDER_ID, model: EMBEDDING_MODEL }');
    const backfill = await Bun.file(new URL('../../scripts/backfill-semantic-embeddings.ts', import.meta.url)).text();
    expect(backfill).toContain('spec.includeMetadata ? { ...values, provider: EMBEDDING_PROVIDER_ID, model: EMBEDDING_MODEL } : values');
    expect(backfill).toContain('...(spec.includeMetadata ? { embedKeys: spec.embedKeys } : {})');
  });
  test('allows sibling folders to share names', async () => {
    const folderNameIndex = collections.find(({ name }) => name === 'folders')?.indexes?.find(({ fields }) => fields.join('.') === 'scopeKey.parentFolderKey.name');
    expect(folderNameIndex?.unique).not.toBe(true);
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('Dropped obsolete unique folder-name index');
  });
  test('declares exact managed audiobook folder ownership uniqueness', () => {
    expect(collections.find(({ name }) => name === 'folders')?.indexes).toContainEqual({ fields: ['scopeKey', 'managedPurpose', 'managedOwnerKey'], unique: true, sparse: true });
  });
  test('declares private ticket idempotency and canonical profile storage indexes', () => {
    expect(collections.find(({ name }) => name === 'tickets')).toEqual({
      name: 'tickets',
      embedKeys: ['message'],
      indexes: [
        { fields: ['organizationKey', 'scopeKey', 'type', 'createdAt'] },
        { fields: ['organizationKey', 'scopeKey', 'userKey', 'createdAt'] },
        { fields: ['organizationKey', 'userKey', 'idempotencyKey'], unique: true },
      ],
    });
    expect(collections.find(({ name }) => name === 'users')?.indexes).toContainEqual({ fields: ['profileStorageKey'], unique: true, sparse: true });
  });
  test('retains minimal places and private ordered trips and declares book-generation collection indexes', async () => {
    expect(collections.filter(({ name }) => ['places', 'generatedDocumentBindings', 'trips', 'tripCreationReceipts', 'tripPlaces', 'tripAttachments', 'placeVisits'].includes(name)).map(({ name }) => name)).toEqual(['places', 'generatedDocumentBindings', 'trips', 'tripCreationReceipts', 'tripPlaces', 'tripAttachments']);
    expect(collections.find(({ name }) => name === 'places')).toEqual({
      name: 'places',
      embedKeys: ['name', 'summary'],
      indexes: [
        { fields: ['scopeKey', 'userKey', 'saved'] },
        { fields: ['scopeKey', 'userKey', 'openedAt'], sparse: true },
        { fields: ['scopeKey', 'userKey', 'countryCode'] },
        { fields: ['scopeKey', 'userKey', 'countryCode', 'name'], unique: true },
      ],
    });
    expect(collections.find(({ name }) => name === 'trips')).toEqual({ name: 'trips', embedKeys: ['name', 'description'], indexes: [{ fields: ['scopeKey', 'userKey', 'createdAt'] }, { fields: ['scopeKey', 'coverImageKey'], sparse: true }] });
    expect(collections.find(({ name }) => name === 'generatedDocumentBindings')).toEqual({ name: 'generatedDocumentBindings', skipEmbedding: true, indexes: [{ fields: ['documentKey'], unique: true }, { fields: ['scopeKey', 'subjectType', 'subjectKey', 'kind', 'createdAt'] }, { fields: ['scopeKey', 'createdByKey', 'idempotencyKey'], unique: true }] });
    expect(collections.find(({ name }) => name === 'tripCreationReceipts')).toEqual({ name: 'tripCreationReceipts', skipEmbedding: true, indexes: [{ fields: ['scopeKey', 'userKey', 'createdAt'] }, { fields: ['scopeKey', 'tripKey'], unique: true }] });
    expect(collections.find(({ name }) => name === 'tripPlaces')?.indexes).toEqual([
      { fields: ['scopeKey', 'tripKey', 'position'], unique: true },
      { fields: ['scopeKey', 'tripKey', 'placeKey'], unique: true },
      { fields: ['scopeKey', 'placeKey'] },
    ]);
    expect(collections.find(({ name }) => name === 'tripAttachments')).toEqual({
      name: 'tripAttachments',
      skipEmbedding: true,
      indexes: [
        { fields: ['scopeKey', 'tripKey', 'position'], unique: true },
        { fields: ['scopeKey', 'tripKey', 'targetType', 'targetKey'], unique: true },
        { fields: ['scopeKey', 'targetType', 'targetKey'] },
      ],
    });
    const bookNames = ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'bookExtensions'];
    expect(collections.filter(({ name }) => bookNames.includes(name)).map(({ name }) => name)).toEqual(bookNames);
    expect(collections.find(({ name }) => name === 'bookChapters')?.indexes).toContainEqual({ fields: ['scopeKey', 'bookKey', 'position'], unique: true });
    expect(collections.find(({ name }) => name === 'bookExtensions')?.indexes).toContainEqual({ fields: ['scopeKey', 'bookKey', 'requestKey'], unique: true });
    expect(collections.find(({ name }) => name === 'folders')?.indexes).toContainEqual({ fields: ['scopeKey', 'managedPurpose', 'managedOwnerKey'], unique: true, sparse: true });
    const emailNames = ['emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles', 'emailAttachments'];
    expect(collections.filter(({ name }) => emailNames.includes(name)).map(({ name }) => name)).toEqual(emailNames);
    expect(collections.filter(({ name }) => ['tripGuides', 'placeReferences', 'placeHeroMedia'].includes(name)).map(({ name }) => name)).toEqual(['tripGuides', 'placeReferences', 'placeHeroMedia']);
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const dropped = source.slice(source.indexOf('const droppedCollections = ['), source.indexOf('async function main()'));
    for (const name of [...bookNames, ...emailNames, 'tripGuides', 'placeReferences', 'placeHeroMedia']) expect(dropped).not.toContain(`'${name}'`);
  });
  test('declares private user generation history indexes', () => {
    expect(collections.find(({ name }) => name === 'userGenerations')).toEqual({ name: 'userGenerations', skipEmbedding: true, indexes: [{ fields: ['userKey', 'type', 'normalizedPrompt'], unique: true }, { fields: ['userKey', 'type', 'generatedAt'] }] });
  });
  test('backfills typed conversation messages as text', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(message, "type") UPDATE message WITH { type: "TEXT" }');
  });
  test('reverse-backfills private Signal rows after canonical collections exist', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const migrate = source.indexOf('await migrateCanonicalEmailPersistence(targetDb);');
    const embeddings = source.indexOf('await migrateCanonicalEmailEmbeddings(targetDb);');
    const loop = source.indexOf('for (const spec of collections)');
    expect(migrate).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(loop);
    expect(embeddings).toBeGreaterThan(migrate);
    expect(source).toContain("kind: 'mail-thread'");
    expect(source).toContain("kind: 'mail-message'");
    expect(source).toContain("collection: 'emailDrafts'");
    expect(source).toContain('IN emailInboxes');
    expect(source).toContain('IN emailAttachments');
    expect(source).toContain('embeddingContentVersion: 4');
    expect(source).toContain("emailMessageSemanticText({ from: message.from, subject: message.subject, body: message.body })");
    expect(source).not.toContain('await migrateMailArchiveDocuments(targetDb);');
  });
  test('backfills Gmail initial sync completion after legacy mail state without adding an index', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const mail = source.indexOf('await migrateCanonicalEmailPersistence(targetDb);');
    const backfill = source.indexOf('await migrateEmailInitialSyncCompletion(targetDb);');
    const drop = source.indexOf('for (const name of droppedCollections)');
    expect(backfill).toBeLessThan(mail);
    expect(backfill).toBeLessThan(drop);
    const migration = source.slice(source.indexOf('export async function migrateEmailInitialSyncCompletion'), source.indexOf('export async function migrateProviderIndependentEmailDrafts'));
    expect(migration).toContain('!HAS(connector, "initialSyncCompleted")');
    expect(migration).toContain('initialSyncCompleted: HAS(connector, "lastSyncedAt")');
    expect(migration).not.toContain('ensureIndex');
  });
  test('demotes managed mail exports to ordinary Archive and Gallery copies', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const migration = source.slice(source.indexOf('export async function migrateCanonicalEmailPersistence'), source.indexOf('export async function migrateProviderIndependentEmailDrafts'));
    expect(migration).toContain('mutationPolicy: "user"');
    expect(migration).toContain('archiveVisibility: "visible"');
    expect(migration).toContain('purpose: null');
    expect(migration).not.toContain('ensureMailFolders');
  });
  test('assigns provider-independent active drafts only when one active organization connector exists', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const patches = [{ key: 'draft-key', revision: 'draft-revision', content: '{"version":1}', updatedAt: '2026-08-23T00:00:00.000Z' }];
    const database = {
      collection: () => ({ exists: async () => true }),
      query: async (query: string, bindVars?: Record<string, unknown>) => { calls.push({ query, bindVars }); return { next: async () => undefined, all: async () => calls.length === 1 ? patches : [] }; },
    };
    await migrateProviderIndependentEmailDrafts(database as never);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.query).toContain('payload.data.accountKey == document.scopeKey');
    expect(calls[0]?.query).toContain('payload.data.status IN ["generated", "edited"]');
    expect(calls[0]?.query).toContain('connector.organizationKey == scope.organizationKey');
    expect(calls[0]?.query).toContain('LIMIT 2');
    expect(calls[0]?.query).toContain('FILTER LENGTH(connectors) == 1');
    expect(calls[0]?.query).toContain('accountKey: connectors[0]._key');
    expect(calls[0]?.query).toContain('FILTER document._key > @after');
    expect(calls[0]?.query).toContain('SORT document._key');
    expect(calls[0]?.query).toContain('LIMIT @batchSize');
    expect(calls[0]?.query).not.toContain('UPDATE document');
    expect(calls[1]?.query).toContain('FOR patch IN @patches');
    expect(calls[1]?.query).toContain('OPTIONS { ignoreRevs: false, ignoreErrors: true }');
    expect(calls[1]?.query).not.toContain('FOR document IN documents');
    expect(calls[1]?.query).not.toContain('DOCUMENT(documents');
    expect(calls[1]?.query).not.toContain('RETURN');
    expect(calls[1]?.bindVars).toEqual({ patches });
    expect(calls[0]?.bindVars).toEqual(expect.objectContaining({ after: '', batchSize: 100 }));
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source.indexOf('await ensureOrganizationConnectorsCollection(targetDb)')).toBeLessThan(source.indexOf('await migrateProviderIndependentEmailDrafts(targetDb)'));
  });
  test('pages provider-independent drafts deterministically across bounded batches', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const patches = Array.from({ length: 205 }, (_, index) => ({ key: `draft-${String(index).padStart(3, '0')}`, revision: `rev-${index}`, content: `content-${index}`, updatedAt: '2026-08-23T00:00:00.000Z' }));
    const database = {
      collection: () => ({ exists: async () => true }),
      async query(query: string, bindVars?: Record<string, unknown>) {
        calls.push({ query, bindVars });
        if (query.includes('FOR document IN documents')) {
          const after = String(bindVars?.after ?? '');
          const page = patches.filter(({ key }) => key > after).slice(0, Number(bindVars?.batchSize));
          return { all: async () => page };
        }
        return { all: async () => [] };
      },
    };

    await migrateProviderIndependentEmailDrafts(database as never);

    const reads = calls.filter(({ query }) => query.includes('FOR document IN documents'));
    const writes = calls.filter(({ query }) => query.includes('FOR patch IN @patches'));
    expect(reads.map(({ bindVars }) => bindVars?.after)).toEqual(['', 'draft-099', 'draft-199']);
    expect(writes.map(({ bindVars }) => (bindVars?.patches as unknown[]).length)).toEqual([100, 100, 5]);
  });
  test('skips stale draft revisions without stalling pagination and converges on rerun', async () => {
    const rows = new Map(Array.from({ length: 101 }, (_, index) => {
      const key = `draft-${String(index).padStart(3, '0')}`;
      return [key, { key, revision: `rev-${index}`, content: `legacy-${index}`, eligible: true }];
    }));
    const readAfter: string[] = [];
    let staleInjected = false;
    let writes = 0;
    const database = {
      collection: () => ({ exists: async () => true }),
      async query(query: string, bindVars?: Record<string, unknown>) {
        if (query.includes('FOR document IN documents')) {
          const after = String(bindVars?.after ?? '');
          readAfter.push(after);
          const page = [...rows.values()].filter((row) => row.eligible && row.key > after).slice(0, Number(bindVars?.batchSize)).map((row) => ({ key: row.key, revision: row.revision, content: `migrated-${row.key}`, updatedAt: '2026-08-23T00:00:00.000Z' }));
          if (!staleInjected && page.length > 0) {
            staleInjected = true;
            const stale = rows.get(page[0]!.key)!;
            stale.revision = 'concurrent-revision';
            stale.content = 'concurrent-edit';
          }
          return { all: async () => page };
        }
        writes += 1;
        for (const patch of bindVars?.patches as Array<{ key: string; revision: string; content: string }>) {
          const row = rows.get(patch.key)!;
          if (row.revision !== patch.revision) continue;
          row.content = patch.content;
          row.eligible = false;
        }
        return { all: async () => [] };
      },
    };

    await migrateProviderIndependentEmailDrafts(database as never);
    expect(readAfter).toEqual(['', 'draft-099']);
    expect(rows.get('draft-000')?.content).toBe('concurrent-edit');
    expect(rows.get('draft-100')?.eligible).toBe(false);

    await migrateProviderIndependentEmailDrafts(database as never);
    expect(rows.get('draft-000')?.eligible).toBe(false);
    const writesAfterConvergence = writes;
    await migrateProviderIndependentEmailDrafts(database as never);
    expect(writes).toBe(writesAfterConvergence);
  });
  test('separates retired email tone removal from document updates', async () => {
    const calls: string[] = [];
    const database = { query: async (query: string) => { calls.push(query); return { all: async () => [] }; } };
    await migrateRetiredEmailDefaultTones(database as never);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('REMOVE document IN documents');
    expect(calls[0]).not.toContain('UPDATE document');
    expect(calls[1]).toContain('UPDATE document');
    expect(calls[1]).toContain('FILTER customContent != document.content');
    expect(calls[1]).not.toContain('REMOVE document IN documents');
  });
  test('cleans and collision-safely compacts existing trip attachments before indexing', async () => {
    const calls: string[] = [];
    const names = ['tripAttachments', 'scopes', 'trips', 'folders', 'documents', 'collections', 'images', 'imageCollecitionHightlights', 'imageCollectionMemories', 'collectionImages'];
    const database = {
      collection(name: string) { return { async exists() { return names.includes(name); } }; },
      async listCollections() { return names.map((name) => ({ name })); },
      async query(query: string) { calls.push(query); return { async all() { return []; } }; },
    };
    let transactionCount = 0;
    await migrateTripAttachments(database as never, async (operation) => { transactionCount += 1; return operation(database as never); });
    expect(calls).toHaveLength(4);
    expect(transactionCount).toBe(1);
    expect(calls[0]).toContain('trip.scopeKey != attachment.scopeKey || target.scopeKey != attachment.scopeKey');
    expect(calls[0]).toContain('attachment.targetType NOT IN ["folder", "collection"]');
    expect(calls[0]).not.toContain('DOCUMENT(documents');
    expect(calls[0]).not.toContain('DOCUMENT(images');
    expect(calls[0]).toContain('LET createdAtValid = createdAtTimestamp != null');
    expect(calls[0]).toContain('(\\\\.[0-9]+)?Z$');
    expect(calls[0]).toContain('DATE_DAY(createdAtTimestamp) == TO_NUMBER(SUBSTRING(attachment.createdAt, 8, 2))');
    for (const field of ['attachment._key', 'attachment.scopeKey', 'attachment.tripKey', 'attachment.targetKey']) expect(calls[0]).toContain(`REGEX_TEST(${field}, "^[cC][0-9a-z]{6,}$")`);
    expect(calls[0]).not.toContain('[^');
    expect(calls[0]).not.toContain('LET memoryHasCollection');
    expect(calls[0]).toContain('target.mutationPolicy == "system-only" || target.purpose != null');
    expect(calls[1]).toContain('FOR duplicate IN SLICE(grouped, 1)');
    expect(calls[2]).toContain('position: CONCAT("migration:", attachment._key)');
    expect(calls[3]).toContain('FOR position IN 0..(LENGTH(grouped) - 1) LET item = grouped[position]');
    expect(calls[3]).toContain('REPLACE item.attachment WITH UNSET');
  });
  test('validates and backfills durable trip creation receipts', async () => {
    const calls: string[] = [];
    const database = {
      collection(name: string) { return { async exists() { return name === 'tripCreationReceipts' || name === 'trips'; } }; },
      async query(query: string) { calls.push(query); return { async all() { return []; } }; },
    };
    await migrateTripCreationReceipts(database as never);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('receipt.tripKey != receipt._key');
    expect(calls[0]).toContain('LET createdAtValid');
    expect(calls[0]).toContain('(\\\\.[0-9]+)?Z$');
    for (const field of ['receipt._key', 'receipt.scopeKey', 'receipt.userKey', 'receipt.tripKey']) expect(calls[0]).toContain(`REGEX_TEST(${field}, "^[cC][0-9a-z]{6,}$")`);
    expect(calls[0]).not.toContain('[^');
    expect(calls[0]).toContain('REGEX_TEST(receipt.requestHash, "^[a-f0-9]{64}$")');
    expect(calls[1]).toContain('UPSERT { _key: trip._key }');
    expect(calls[1]).toContain('UPDATE {} IN tripCreationReceipts');
    expect(calls[1]).toContain('(\\\\.[0-9]+)?Z$');
    expect(calls[1]).toContain('&& createdAtValid');
    for (const field of ['trip._key', 'trip.scopeKey', 'trip.userKey']) expect(calls[1]).toContain(`REGEX_TEST(${field}, "^[cC][0-9a-z]{6,}$")`);
    expect(calls[1].indexOf('FILTER REGEX_TEST(trip._key')).toBeLessThan(calls[1].indexOf('UPSERT { _key: trip._key }'));
  });
  test('removes malformed and orphaned trip guides before indexing', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = {
      collection(name: string) { return { async exists() { return name === 'tripGuides'; } }; },
      async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; } }; },
    };
    await migrateTripGuides(database as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain('trip == null || trip.scopeKey != guide.scopeKey || trip.userKey != guide.userKey');
    expect(calls[0]?.query).toContain('LENGTH(guide.embedding) != @dimensions && LENGTH(guide.embedding) != @legacyDimensions');
    expect(calls[0]?.bindVars).toEqual({ dimensions: EMBEDDING_DIMENSIONS, legacyDimensions: LEGACY_EMBEDDING_DIMENSIONS });
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source.indexOf("await removeBy('generatedDocumentBindings', 'subjectKey', tripKeys)")).toBeLessThan(source.indexOf("await removeKeys('trips', tripKeys)"));
    const backfill = await Bun.file(new URL('../../scripts/backfill-semantic-embeddings.ts', import.meta.url)).text();
    expect(backfill).not.toContain("'tripGuides'");
  });
  test('removes malformed, unsaved, and orphaned place reports before indexing', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = {
      collection(name: string) { return { async exists() { return name === 'placeReports'; } }; },
      async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; } }; },
    };
    await migratePlaceReports(database as never);
    expect(calls[0]?.query).toContain('place == null || place.scopeKey != report.scopeKey || place.userKey != report.userKey || place.saved != true');
    expect(calls[0]?.query).toContain('LENGTH(report.embedding) != @dimensions && LENGTH(report.embedding) != @legacyDimensions');
    expect(calls[0]?.bindVars).toEqual({ dimensions: EMBEDDING_DIMENSIONS, legacyDimensions: LEGACY_EMBEDDING_DIMENSIONS });
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source.indexOf("await removeBy('generatedDocumentBindings', 'subjectKey', placeKeys)")).toBeLessThan(source.indexOf("await removeKeys('places', placeKeys)"));
    const backfill = await Bun.file(new URL('../../scripts/backfill-semantic-embeddings.ts', import.meta.url)).text();
    expect(backfill).not.toContain("'placeReports'");
  });
  test('cleans legacy generated travel records before converting them', async () => {
    const calls: string[] = [];
    const database = {
      collection(name: string) {
        return {
          async exists() { return name === 'tripGuides' || name === 'placeReports'; },
          async drop() { calls.push(`drop:${name}`); },
        };
      },
      async query(query: string) {
        calls.push(query);
        return { async all() { return []; }, async next() { return 0; } };
      },
    };
    await migrateGeneratedTravelDocuments(database as never);
    const tripCleanup = calls.findIndex((query) => query.includes('UPDATE guide WITH { content: guide.summary'));
    const tripValidation = calls.findIndex((query) => query.includes('REMOVE guide IN tripGuides'));
    const reportCleanup = calls.findIndex((query) => query.includes('REMOVE report IN placeReports'));
    const conversion = calls.findIndex((query) => query.includes('IN placeReferences'));
    expect(tripCleanup).toBeGreaterThanOrEqual(0);
    expect(tripValidation).toBeGreaterThanOrEqual(0);
    expect(reportCleanup).toBeGreaterThanOrEqual(0);
    expect(tripCleanup).toBeGreaterThan(reportCleanup);
    expect(tripCleanup).toBeGreaterThan(tripValidation);
    expect(conversion).toBeGreaterThan(tripCleanup);
    expect(calls.some((query) => query.includes('semantic migration failed'))).toBe(false);
  });
  test('drops obsolete place indexes while preserving current indexes', () => {
    const desired = [['scopeKey', 'userKey', 'saved'], ['scopeKey', 'userKey', 'openedAt'], ['scopeKey', 'userKey', 'countryCode'], ['scopeKey', 'userKey', 'countryCode', 'name']];
    expect(isLegacyIndex('places', ['scopeKey', 'isWishlist'], desired)).toBe(true);
    expect(isLegacyIndex('places', ['scopeKey', 'isFavorite'], desired)).toBe(true);
    expect(isLegacyIndex('places', ['scopeKey', 'countryCode', 'name'], desired)).toBe(true);
    expect(isLegacyIndex('places', ['scopeKey', 'userKey', 'countryCode'], desired)).toBe(false);
  });
  test('retains trip persistence and retires only legacy place visits', async () => {
    const dropped: string[] = [];
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const existing = new Set(['tripPlaces', 'placeVisits', 'trips']);
    const database = {
      collection(name: string) { return { async exists() { return existing.has(name); }, async drop() { dropped.push(name); existing.delete(name); } }; },
      async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; }, async next() { return 0; } }; },
    };
    await migrateMinimalPlacesAndRetireTrips(database as never);
    await migrateMinimalPlacesAndRetireTrips(database as never);
    expect(calls.filter(({ query }) => query.includes('FOR trip IN trips'))).toHaveLength(8);
    const validation = calls.find(({ query }) => query.includes('LET createdAtTimestamp') && query.includes('FOR trip IN trips'))?.query ?? '';
    expect(validation).toContain('LET createdAtValid');
    expect(validation).toContain('LET updatedAtValid');
    expect(validation).toContain('trip.status NOT IN ["planned", "completed"]');
    expect(validation).toContain('(\\\\.[0-9]+)?Z$');
    for (const field of ['trip._key', 'trip.userKey', 'trip.scopeKey', 'trip.coverImageKey']) expect(validation).toContain(`REGEX_TEST(${field}, "^[cC][0-9a-z]{6,}$")`);
    expect(validation).not.toContain('[^');
    expect(calls.filter(({ query }) => query.includes('FOR relation IN tripPlaces'))).toHaveLength(2);
    expect(calls.find(({ query }) => query.includes('UPDATE trip WITH { status:'))?.query).toContain('trip.status IN ["planned", "completed"] ? trip.status : "planned"');
    expect(dropped).toEqual(['placeVisits']);
    expect(existing).toEqual(new Set(['tripPlaces', 'trips']));

    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const cleanup = source.indexOf('await migrateMinimalPlacesAndRetireTrips(targetDb)');
    const activeLoop = source.indexOf('for (const spec of collections)');
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(activeLoop);
    expect(source).toContain('REPLACE place WITH UNSET(replacement, "_rev") IN places');
    expect(source).toContain('embedding: await generateEmbedding(buildPlaceEmbeddingText(canonical))');
    expect(source).toContain('place.kind == "country" && (!HAS(place, "userKey") || !HAS(place, "saved"))');
    expect(source).toContain('resource.sourceType == "place" && resource.sourceKey IN @obsoleteCountryKeys');
    expect(source).toContain('places migration found duplicate saved cities');
    expect(source).toContain('trip.userKey != place.userKey || place.saved != true');
    expect(source).toContain('resource.sourceType == "trip"');
  });
  test('creates placeImages before first-deployment place migration queries it', async () => {
    const existing = new Set(['places']);
    const events: string[] = [];
    const database = {
      collection(name: string) {
        return {
          async exists() { return existing.has(name); },
          async create() { events.push(`create:${name}`); existing.add(name); },
          async drop() {},
        };
      },
      async query(query: string) {
        if (query.includes('placeImages') && !existing.has('placeImages')) throw new Error('collection not found: placeImages');
        events.push(query.includes('placeImages') ? 'query:placeImages' : 'query:other');
        if (query.includes('FILTER LENGTH(userKeys) != 1')) return { async all() { return ['legacy-place']; } };
        return { async all() { return []; }, async next() { return 0; } };
      },
    };
    await expect(migrateMinimalPlacesAndRetireTrips(database as never)).rejects.toThrow('cannot safely derive user ownership');
    expect(events.slice(0, 3)).toEqual(['create:placeImages', 'query:other', 'query:placeImages']);
  });
  test('force-projects legacy places once while preserving keys and regenerating name-only embeddings', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      let legacy = true;
      let replacements: Array<Record<string, unknown>> = [];
      const database = {
        collection(name: string) { return { async exists() { return name === 'places'; }, async create() {}, async drop() {} }; },
        async query(query: string, bindVars?: Record<string, unknown>) {
          if (query.includes('obsoleteCountryKeys') || query.includes('RETURN place._key')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('FILTER LENGTH(userKeys) != 1')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('UPDATE place WITH { userKey:')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('Validate every retained place')) return { async all() { return bindVars?.after === '' ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', userKey: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', saved: true, name: legacy ? ' Stockholm ' : 'Stockholm', countryCode: legacy ? 'se' : 'SE', latitude: 59.3293, longitude: 18.0686, openedAt: '2026-08-09T12:00:00.000Z', createdAt: '2026-08-08T12:00:00.000Z' }] : []; }, async next() { return undefined; } };
          if (query.includes('WITH COUNT INTO count')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('RETURN place') && !query.includes('RETURN LENGTH')) return { async all() { return legacy ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', _rev: 'legacy-revision', userKey: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', saved: true, kind: 'place', name: ' Stockholm ', countryCode: 'se', latitude: 59.3293, longitude: 18.0686, embedding: [], openedAt: '2026-08-09T12:00:00.000Z', createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z' }] : []; }, async next() { return undefined; } };
          if (query.includes('FOR replacement IN @replacements')) { replacements = bindVars?.replacements as Array<Record<string, unknown>>; legacy = false; return { async all() { return []; }, async next() { return undefined; } }; }
          if (query.includes('REMOVE place IN places')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('RETURN LENGTH')) return { async all() { return []; }, async next() { return 0; } };
          throw new Error(`Unexpected migration query: ${query}`);
        },
        async beginTransaction() { return { async step(run: () => Promise<void>) { await run(); }, async commit() {}, async abort() {} }; },
      };
      await migrateMinimalPlacesAndRetireTrips(database as never);
      const first = replacements[0]!;
      expect(first).toEqual({
        _key: 'cmrnlzf650002qc7k4p5zem5w',
        _rev: 'legacy-revision',
        userKey: 'cmrnlzf650002qc7k4p5zem5w',
        scopeKey: 'cmrnlzf640001qc7kazsr96k5',
        saved: true,
        status: 'wishlist',
        isFavorite: false,
        kind: 'place',
        name: 'Stockholm',
        summary: '',
        countryCode: 'SE',
        latitude: 59.3293,
        longitude: 18.0686,
        embedding: expect.any(Array),
        embeddingContentVersion: 2,
        openedAt: '2026-08-09T12:00:00.000Z',
        createdAt: '2026-08-08T12:00:00.000Z',
      });
      expect(first.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      replacements = [];
      await migrateMinimalPlacesAndRetireTrips(database as never);
      expect(replacements).toEqual([]);
      const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
      expect(source).toContain('fields NOT IN @canonicalFieldSets');
    } finally {
      if (previous === undefined) delete process.env.CONTENT_E2E;
      else process.env.CONTENT_E2E = previous;
    }
  });
  test('retains valid generated country places and projects kind and detail version', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      const cities = Array.from({ length: 10 }, (_, index) => ({ name: `City ${index}`, latitude: index, longitude: index }));
      const generatedDetail = { location: { kind: 'country', name: 'Japan', countryCode: 'JP', country: 'Japan', continent: 'Asia', region: null, city: null, latitude: 36.2, longitude: 138.2 }, title: 'Japan', summary: 'Island country.', culture: 'Culture.', food: 'Food.', whyVisit: 'Visit.', heroImagePrompt: 'Landscape.', popularCities: cities };
      let legacy = true;
      let replacement: Record<string, unknown> | undefined;
      const row = () => ({ _key: 'cmrnlzf650002qc7k4p5zem5w', _rev: 'revision', userKey: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', saved: true, status: 'visited', isFavorite: true, kind: 'country', name: ' Japan ', summary: 'Island country.', countryCode: 'jp', latitude: 36.2, longitude: 138.2, embedding: [], embeddingContentVersion: 1, generatedDetail, generatedDetailVersion: 2, createdAt: '2026-08-08T12:00:00.000Z' });
      const database = {
        collection(name: string) { return { async exists() { return name === 'places' || name === 'placeImages'; }, async create() {}, async drop() {} }; },
        async query(query: string, bindVars?: Record<string, unknown>) {
          if (query.includes('obsoleteCountryKeys') || query.includes('FILTER LENGTH(userKeys) != 1') || query.includes('UPDATE place WITH { userKey:') || query.includes('WITH COUNT INTO count')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('Validate every retained place')) return { async all() { return bindVars?.after === '' ? [legacy ? row() : { ...replacement, _key: replacement?._key }] : []; }, async next() { return undefined; } };
          if (query.includes('RETURN place') && !query.includes('RETURN LENGTH')) return { async all() { return legacy ? [row()] : []; }, async next() { return undefined; } };
          if (query.includes('FOR replacement IN @replacements')) { replacement = (bindVars?.replacements as Array<Record<string, unknown>>)[0]; legacy = false; return { async all() { return []; }, async next() { return undefined; } }; }
          if (query.includes('RETURN LENGTH')) return { async all() { return []; }, async next() { return 0; } };
          throw new Error(`Unexpected migration query: ${query}`);
        },
        async beginTransaction() { return { async step(run: () => Promise<void>) { await run(); }, async commit() {}, async abort() {} }; },
      };

      await migrateMinimalPlacesAndRetireTrips(database as never);
      expect(replacement).toMatchObject({ saved: true, status: 'visited', isFavorite: true, kind: 'country', name: 'Japan', countryCode: 'JP', generatedDetail, generatedDetailVersion: 2 });
    } finally {
      if (previous === undefined) delete process.env.CONTENT_E2E;
      else process.env.CONTENT_E2E = previous;
    }
  });
  test('rejects duplicate canonical saved cities before changing places', async () => {
    let startedTransaction = false;
    const database = {
      collection(name: string) { return { async exists() { return name === 'places'; }, async create() {}, async drop() {} }; },
      async query(query: string, bindVars?: Record<string, unknown>) {
        if (query.includes('obsoleteCountryKeys') || query.includes('RETURN place._key')) return { async all() { return []; } };
        if (query.includes('FILTER LENGTH(userKeys) != 1')) return { async all() { return []; } };
        if (query.includes('UPDATE place WITH { userKey:')) return { async all() { return []; } };
        if (query.includes('Validate every retained place')) return { async all() { return bindVars?.after === '' ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', userKey: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', saved: true, name: ' Stockholm ', countryCode: 'se', latitude: 59.3293, longitude: 18.0686, createdAt: '2026-08-08T12:00:00.000Z' }] : []; } };
        if (query.includes('WITH COUNT INTO count')) return { async all() { return [{ scopeKey: 'cmrnlzf640001qc7kazsr96k5', userKey: 'cmrnlzf650002qc7k4p5zem5w', countryCode: 'SE', name: 'Stockholm', count: 2 }]; } };
        throw new Error(`Unexpected migration query: ${query}`);
      },
      async beginTransaction() { startedTransaction = true; throw new Error('should not start'); },
    };
    await expect(migrateMinimalPlacesAndRetireTrips(database as never)).rejects.toThrow('duplicate saved cities');
    expect(startedTransaction).toBe(false);
  });
  test('refuses to assign an existing place to an ambiguous user', async () => {
    let updates = 0;
    const database = {
      collection(name: string) { return { async exists() { return name === 'places'; }, async create() {}, async drop() {} }; },
      async query(query: string) {
        if (query.includes('FILTER LENGTH(userKeys) != 1')) return { async all() { return ['cmrnlzf650002qc7k4p5zem5w']; } };
        if (query.includes('UPDATE place WITH { userKey:')) updates += 1;
        return { async all() { return []; } };
      },
    };
    await expect(migrateMinimalPlacesAndRetireTrips(database as never)).rejects.toThrow('cannot safely derive user ownership');
    expect(updates).toBe(0);
  });
  test('removes unowned legacy progress before folding metadata into canonical documents', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(progress, "userKey") REMOVE progress IN bookProgress');
    expect(source).toContain('document.audioChapter.readerProgress');
    expect(source).toContain("'bookProgress',");
  });
  test('migration never hashes missing data or borrows current documents for version history', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const helperSource = await Bun.file(new URL('./content-migration.ts', import.meta.url)).text();
    expect(source).toContain('stageLegacyDocumentShares([share])');
    expect(source).toContain('nonEmptyString(snapshot.html)');
    expect(source).not.toContain('DOCUMENT(documents, snapshot.documentKey)');
    expect(helperSource).toContain('has neither a valid tokenHash nor a plaintext token');
    expect(source).toContain('beginTransaction');
    expect(source).toContain('migration verification failed');
  });
  test('migrates legacy branded persistence contracts before generic indexes are created', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("targetDb.collection('archiveIdempotency')");
    expect(source).toContain('INSERT record INTO contentIdempotency');
    expect(source).toContain('if (ledgerAlreadyExisted) await legacyLedger.drop()');
    expect(source).toContain('migration found conflicting records');
    expect(source).not.toContain("targetDb.collection('projects')");
    expect(source).not.toContain("{ name: 'projects'");
    expect(source).not.toContain("{ name: 'milestones'");
    expect(source).not.toContain("{ name: 'tasks'");
    for (const collection of ['tasks', 'milestones', 'projects', 'artifactDependencies', 'artifactSnapshots', 'artifacts']) {
      expect(source).toContain(`'${collection}',`);
    }
    expect(source).toContain("_key: 'content-document-shares-cutover'");
    expect(source.indexOf('await migrateGenericContentContracts(targetDb)')).toBeLessThan(source.indexOf('for (const spec of collections)'));
  });
  test('repairs recoverable document and version representations without borrowing data', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const documentMigration = migrationDatabase('documents', { _key: 'document-1', _rev: 'document-rev', name: 'Current', html: '   ', content: 'Current body', embedding, ...embeddingMetadata(), json: {} });
    await migrateContentDocuments(documentMigration.database);
    expect(documentMigration.update?.bindVars?.updates).toEqual([{ _key: 'document-1', _rev: 'document-rev', source: { name: 'Current', html: '   ', content: 'Current body' }, content: 'Current body', contentChunks: ['Current body'], embedding, chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Current body') }]);
    expect(documentMigration.update?.query).toContain('UNSET(MERGE(document');
    expect(documentMigration.update?.query).toContain('document._rev == patch._rev');
    expect(documentMigration.update?.query).toContain('UNSET(patch, "_key", "_rev", "source")');
    expect(documentMigration.update?.query).toContain('UNSET(replacement, "html"');
    expect(documentMigration.update?.query).not.toContain('"storageKey", "sizeBytes"');

    const versionMigration = migrationDatabase('documentVersions', { _key: 'version-1', _rev: 'version-rev', html: '\n\t', content: 'Historical body', embedding, ...embeddingMetadata(), json: {}, storageKey: 'legacy', sizeBytes: 12, updatedAt: '2026-01-01T00:00:00.000Z' });
    await migrateContentVersions(versionMigration.database);
    expect(versionMigration.update?.bindVars?.updates).toEqual([{ _key: 'version-1', _rev: 'version-rev', source: { html: '\n\t', content: 'Historical body' }, content: 'Historical body', embedding, chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Historical body') }]);
    expect(versionMigration.update?.query).toContain('snapshot._rev == patch._rev');
    expect(versionMigration.update?.query).toContain('"json", "storageKey", "sizeBytes", "updatedAt"');
    expect(versionMigration.update?.query).toContain('UNSET(replacement, "html"');
    expect(versionMigration.update?.query).toContain('migration must not infer deletion ownership');
  });
  test('recovers content from each HTML-only row before removing HTML', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      const documentMigration = migrationDatabase('documents', { _key: 'html-only-document', _rev: 'document-rev', name: 'Legacy', html: '<h1>Recovered</h1><p>Body &amp; details.</p>', embedding: [] });
      await migrateContentDocuments(documentMigration.database);
      expect((documentMigration.update?.bindVars?.updates as Array<Record<string, unknown>>)[0]).toMatchObject({ content: 'Recovered\n\nBody & details.' });

      const versionMigration = migrationDatabase('documentVersions', { _key: 'html-only-version', _rev: 'version-rev', html: '<p>Historical only</p>', embedding: [] });
      await migrateContentVersions(versionMigration.database);
      expect((versionMigration.update?.bindVars?.updates as Array<Record<string, unknown>>)[0]).toMatchObject({ content: 'Historical only' });
      const structuredMigration = migrationDatabase('documents', { _key: 'structured-html-document', _rev: 'structured-rev', name: 'Structured', html: '<table><tr><td>Alpha</td><td>Beta</td></tr></table><img alt="Revenue Q4"><p>2 &lt; 3 and 5 &gt; 4</p>', embedding: [] });
      await migrateContentDocuments(structuredMigration.database);
      expect((structuredMigration.update?.bindVars?.updates as Array<Record<string, unknown>>)[0]).toMatchObject({ content: 'Alpha\tBeta\n\nRevenue Q4\n\n2 < 3 and 5 > 4' });
      const staleContentMigration = migrationDatabase('documents', { _key: 'stale-content-document', _rev: 'stale-rev', name: 'Canonical', html: '<p>Complete canonical body</p>', content: 'Truncated', embedding: [] });
      await migrateContentDocuments(staleContentMigration.database);
      expect((staleContentMigration.update?.bindVars?.updates as Array<Record<string, unknown>>)[0]).toMatchObject({ content: 'Complete canonical body' });
    } finally {
      if (previous === undefined) delete process.env.CONTENT_E2E;
      else process.env.CONTENT_E2E = previous;
    }
  });
  test('regenerates outgoing 4096 embeddings without allowing a concurrent replacement', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      const migration = migrationDatabase('documents', { _key: 'legacy-document', _rev: 'legacy-rev', name: 'Legacy', html: '<p>Historical body</p>', content: 'Historical body', embedding: Array(LEGACY_EMBEDDING_DIMENSIONS).fill(0.1) });
      await migrateContentDocuments(migration.database);
      const [patch] = migration.update?.bindVars?.updates as Array<Record<string, unknown>>;
      expect(patch.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(patch).toMatchObject({ _key: 'legacy-document', _rev: 'legacy-rev', source: { name: 'Legacy', html: '<p>Historical body</p>', content: 'Historical body' } });
      expect(patch).not.toHaveProperty('embeddingProvider');
      expect(migration.update?.query).toContain('FILTER document != null && document._rev == patch._rev');
    } finally {
      if (previous === undefined) delete process.env.CONTENT_E2E;
      else process.env.CONTENT_E2E = previous;
    }
  });
  test('keeps version content as a string', async () => {
      const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
      const migration = migrationDatabase('documentVersions', { _key: 'version-rollout', _rev: 'version-rev', html: '<p>Historical body</p>', content: 'Historical body', embedding });
      await migrateContentVersions(migration.database);
      const [patch] = migration.update?.bindVars?.updates as Array<Record<string, unknown>>;
      expect(patch.content).toBe('Historical body');
      expect(patch.chunkEmbeddings).toEqual([embedding]);
  });
  test('marks oversized legacy content for flat-vector fallback without blocking migration', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const content = 'word '.repeat(DOCUMENT_MAX_CHUNKS * DOCUMENT_CHUNK_MAX_WORDS + 1).trim();
    const migration = migrationDatabase('documents', { _key: 'oversized-document', _rev: 'oversized-rev', name: 'Legacy large document', html: `<p>${content}</p>`, content, embedding });
    await migrateContentDocuments(migration.database);
    const [patch] = migration.update?.bindVars?.updates as Array<Record<string, unknown>>;
    expect(patch).toMatchObject({ _semanticChunkingSkipped: true, semanticChunkCount: 1, embedding });
    expect(patch).not.toHaveProperty('contentChunks');
    expect(patch).not.toHaveProperty('chunkEmbeddings');
  });
  test('physically normalizes and verifies favorite-bearing resources idempotently', async () => {
    for (const collection of ['folders', 'images', 'collections', 'documents'] as const) {
      const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
      const database = {
        async query(query: string, bindVars?: Record<string, unknown>) {
          calls.push({ query, bindVars });
          return { async all() { return []; }, async next() { return 0; } };
        },
        async beginTransaction() {
          return { async step(run: () => Promise<void>) { await run(); }, async commit() {}, async abort() {} };
        },
      };
      await migrateContentFavorites(database as never, collection);
      await migrateContentFavorites(database as never, collection);
      expect(calls.filter(({ query }) => query.includes('UPDATE resource WITH { isFavorite: false }'))).toHaveLength(2);
      expect(calls.every(({ query }) => !query.includes('isFavorite') || query.includes('!IS_BOOL(resource.isFavorite)'))).toBe(true);
      expect(calls.filter(({ query }) => query.includes('RETURN LENGTH'))).toHaveLength(2);
      expect(calls.every(({ bindVars }) => bindVars?.['@collection'] === collection)).toBe(true);
    }
  });
  test('uses a durable two-phase cutover and verifies before dropping legacy shares', async () => {
    const staged = stageLegacyDocumentShares([
      { _key: 'first', token: 'one', permission: 'read' },
      { _key: 'second', token: 'two', permission: 'edit' },
    ]);
    expect(staged).toHaveLength(2);
    expect(new Set(staged.map((share) => share.tokenHash)).size).toBe(2);
    expect(staged.map((share) => share.permission)).toEqual(['read', 'comment']);

    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const ensureIndexes = source.indexOf('await target.ensureIndex');
    const dualMarker = source.indexOf("state: 'dual'");
    const copy = source.indexOf('const copyAndVerify');
    const globalMarker = source.indexOf("state: 'global'");
    const dropLegacy = source.indexOf('await legacy.drop()');
    expect(ensureIndexes).toBeGreaterThan(-1);
    expect(ensureIndexes).toBeLessThan(dualMarker);
    expect(dualMarker).toBeLessThan(copy);
    expect(copy).toBeLessThan(globalMarker);
    expect(globalMarker).toBeLessThan(dropLegacy);
    expect(source).toContain('LIMIT 100');
    expect(source).toContain('share._key > @after');
    expect(source).toContain('if (!marker) return');
    expect(source).toContain('if (!equal(copied, prepared))');
  });

  test('stages more than one migration chunk without retaining prior rows or changing order', () => {
    const shares = Array.from({ length: 205 }, (_, index) => ({
      _key: String(index).padStart(4, '0'),
      token: `legacy-${index}`,
      permission: index % 2 ? 'edit' : 'read',
    }));
    const staged = [];
    for (let offset = 0; offset < shares.length; offset += 100) staged.push(...stageLegacyDocumentShares(shares.slice(offset, offset + 100)));
    expect(staged.map((share) => share._key)).toEqual(shares.map((share) => share._key));
    expect(new Set(staged.map((share) => share.tokenHash))).toHaveLength(205);
  });

  test('reconciles scope memberships after canonical userOrganizations migration', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const canonicalCopy = source.indexOf('Copied user_organization -> userOrganizations');
    const scopeReconciliation = source.indexOf('reconcileOrganizationScopeMemberships(organization.key');
    expect(canonicalCopy).toBeGreaterThan(-1);
    expect(scopeReconciliation).toBeGreaterThan(canonicalCopy);
    expect(source).not.toContain('reconcileOrganizationInheritedAgentMemberships');
  });

  test('marks legacy scope memberships explicit before organization reconciliation', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const sourceMigration = source.indexOf('source: "explicit"');
    const reconciliation = source.indexOf('reconcileOrganizationScopeMemberships(organization.key');
    expect(sourceMigration).toBeGreaterThan(-1);
    expect(reconciliation).toBeGreaterThan(sourceMigration);
  });

  test('purges retired Hunt, waitlist, Polar, and legacy user-event data idempotently', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const retiredCollections = [
      'userEvents',
      'intelligenceFragments',
      'userWaitlistLeaderboardChanges',
      'products',
      'paymentCheckouts',
      'paymentOrders',
      'subscriptions',
      'userEntitlements',
    ];
    const retiredCollectionLoop = source.indexOf('for (const retiredCollectionName of [');
    expect(retiredCollectionLoop).toBeGreaterThan(-1);
    for (const collection of retiredCollections) {
      expect(source.indexOf(`'${collection}'`, retiredCollectionLoop)).toBeGreaterThan(retiredCollectionLoop);
    }
    expect(source).toContain('FILTER event.provider == "polar"');
    expect(source).toContain('REMOVE event IN processedWebhookEvents');
    expect(source).toContain('HAS(u, "waitlistNumber")');
    expect(source).toContain('waitlistNumber: null');
    expect(source).toContain('isOnWaitlist: null');
    expect(source).toContain('isWaitlistApproved: null');
    expect(source).toContain('IN users OPTIONS { keepNull: false }');
    expect(source).toContain("name: 'events'");
    expect(source).toContain("{ fields: ['appKey', 'createdAt'] }");
    expect(source).toContain("{ fields: ['scopeId', 'createdAt'], sparse: true }");
    expect(isLegacyIndex('events', ['distinctId', 'createdAt'], [['appKey', 'createdAt']])).toBe(true);
    expect(isLegacyIndex('events', ['domain', 'createdAt'], [['appKey', 'createdAt']])).toBe(true);
    expect(source).toContain('OR HAS(event, "distinctId")');
    expect(source).toContain('OR HAS(event, "embedding")');
  });

  test('retires inbox rows only after canonical Signal backfill', async () => {
    expect(collections.find(({ name }) => name === 'inboxes')).toBeUndefined();
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const migration = source.slice(source.indexOf('export async function migrateCanonicalEmailPersistence'), source.indexOf('export async function migrateProviderIndependentEmailDrafts'));
    expect(migration).toContain('folder.managedPurpose == "mail-inbox"');
    expect(migration).toContain('IN emailInboxes');
    expect(source.indexOf('await migrateCanonicalEmailPersistence(targetDb)')).toBeLessThan(source.indexOf('await dropVerifiedLegacyInboxes(targetDb)'));
    expect(source).toContain("const legacy = targetDb.collection('inboxes')");
  });

  test('protects tone semantics from generic document chunking and embeds only the name', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const toneMigration = source.slice(source.indexOf('export async function migrateEmailToneEmbeddings'), source.indexOf('export async function migrateContentVersions'));
    const documentMigration = source.slice(source.indexOf('export async function migrateContentDocuments'), source.indexOf('export async function migrateContentShares'));
    expect(toneMigration).toContain('folder.purpose == "communication-mail-tones"');
    expect(toneMigration).toContain('isCanonicalEmailToneDocument(document)');
    expect(toneMigration).toContain('decodeEmailToneContent');
    expect(toneMigration).toContain('emailToneSemanticText');
    expect(toneMigration).toContain('encodeEmailToneContent(tone)');
    expect(toneMigration).toContain('content: @content');
    expect(toneMigration).toContain('chunkDocumentContent(semanticText)');
    expect(toneMigration).toContain('chunkEmbeddings: contentChunks.map(() => embedding)');
    expect(toneMigration).not.toContain('CONTAINS(document.content, "<!-- vorinthex-mail-tone ")');
    const retiredToneMigration = source.slice(source.indexOf('export async function migrateRetiredEmailDefaultTones'), source.indexOf('export async function migrateEmailInboxCategoriesAndDefaultTones'));
    expect(retiredToneMigration).toContain('document._key == key');
    expect(retiredToneMigration).toContain('document.isFavorite != true');
    expect(retiredToneMigration).toContain('document.coverImageKey == null');
    expect(retiredToneMigration).toContain('document.createdAt == document.updatedAt');
    expect(retiredToneMigration).toContain('LET hasDependents =');
    expect(retiredToneMigration).toContain('FOR version IN documentVersions');
    expect(retiredToneMigration).toContain('FOR summary IN documentSummaries');
    expect(retiredToneMigration).toContain('FOR audio IN documentAudioVersions');
    expect(retiredToneMigration).toContain('FOR audio IN documentSummaryAudio');
    expect(retiredToneMigration).toContain('audio.summaryKey IN summaryKeys');
    expect(retiredToneMigration).toContain('&& !hasDependents');
    expect(retiredToneMigration).toContain('FILTER untouched');
    expect(retiredToneMigration).toContain('JSON_STRINGIFY({ version: 1 })');
    expect(toneMigration).toContain('FOR tone IN @defaultTones');
    expect(toneMigration).toContain('UPSERT { _key: key }');
    expect(toneMigration).toContain('payload.kind IN ["mail-thread", "mail-message"]');
    expect(toneMigration).toContain('? "Filtered" : payload.data.priority == "urgent" ? "Urgent" : "Important"');
    expect(toneMigration).toContain('LET inInbox = "INBOX" IN labels || "SPAM" IN labels || "TRASH" IN labels');
    expect(toneMigration).toContain('{ inboxCategory, inInbox }');
    expect(documentMigration).toContain('FILTER document.emailToneEmbeddingVersion != 1');
    expect(documentMigration).toContain('document.emailReplyContextEmbeddingVersion != 1');
    expect(source.indexOf('await migrateEmailToneEmbeddings(targetDb)')).toBeLessThan(source.indexOf('await migrateContentDocuments(targetDb)', source.indexOf("if (spec.name === 'documents')")));
    expect(source.indexOf('await migrateEmailInboxCategoriesAndDefaultTones(targetDb)')).toBeLessThan(source.indexOf('await migrateEmailToneEmbeddings(targetDb)'));
  });

  test('defers dependent-aware retired tone cleanup until a fresh database has ensured every required collection', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const earlyMigration = source.slice(source.indexOf('export async function migrateEmailInboxCategoriesAndDefaultTones'), source.indexOf('export async function migrateContentVersions'));
    for (const collection of ['documentVersions', 'documentSummaries', 'documentAudioVersions', 'documentSummaryAudio']) expect(earlyMigration).not.toContain(` IN ${collection}`);
    const loopStart = source.indexOf('for (const spec of collections)');
    const deferredCall = source.indexOf('await migrateRetiredEmailDefaultTones(targetDb)', loopStart);
    const afterCollectionLoop = source.indexOf('await migrateGeneratedTravelDocuments(targetDb)', loopStart);
    const loopClose = source.lastIndexOf('\n  }\n\n', deferredCall);
    expect(deferredCall).toBeGreaterThan(loopStart);
    expect(deferredCall).toBeLessThan(afterCollectionLoop);
    expect(loopClose).toBeGreaterThan(loopStart);
    expect(source.slice(loopClose, deferredCall)).toBe('\n  }\n\n  ');
    for (const collection of ['documents', 'folders', 'documentVersions', 'documentSummaries', 'documentAudioVersions', 'documentSummaryAudio']) expect(collections.some(({ name }) => name === collection)).toBe(true);
  });
});

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('Email migration live Arango', () => {
  test('batches drafts, handles conflicts, and keeps reruns idempotent', async () => {
    const { Database } = await import('arangojs');
    const temporaryName = `email_migration_${crypto.randomUUID().replaceAll('-', '')}`;
    const root = new Database({
      url: process.env.ARANGO_URL!,
      auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! },
    });
    await root.createDatabase(temporaryName);
    const temporary = root.database(temporaryName);
    try {
      for (const name of ['documents', 'organizationConnectors', 'scopes', 'folders', 'documentVersions', 'documentSummaries', 'documentAudioVersions', 'documentSummaryAudio']) await temporary.createCollection(name);
      await temporary.collection('scopes').save({ _key: 'scope-live', organizationKey: 'organization-live' });
      await temporary.collection('organizationConnectors').save({ _key: 'connector-live', organizationKey: 'organization-live', scopeKey: 'scope-live', provider: 'gmail', status: 'active', syncEnabled: true });
      const documents = Array.from({ length: 105 }, (_, index) => ({
        _key: `draft-${String(index).padStart(3, '0')}`,
        scopeKey: 'scope-live',
        content: JSON.stringify({ version: 1, kind: 'mail-new-draft', data: { accountKey: 'scope-live', status: 'edited', body: `body-${index}` } }),
        createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }));
      await temporary.collection('documents').import(documents);

      let injected = false;
      const concurrentDatabase = {
        collection: (name: string) => temporary.collection(name),
        async query(query: string, bindVars?: Record<string, unknown>) {
          const cursor = await temporary.query(query, bindVars);
          if (!injected && query.includes('FOR document IN documents')) {
            injected = true;
            await temporary.query(`UPDATE "draft-000" WITH {
              content: JSON_STRINGIFY({ version: 1, kind: "mail-new-draft", data: { accountKey: "scope-live", status: "edited", body: "concurrent-edit" } })
            } IN documents`);
          }
          return cursor;
        },
      };

      await migrateProviderIndependentEmailDrafts(concurrentDatabase as never);
      const conflicted = await temporary.collection('documents').document('draft-000') as { content: string };
      expect(JSON.parse(conflicted.content).data).toMatchObject({ accountKey: 'scope-live', body: 'concurrent-edit' });
      expect(await (await temporary.query<number>('RETURN LENGTH(FOR document IN documents LET payload = JSON_PARSE(document.content) FILTER payload.data.accountKey == "connector-live" RETURN 1)')).next()).toBe(104);

      await migrateProviderIndependentEmailDrafts(temporary);
      const revisionsBeforeNoOp = await (await temporary.query<string>('FOR document IN documents SORT document._key RETURN document._rev')).all();
      await migrateProviderIndependentEmailDrafts(temporary);
      const revisionsAfterNoOp = await (await temporary.query<string>('FOR document IN documents SORT document._key RETURN document._rev')).all();
      expect(revisionsAfterNoOp).toEqual(revisionsBeforeNoOp);
      const migratedConflict = await temporary.collection('documents').document('draft-000') as { content: string };
      expect(JSON.parse(migratedConflict.content).data).toMatchObject({ accountKey: 'connector-live', body: 'concurrent-edit' });

      const toneKey = `c${new Bun.CryptoHasher('sha256').update('mail-tone\0scope-live\0warm').digest('hex').slice(0, 24)}`;
      await temporary.collection('folders').save({ _key: 'tone-folder', scopeKey: 'scope-live', purpose: 'communication-mail-tones' });
      await temporary.collection('documents').save({ _key: toneKey, scopeKey: 'scope-live', folderKey: 'tone-folder', name: 'Customized', content: '<!-- vorinthex-mail-tone {"version":1} -->', createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' });
      const toneRevision = (await temporary.collection('documents').document(toneKey) as { _rev: string })._rev;
      await migrateRetiredEmailDefaultTones(temporary);
      expect((await temporary.collection('documents').document(toneKey) as { _rev: string })._rev).toBe(toneRevision);

      await temporary.query('UPDATE @key WITH { content: @content } IN documents', { key: toneKey, content: '<!-- vorinthex-mail-tone {"version":1,"slug":"warm"} -->' });
      await migrateRetiredEmailDefaultTones(temporary);
      const migratedTone = await temporary.collection('documents').document(toneKey) as { _rev: string; content: string };
      expect(migratedTone.content).toBe('<!-- vorinthex-mail-tone {"version":1} -->');
      await migrateRetiredEmailDefaultTones(temporary);
      expect((await temporary.collection('documents').document(toneKey) as { _rev: string })._rev).toBe(migratedTone._rev);
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 30_000);
});
