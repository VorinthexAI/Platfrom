import { describe, expect, test } from 'bun:test';
import { isLegacyIndex, normalizeLegacyDocumentSharePermission } from './arango-migrate-indexes';
import { legacyContentRepresentations, stageLegacyDocumentShares } from './archive-migration';
import { migrateArchiveDocuments, migrateArchiveFavorites, migrateArchiveVersions, retireRemovedActions } from './arango-migrate';
import { EMBEDDING_DIMENSIONS, embeddingMetadata } from '../lib/embeddings';

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
  test('never classifies a currently desired index as legacy', () => {
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['storageKey']])).toBe(false);
    expect(isLegacyIndex('documentVersions', ['storageKey'], [['documentKey', 'version']])).toBe(true);
  });
  test('declares sparse direct-channel identity uniqueness and poll vote uniqueness', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("{ fields: ['organizationKey', 'kind', 'name'], unique: true, sparse: true }");
    expect(source).toContain("{ fields: ['pollKey', 'optionKey', 'participantKey'], unique: true }");
    expect(source).toContain("fields[0] === 'scopeKey' && fields[1] === 'name'");
    expect(source).toContain('Dropped obsolete unique channel-name index');
  });
  test('derives deterministic historical representations from version content', () => {
    expect(legacyContentRepresentations('First <line>\n\nSecond')).toEqual({
      html: '<p>First &lt;line&gt;</p><p>Second</p>',
    });
    expect(() => legacyContentRepresentations('   ')).toThrow('must not be blank');
  });
  test('migration never hashes missing data or borrows current documents for version history', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const helperSource = await Bun.file(new URL('./archive-migration.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !IS_STRING(share.token) || LENGTH(share.token) == 0');
    expect(source).toContain('RETURN { key: share._key, hash: SHA256(share.token) }');
    expect(source).toContain('nonEmptyString(snapshot.html)');
    expect(source).not.toContain('DOCUMENT(documents, snapshot.documentKey)');
    expect(helperSource).toContain('has neither a valid tokenHash nor a plaintext token');
    expect(source).toContain('beginTransaction');
    expect(source).toContain('migration verification failed');
  });
  test('repairs recoverable document and version representations without borrowing data', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);
    const documentMigration = migrationDatabase('documents', { _key: 'document-1', _rev: 'document-rev', name: 'Current', html: '   ', content: 'Current body', embedding, ...embeddingMetadata(), json: {} });
    await migrateArchiveDocuments(documentMigration.database);
    expect(documentMigration.update?.bindVars?.updates).toEqual([{ _key: 'document-1', _rev: 'document-rev', source: { name: 'Current', html: '   ', content: 'Current body' }, html: '<p>Current body</p>', content: 'Current body', embedding, ...embeddingMetadata() }]);
    expect(documentMigration.update?.query).toContain('UNSET(MERGE(document');
    expect(documentMigration.update?.query).toContain('document._rev == patch._rev');
    expect(documentMigration.update?.query).toContain('UNSET(patch, "_key", "_rev", "source")');
    expect(documentMigration.update?.query).not.toContain('"storageKey", "sizeBytes"');

    const versionMigration = migrationDatabase('documentVersions', { _key: 'version-1', _rev: 'version-rev', html: '\n\t', content: 'Historical body', embedding, ...embeddingMetadata(), json: {}, storageKey: 'legacy', sizeBytes: 12, updatedAt: '2026-01-01T00:00:00.000Z' });
    await migrateArchiveVersions(versionMigration.database);
    expect(versionMigration.update?.bindVars?.updates).toEqual([{ _key: 'version-1', _rev: 'version-rev', source: { html: '\n\t', content: 'Historical body' }, html: '<p>Historical body</p>', content: 'Historical body', embedding, ...embeddingMetadata() }]);
    expect(versionMigration.update?.query).toContain('snapshot._rev == patch._rev');
    expect(versionMigration.update?.query).toContain('"json", "storageKey", "sizeBytes", "updatedAt"');
    expect(versionMigration.update?.query).toContain('migration must not infer deletion ownership');
  });
  test('regenerates legacy 1536 embeddings without allowing a concurrent replacement', async () => {
    const previous = process.env.ARCHIVE_E2E;
    process.env.ARCHIVE_E2E = 'true';
    try {
      const migration = migrationDatabase('documents', { _key: 'legacy-document', _rev: 'legacy-rev', name: 'Legacy', html: '<p>Historical body</p>', content: 'Historical body', embedding: Array(1_536).fill(0.1) });
      await migrateArchiveDocuments(migration.database);
      const [patch] = migration.update?.bindVars?.updates as Array<Record<string, unknown>>;
      expect(patch.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(patch).toMatchObject({ _key: 'legacy-document', _rev: 'legacy-rev', source: { name: 'Legacy', html: '<p>Historical body</p>', content: 'Historical body' }, ...embeddingMetadata() });
      expect(migration.update?.query).toContain('FILTER document != null && document._rev == patch._rev');
    } finally {
      if (previous === undefined) delete process.env.ARCHIVE_E2E;
      else process.env.ARCHIVE_E2E = previous;
    }
  });
  test('physically normalizes and verifies folder and document favorites idempotently', async () => {
    for (const collection of ['folders', 'documents'] as const) {
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
      await migrateArchiveFavorites(database as never, collection);
      await migrateArchiveFavorites(database as never, collection);
      expect(calls.filter(({ query }) => query.includes('UPDATE resource WITH { isFavorite: false }'))).toHaveLength(2);
      expect(calls.every(({ query }) => !query.includes('isFavorite') || query.includes('!IS_BOOL(resource.isFavorite)'))).toBe(true);
      expect(calls.filter(({ query }) => query.includes('RETURN LENGTH'))).toHaveLength(2);
      expect(calls.every(({ bindVars }) => bindVars?.['@collection'] === collection)).toBe(true);
    }
  });
  test('preflights every share and orders index removal before plaintext removal and hash index creation', async () => {
    const staged = stageLegacyDocumentShares([
      { _key: 'first', token: 'one', permission: 'read' },
      { _key: 'second', token: 'two', permission: 'edit' },
    ]);
    expect(staged).toHaveLength(2);
    expect(new Set(staged.map((share) => share.tokenHash)).size).toBe(2);
    expect(staged.map((share) => share.permission)).toEqual(['read', 'comment']);

    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const preflight = source.indexOf('const invalidShare =');
    const dropLegacy = source.indexOf("fields[0] === 'token'");
    const removePlaintext = source.indexOf('FILTER HAS(share, "token")');
    const createIndexes = source.indexOf('for (const index of spec.indexes ?? [])');
    expect(preflight).toBeGreaterThan(-1);
    expect(preflight).toBeLessThan(dropLegacy);
    expect(dropLegacy).toBeLessThan(removePlaintext);
    expect(removePlaintext).toBeLessThan(createIndexes);
    expect(source).toContain('LIMIT 100');
    expect(source).toContain('share._key > @after');
    expect(source).not.toContain('LET candidates = (FOR share IN documentShares');
    expect(source).toContain('LIMIT 1\n      RETURN hash');
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

  test('purges retired Hunt, waitlist, Polar, and event data idempotently', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const retiredCollections = [
      'events',
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
  });
});
