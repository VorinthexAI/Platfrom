import { describe, expect, test } from 'bun:test';
import { isLegacyIndex, normalizeLegacyDocumentSharePermission } from './arango-migrate-indexes';
import { legacyContentRepresentations, stageLegacyDocumentShares } from './content-migration';
import { collections, migrateContentDocuments, migrateContentFavorites, migrateContentVersions, migrateEmailReplyMetadata, migrateImageCaptions, retireRemovedActions } from './arango-migrate';
import { EMBEDDING_DIMENSIONS, embeddingMetadata } from '../lib/embeddings';
import { DOCUMENT_CHUNK_MAX_WORDS, DOCUMENT_MAX_CHUNKS, documentSemanticHash } from '../lib/ai/document-processing/chunking';

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
    expect(calls.at(-1)).toContain('caption.embedding != image.embedding');
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('Dropped obsolete unique image-caption pHash index');
  });
  test('retires removed action relations before their fixed seed keys are reused', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const database = {
      async query(query: string, bindVars?: Record<string, unknown>) {
        calls.push({ query, bindVars });
        return { async all() { return []; }, async next() { return undefined; } };
      },
    };

    await retireRemovedActions(database as never);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.query).toContain('REMOVE relation IN modelActions');
    expect(calls[1]?.query).toContain('REMOVE action IN actions');
    expect(calls[0]?.bindVars).toEqual({ slugs: ['document-generate-json'] });
    expect(calls[1]?.bindVars).toEqual({ slugs: ['document-generate-json'] });
  });

  test('normalizes legacy share permissions without granting additional access', () => {
    expect(normalizeLegacyDocumentSharePermission('read')).toBe('read');
    expect(normalizeLegacyDocumentSharePermission('view')).toBe('read');
    expect(normalizeLegacyDocumentSharePermission('comment')).toBe('comment');
    expect(normalizeLegacyDocumentSharePermission('edit')).toBe('comment');
    expect(normalizeLegacyDocumentSharePermission(undefined)).toBe('read');
  });
  test('drops the obsolete one-agent-per-database scope assignment index', () => {
    expect(isLegacyIndex('scopeAgents', ['agentKey'])).toBe(true);
    expect(isLegacyIndex('scopeAgents', ['scopeKey', 'agentKey'])).toBe(false);
    expect(isLegacyIndex('scopeAgents', ['agentKey', 'status'])).toBe(false);
  });
  test('drops obsolete search uniqueness and expiry indexes', () => {
    expect(isLegacyIndex('contentSearchQueries', ['actorKey', 'scopeKey', 'normalizedQuery'])).toBe(true);
    expect(isLegacyIndex('contentSearchQueries', ['expiresAt'])).toBe(true);
    expect(isLegacyIndex('contentSearchQueries', ['actorKey', 'scopeKey', 'normalizedQuery', 'folderKey', 'includeDescendants'])).toBe(false);
  });
  test('never classifies a currently desired index as legacy', () => {
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['storageKey']])).toBe(false);
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['documentKey', 'version']])).toBe(true);
  });
  test('declares private independent document audio version indexes', () => {
    const audio = collections.find(({ name }) => name === 'documentAudioVersions');
    expect(audio?.skipEmbedding).toBe(true);
    expect(audio?.indexes).toContainEqual({ fields: ['scopeKey', 'documentKey', 'version'], unique: true });
    expect(audio?.indexes).toContainEqual({ fields: ['storageKey'], unique: true });
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
  test('declares travel and book-generation collection indexes', () => {
    expect(collections.filter(({ name }) => ['places', 'trips', 'tripPlaces', 'placeVisits'].includes(name)).map(({ name }) => name)).toEqual(['places', 'trips', 'tripPlaces', 'placeVisits']);
    expect(collections.find(({ name }) => name === 'tripPlaces')?.indexes).toContainEqual({ fields: ['scopeKey', 'tripKey', 'position'], unique: true });
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
  test('removes legacy scope-shared book progress before per-user indexes', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !HAS(progress, "userKey") REMOVE progress IN bookProgress');
    expect(source).toContain('Dropped obsolete scope-shared book progress index');
  });
  test('derives deterministic historical representations from version content', () => {
    expect(legacyContentRepresentations('First <line>\n\nSecond')).toEqual({
      html: '<p>First &lt;line&gt;</p><p>Second</p>',
    });
    expect(() => legacyContentRepresentations('   ')).toThrow('must not be blank');
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
    expect(source).toContain('contentFolderKey: project.contentFolderKey != null ? project.contentFolderKey : project.archiveFolderKey');
    expect(source).toContain("_key: 'content-document-shares-cutover'");
    expect(source.indexOf('await migrateGenericContentContracts(targetDb)')).toBeLessThan(source.indexOf('for (const spec of collections)'));
  });
  test('repairs recoverable document and version representations without borrowing data', async () => {
    const previousContentArray = process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED;
    process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED = 'true';
    try {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const documentMigration = migrationDatabase('documents', { _key: 'document-1', _rev: 'document-rev', name: 'Current', html: '   ', content: 'Current body', embedding, ...embeddingMetadata(), json: {} });
    await migrateContentDocuments(documentMigration.database);
    expect(documentMigration.update?.bindVars?.updates).toEqual([{ _key: 'document-1', _rev: 'document-rev', source: { name: 'Current', html: '   ', content: 'Current body' }, html: '<p>Current body</p>', content: 'Current body', contentChunks: ['Current body'], embedding, chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Current body') }]);
    expect(documentMigration.update?.query).toContain('UNSET(MERGE(document');
    expect(documentMigration.update?.query).toContain('document._rev == patch._rev');
    expect(documentMigration.update?.query).toContain('UNSET(patch, "_key", "_rev", "source")');
    expect(documentMigration.update?.query).not.toContain('"storageKey", "sizeBytes"');

    const versionMigration = migrationDatabase('documentVersions', { _key: 'version-1', _rev: 'version-rev', html: '\n\t', content: 'Historical body', embedding, ...embeddingMetadata(), json: {}, storageKey: 'legacy', sizeBytes: 12, updatedAt: '2026-01-01T00:00:00.000Z' });
    await migrateContentVersions(versionMigration.database);
    expect(versionMigration.update?.bindVars?.updates).toEqual([{ _key: 'version-1', _rev: 'version-rev', source: { html: '\n\t', content: 'Historical body' }, html: '<p>Historical body</p>', content: ['Historical body'], embedding, chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: documentSemanticHash('Historical body') }]);
    expect(versionMigration.update?.query).toContain('snapshot._rev == patch._rev');
    expect(versionMigration.update?.query).toContain('"json", "storageKey", "sizeBytes", "updatedAt"');
    expect(versionMigration.update?.query).toContain('migration must not infer deletion ownership');
    } finally {
      if (previousContentArray === undefined) delete process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED;
      else process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED = previousContentArray;
    }
  });
  test('regenerates legacy 1536 embeddings without allowing a concurrent replacement', async () => {
    const previous = process.env.CONTENT_E2E;
    process.env.CONTENT_E2E = 'true';
    try {
      const migration = migrationDatabase('documents', { _key: 'legacy-document', _rev: 'legacy-rev', name: 'Legacy', html: '<p>Historical body</p>', content: 'Historical body', embedding: Array(1_536).fill(0.1) });
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
  test('keeps version content strings during the compatibility rollout phase', async () => {
    const previous = process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED;
    process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED = 'false';
    try {
      const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
      const migration = migrationDatabase('documentVersions', { _key: 'version-rollout', _rev: 'version-rev', html: '<p>Historical body</p>', content: 'Historical body', embedding });
      await migrateContentVersions(migration.database);
      const [patch] = migration.update?.bindVars?.updates as Array<Record<string, unknown>>;
      expect(patch.content).toBe('Historical body');
      expect(patch.chunkEmbeddings).toEqual([embedding]);
    } finally {
      if (previous === undefined) delete process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED;
      else process.env.CONTENT_VERSION_CONTENT_ARRAY_ENABLED = previous;
    }
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
    for (const collection of ['images', 'collections', 'documents', 'emailThreads'] as const) {
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
    const agentReconciliation = source.indexOf('reconcileOrganizationInheritedAgentMemberships(organization.key');
    expect(canonicalCopy).toBeGreaterThan(-1);
    expect(scopeReconciliation).toBeGreaterThan(canonicalCopy);
    expect(agentReconciliation).toBeGreaterThan(scopeReconciliation);
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
