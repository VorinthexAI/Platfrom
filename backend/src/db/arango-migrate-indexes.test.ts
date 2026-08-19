import { describe, expect, test } from 'bun:test';
import { isLegacyIndex, LEGACY_REMOVAL_MARKER, normalizeLegacyDocumentSharePermission } from './arango-migrate-indexes';
import { stageLegacyDocumentShares } from './content-migration';
import { collections, migrateContentDocuments, migrateContentFavorites, migrateContentVersions, migrateEmailReplyMetadata, migrateImageCaptions, migrateMinimalPlacesAndRetireTrips, migrateModelActionSlugs, retireMomentumScope, retireTranscriptionDomain, retireUserSettings } from './arango-migrate';
import { EMBEDDING_DIMENSIONS, LEGACY_EMBEDDING_DIMENSIONS, embeddingMetadata } from '../lib/embeddings';
import { DOCUMENT_CHUNK_MAX_WORDS, DOCUMENT_MAX_CHUNKS, documentSemanticHash } from '../lib/ai/document-processing/chunking';
import { RETAINED_MODEL_ACTION_BINDINGS, RETAINED_MODEL_PROVIDER_BINDINGS, RETAINED_MODEL_SLUGS, RETAINED_PROVIDER_SLUGS, retireAiPersistence } from './retire-ai-persistence';

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
  test('retires action-key model routing indexes after slug indexes replace them', () => {
    const desired = [['modelKey', 'actionSlug'], ['actionSlug', 'enabled', 'priority']];
    expect(isLegacyIndex('modelActions', ['modelKey', 'actionKey'], desired)).toBe(true);
    expect(isLegacyIndex('modelActions', ['actionKey', 'enabled', 'priority'], desired)).toBe(true);
    expect(isLegacyIndex('modelActions', ['modelKey', 'actionSlug'], desired)).toBe(false);
  });
  test('migrates legacy model routes to strict action slugs and safely removes invalid routes', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const removals: string[] = [];
    const droppedIndexes: string[] = [];
    const updateQueries: string[] = [];
    const relations = [
      { _key: 'current', modelKey: 'model-a', actionSlug: 'chat', enabled: false, priority: 7 },
      { _key: 'legacy', modelKey: 'model-b', actionKey: 'action-ask', enabled: true, priority: 3 },
      { _key: 'invalid', modelKey: 'model-c', actionKey: 'action-invalid', enabled: true, priority: 1 },
      { _key: 'duplicate', modelKey: 'model-a', actionKey: 'action-chat', enabled: true, priority: 9 },
    ];
    const database = {
      collection(name: string) { return {
        async exists() { return name === 'modelActions' || name === 'actions'; },
        async indexes() { return name === 'modelActions' ? [{ id: 'legacy-unique', fields: ['modelKey', 'actionKey'] }, { id: 'current', fields: ['modelKey', 'actionSlug'] }] : []; },
        async dropIndex(id: string) { droppedIndexes.push(id); },
      }; },
      async query(query: string, bindVars: Record<string, unknown> = {}) {
        if (query.includes('FOR action IN actions')) return { async all() { return [{ key: 'action-ask', slug: 'ask' }, { key: 'action-chat', slug: 'chat' }, { key: 'action-invalid', slug: 'not.current' }]; } };
        if (query.includes('FOR relation IN modelActions')) return { async all() { return relations; } };
        if (query.startsWith('UPDATE')) { updates.push(bindVars); updateQueries.push(query); }
        if (query.startsWith('REMOVE')) removals.push(bindVars.key as string);
        return { async all() { return []; } };
      },
    };

    await migrateModelActionSlugs(database as never);

    expect(updates).toEqual([
      { key: 'duplicate', actionSlug: 'chat' },
      { key: 'legacy', actionSlug: 'ask' },
    ]);
    expect(updateQueries.every((query) => query.includes('actionKey: null') && query.includes('keepNull: false'))).toBe(true);
    expect(removals).toEqual(['invalid', 'current']);
    expect(droppedIndexes).toEqual(['legacy-unique']);
    expect(relations[3]).toMatchObject({ enabled: true, priority: 9, modelKey: 'model-a' });
  });
  test('model route migration works when actions are absent and routes already use slugs', async () => {
    const calls: string[] = [];
    const database = {
      collection(name: string) { return { async exists() { return name === 'modelActions'; }, async indexes() { return []; }, async dropIndex() {} }; },
      async query(query: string) {
        calls.push(query);
        if (query.includes('FOR relation IN modelActions')) return { async all() { return [{ _key: 'route', modelKey: 'model', actionSlug: 'reason', enabled: true, priority: 100 }]; } };
        return { async all() { return []; } };
      },
    };
    await migrateModelActionSlugs(database as never);
    expect(calls).not.toContain(expect.stringContaining('FOR action IN actions'));
    expect(calls.at(-1)).toContain('actionKey: null');
  });
  test('hard-drops retired persistence without recreating it and retains collaboration collections', async () => {
    const retired = ['agents', 'skills', 'agentSkills', 'scopeAgents', 'agentMembers', 'agentRuns', 'agentRunSteps', 'agentRunCalls', 'agentRunSources', 'agentArtifacts', 'agentArtifactChecks', 'agentMemories', 'runtimeVariables', 'capabilities', 'mindCapabilities', 'minds', 'actions', 'agentArtifactsLegacy', 'agentRunsLegacy', 'agent_runs', 'agentTools', 'toolActions', 'tools', 'templates'];
    expect(collections.filter(({ name }) => retired.includes(name))).toEqual([]);
    expect(collections.find(({ name }) => name === 'modelActions')?.indexes).toEqual([
      { fields: ['modelKey', 'actionSlug'], unique: true },
      { fields: ['actionSlug', 'enabled', 'priority'] },
    ]);
    for (const retained of ['scopes', 'channels', 'channelParticipants', 'orchestrators']) expect(collections.some(({ name }) => name === retained)).toBe(true);
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    for (const retained of ['ensureScopeScopesCollection', 'ensureScopeMembersCollection']) expect(source).toContain(retained);
    for (const name of retired) {
      expect(source).toContain(`'${name}',`);
      expect(source).not.toContain(`{ name: '${name}'`);
      expect(source).not.toContain(`collection('${name}').create`);
    }
    expect(source).not.toMatch(/ensure(?:Agent|RuntimeVariable|Skill|Action|Capability|Mind)/);
    expect(source.indexOf('await migrateModelActionSlugs(targetDb)')).toBeLessThan(source.indexOf('for (const name of droppedCollections)'));
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

  test('removes dedicated transcription models, routes, provider access, and credentials', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; }, async next() { return undefined; } }; } };
    await retireTranscriptionDomain(database as never);
    expect(calls).toHaveLength(6);
    expect(calls[0]?.query).toContain('REMOVE relation IN modelActions');
    expect(calls[1]?.query).toContain('REMOVE relation IN modelProviders');
    expect(calls.slice(2, 4).map(({ bindVars }) => bindVars?.['@collection'])).toEqual(['organizationProviders', 'orgCredentials']);
    expect(calls[4]?.query).toContain('REMOVE model IN models');
    expect(calls[5]?.query).toContain('REMOVE provider IN providers');
    expect(calls[0]?.bindVars?.modelSlugs).toEqual(['openai.gpt-4o-mini-transcribe', 'aws.transcribe-standard']);
    expect(calls[1]?.bindVars?.providerSlugs).toEqual(['aws-transcribe']);
  });

  test('hard-retires obsolete AI catalog configuration idempotently before seeding', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; }, async next() { return undefined; } }; } };
    await retireAiPersistence(database as never);
    await retireAiPersistence(database as never);
    expect(calls).toHaveLength(12);
    expect(calls[0]?.query).toContain('REMOVE relation IN modelActions');
    expect(calls[1]?.query).toContain('REMOVE relation IN modelProviders');
    expect(calls.slice(2, 4).map(({ bindVars }) => bindVars?.['@collection'])).toEqual(['organizationProviders', 'orgCredentials']);
    expect(calls[4]?.query).toContain('REMOVE model IN models');
    expect(calls[5]?.query).toContain('REMOVE provider IN providers');
    expect(calls[0]?.bindVars?.retainedModelActionBindings).toEqual(RETAINED_MODEL_ACTION_BINDINGS);
    expect(calls[1]?.bindVars?.retainedModelProviderBindings).toEqual(RETAINED_MODEL_PROVIDER_BINDINGS);
    expect(calls[0]?.query).toContain('CONCAT(model.slug, ":", relation.actionSlug) NOT IN @retainedModelActionBindings');
    expect(calls[1]?.query).toContain('CONCAT(model.slug, ":", provider.slug, ":", relation.providerModelId) NOT IN @retainedModelProviderBindings');
    expect(calls[2]?.bindVars?.retainedProviderSlugs).toEqual(RETAINED_PROVIDER_SLUGS);
    expect(calls[2]?.query).toContain('relation.providerKey NOT IN retainedProviderKeys');
    expect(calls[4]?.query).toContain('model.slug NOT IN @retainedModelSlugs');
    expect(calls[5]?.query).toContain('provider.slug NOT IN @retainedProviderSlugs');
    expect(calls.map(({ query }) => query).join('\n')).not.toMatch(/usage/i);

    const seedSource = await Bun.file(new URL('../lib/db/seed.ts', import.meta.url)).text();
    expect(seedSource.indexOf('await retireAiPersistence(db)')).toBeLessThan(seedSource.indexOf('const results = await seedAiRuntimeNodes()'));
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
  test('drops every obsolete tombstone index without preserving the retired field in source', () => {
    expect(isLegacyIndex('collections', ['scopeKey', LEGACY_REMOVAL_MARKER])).toBe(true);
    expect(isLegacyIndex('documents', ['scopeKey', 'folderKey', LEGACY_REMOVAL_MARKER])).toBe(true);
    expect(LEGACY_REMOVAL_MARKER).toBe(['deleted', 'At'].join(''));
  });
  test('hard-removes legacy tombstones and reconciles their indexes for every affected collection', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    for (const name of ['scopes', 'scopeScopes', 'folders', 'images', 'visualIdentities', 'collections', 'imageCollecitionHightlights', 'documents', 'documentVersions', 'shares', 'places', 'trips', 'books', 'emailThreads', 'messages']) {
      expect(source).toContain(`'${name}'`);
    }
    expect(source).toContain('resource[@marker] != null');
    expect(source).toContain('REMOVE resource IN @@collection');
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
  test('retains only minimal places and declares book-generation collection indexes', () => {
    expect(collections.filter(({ name }) => ['places', 'trips', 'tripPlaces', 'placeVisits'].includes(name)).map(({ name }) => name)).toEqual(['places']);
    expect(collections.find(({ name }) => name === 'places')).toEqual({
      name: 'places',
      embedKeys: ['name'],
      indexes: [
        { fields: ['scopeKey'] },
        { fields: ['scopeKey', 'countryCode'] },
        { fields: ['scopeKey', 'countryCode', 'name'], unique: true },
      ],
    });
    const bookNames = ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress'];
    expect(collections.filter(({ name }) => bookNames.includes(name)).map(({ name }) => name)).toEqual(bookNames);
    expect(collections.find(({ name }) => name === 'bookChapters')?.indexes).toContainEqual({ fields: ['scopeKey', 'bookKey', 'position'], unique: true });
    expect(collections.find(({ name }) => name === 'bookProgress')?.indexes).toContainEqual({ fields: ['scopeKey', 'userKey', 'bookKey', 'chapterKey'], unique: true });
    expect(collections.find(({ name }) => name === 'books')?.indexes).toContainEqual({ fields: ['scopeKey', 'generationRequestKey'], unique: true, sparse: true });
    const emailNames = ['emailAccounts', 'emailThreads', 'emailMessages', 'emailContacts', 'emailWritingProfiles', 'emailRules', 'emailReplyDrafts'];
    expect(collections.filter(({ name }) => emailNames.includes(name)).map(({ name }) => name)).toEqual(emailNames);
    expect(collections.find(({ name }) => name === 'emailAccounts')?.skipEmbedding).toBe(true);
    expect(collections.find(({ name }) => name === 'emailMessages')?.indexes).toContainEqual({ fields: ['scopeKey', 'accountKey', 'providerMessageId'], unique: true });
  });
  test('drops obsolete place indexes while preserving current indexes', () => {
    const desired = [['scopeKey'], ['scopeKey', 'countryCode'], ['scopeKey', 'countryCode', 'name']];
    expect(isLegacyIndex('places', ['scopeKey', 'isWishlist'], desired)).toBe(true);
    expect(isLegacyIndex('places', ['scopeKey', 'isFavorite'], desired)).toBe(true);
    expect(isLegacyIndex('places', ['scopeKey', 'countryCode'], desired)).toBe(false);
  });
  test('hard-retires trip persistence before projecting and indexing places', async () => {
    const dropped: string[] = [];
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const existing = new Set(['shares', 'tagAssignments', 'bookSources', 'tripPlaces', 'placeVisits', 'trips']);
    const database = {
      collection(name: string) { return { async exists() { return existing.has(name); }, async drop() { dropped.push(name); existing.delete(name); } }; },
      async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return []; }, async next() { return 0; } }; },
    };
    await migrateMinimalPlacesAndRetireTrips(database as never);
    await migrateMinimalPlacesAndRetireTrips(database as never);
    expect(calls.map(({ bindVars }) => bindVars?.['@collection'])).toEqual(['shares', 'tagAssignments', 'bookSources', 'shares', 'tagAssignments', 'bookSources']);
    expect(calls.every(({ query }) => query.includes('resource.sourceType == "trip"') && query.includes('REMOVE resource'))).toBe(true);
    expect(dropped).toEqual(['tripPlaces', 'placeVisits', 'trips']);

    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const cleanup = source.indexOf('await migrateMinimalPlacesAndRetireTrips(targetDb)');
    const activeLoop = source.indexOf('for (const spec of collections)');
    expect(cleanup).toBeGreaterThan(-1);
    expect(cleanup).toBeLessThan(activeLoop);
    expect(source).toContain('REPLACE place WITH UNSET(replacement, "_rev") IN places');
    expect(source).toContain('embedding: await generateEmbedding(canonical.name)');
    expect(source).toContain('FILTER place.kind == "country" REMOVE place IN places');
    expect(source).toContain('resource.sourceType == "place" && resource.sourceKey IN @countryPlaceKeys');
    expect(source).toContain('places migration found duplicate saved cities');
  });
  test('force-projects legacy places once while preserving keys and regenerating name-only embeddings', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      let legacy = true;
      let replacements: Array<Record<string, unknown>> = [];
      const database = {
        collection(name: string) { return { async exists() { return name === 'places'; }, async drop() {} }; },
        async query(query: string, bindVars?: Record<string, unknown>) {
          if (query.includes('Validate every retained place')) return { async all() { return bindVars?.after === '' ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', name: legacy ? ' Stockholm ' : 'Stockholm', countryCode: legacy ? 'se' : 'SE', latitude: 59.3293, longitude: 18.0686, createdAt: '2026-08-08T12:00:00.000Z' }] : []; }, async next() { return undefined; } };
          if (query.includes('WITH COUNT INTO count')) return { async all() { return []; }, async next() { return undefined; } };
          if (query.includes('RETURN place') && !query.includes('RETURN LENGTH')) return { async all() { return legacy ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', _rev: 'legacy-revision', scopeKey: 'cmrnlzf640001qc7kazsr96k5', kind: 'place', name: ' Stockholm ', countryCode: 'se', latitude: 59.3293, longitude: 18.0686, embedding: [], createdAt: '2026-08-08T12:00:00.000Z', updatedAt: '2026-08-08T12:00:00.000Z' }] : []; }, async next() { return undefined; } };
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
        scopeKey: 'cmrnlzf640001qc7kazsr96k5',
        name: 'Stockholm',
        countryCode: 'SE',
        latitude: 59.3293,
        longitude: 18.0686,
        embedding: expect.any(Array),
        createdAt: '2026-08-08T12:00:00.000Z',
      });
      expect(first.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      replacements = [];
      await migrateMinimalPlacesAndRetireTrips(database as never);
      expect(replacements).toEqual([]);
    } finally {
      if (previous === undefined) delete process.env.CONTENT_E2E;
      else process.env.CONTENT_E2E = previous;
    }
  });
  test('rejects duplicate canonical saved cities before changing places', async () => {
    let startedTransaction = false;
    const database = {
      collection(name: string) { return { async exists() { return name === 'places'; }, async drop() {} }; },
      async query(query: string, bindVars?: Record<string, unknown>) {
        if (query.includes('Validate every retained place')) return { async all() { return bindVars?.after === '' ? [{ _key: 'cmrnlzf650002qc7k4p5zem5w', scopeKey: 'cmrnlzf640001qc7kazsr96k5', name: ' Stockholm ', countryCode: 'se', latitude: 59.3293, longitude: 18.0686, createdAt: '2026-08-08T12:00:00.000Z' }] : []; } };
        if (query.includes('WITH COUNT INTO count')) return { async all() { return [{ scopeKey: 'cmrnlzf640001qc7kazsr96k5', countryCode: 'SE', name: 'Stockholm', count: 2 }]; } };
        throw new Error(`Unexpected migration query: ${query}`);
      },
      async beginTransaction() { startedTransaction = true; throw new Error('should not start'); },
    };
    await expect(migrateMinimalPlacesAndRetireTrips(database as never)).rejects.toThrow('duplicate saved cities');
    expect(startedTransaction).toBe(false);
  });
  test('removes legacy scope-shared book progress before per-user indexes', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(progress, "userKey") REMOVE progress IN bookProgress');
    expect(source).toContain('Dropped obsolete scope-shared book progress index');
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
    for (const collection of ['folders', 'images', 'collections', 'documents', 'emailThreads'] as const) {
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
  test('backfills stable email reply depths from RFC message links', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = { async query(query: string, bindVars?: Record<string, unknown>) {
      calls.push({ query, bindVars });
      if (calls.length === 1) return { async all() { return [{ scopeKey: 'scope', threadKey: 'thread' }]; } };
      if (calls.length === 2) return { async all() { return [{ key: 'one', messageIdHeader: '<one@example.com>' }, { key: 'two', messageIdHeader: '<two@example.com>', inReplyTo: '<one@example.com>' }]; } };
      return { async all() { return []; } };
    } };
    await migrateEmailReplyMetadata(database as never);
    expect(calls[2]?.bindVars?.updates).toEqual([{ key: 'one', parentMessageId: null, replyDepth: 0 }, { key: 'two', parentMessageId: '<one@example.com>', replyDepth: 1 }]);
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
    expect(source).toContain("{ fields: ['distinctId', 'createdAt'] }");
  });
});
