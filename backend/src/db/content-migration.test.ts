import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { stageLegacyDocumentShares } from './content-migration';

describe('Content share migration staging', () => {
  test('projects legacy document shares into global shares without plaintext tokens', () => {
    const staged = stageLegacyDocumentShares([{ _key: 'share', documentKey: 'document', token: 'legacy-token', permission: 'edit' }]);
    expect(staged).toEqual([{ _key: 'share', tokenHash: createHash('sha256').update('legacy-token').digest('hex'), permission: 'comment' }]);
    expect(JSON.stringify(staged)).not.toContain('legacy-token');
  });
  test('rejects malformed and colliding token material before writes', () => {
    expect(() => stageLegacyDocumentShares([{ _key: 'share' }])).toThrow('neither');
    expect(() => stageLegacyDocumentShares([{ _key: 'one', token: 'same' }, { _key: 'two', token: 'same' }])).toThrow('duplicate');
  });
  test('requires every canonical field to match before legacy drop', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("const fields = ['scopeKey', 'sourceType', 'sourceKey', 'permission', 'tokenHash', 'passwordHash', 'expiresAt', 'revokedAt', 'createdAt', 'updatedAt']");
    expect(source).toContain('if (!copied || !equal(copied, prepared))');
  });
  test('creates global search history and a separate contextual replay cache', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("name: 'userSearches'");
    expect(source).toContain("fields: ['userKey', 'normalizedQuery'], unique: true");
    expect(source).toContain("name: 'contentSearchQueries'");
    expect(source).toContain("fields: ['actorKey', 'scopeKey', 'normalizedQuery', 'folderKey', 'includeDescendants'], unique: true");
    expect(source).toContain('COLLECT userKey = cached.actorKey, normalizedQuery = cached.normalizedQuery');
    expect(source).toContain('usageCount: MAX([OLD.usageCount, @usageCount])');
    expect(source).toContain('contextDomain: null, usageCount: null');
    expect(source).toContain('usageCount: HAS(query, "count") ? query.count : 1');
    expect(source).toContain("fields: ['scopeKey', 'isFavorite']");
    expect(source).toContain('query.expiresAt <= DATE_ISO8601(DATE_NOW()) && query.output != null');
  });
  test('creates private one-to-one summary audio storage indexes', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("name: 'documentSummaryAudio'");
    expect(source).toContain("fields: ['summaryKey'], unique: true");
    expect(source).toContain("fields: ['storageKey'], unique: true");
  });
  test('durably inventories legacy object storage and cleans typed dependents', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    expect(source).toContain("name: 'storageDeletionJobs'");
    expect(source).toContain('UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs');
    expect(source).toContain('document.sourceStorageKeys');
    expect(source).toContain('document.speechStorageKeys');
    expect(source).toContain('FOR image IN images FILTER image._key IN @keys && IS_STRING(image.storageKey)');
    expect(source).toContain('FOR audio IN documentAudioVersions FILTER audio.documentKey IN @keys && IS_STRING(audio.storageKey)');
    expect(source).toContain('FOR audio IN documentSummaryAudio FILTER audio.documentKey IN @keys && IS_STRING(audio.storageKey)');
    expect(source.indexOf('UPSERT { storageKey }')).toBeLessThan(source.indexOf("await removeDocumentDependents(documentKeys"));
    expect(source).toContain("await removeBy('documentShares', 'documentKey', documentKeys)");
    expect(source).toContain("await removeTyped('shares', 'sourceType', 'document'");
    expect(source).toContain("await removeTyped('tagAssignments', 'sourceType', 'document'");
    expect(source).toContain("await removeTyped('userHiddens', 'source', 'document'");
    expect(source).toContain("await removeBy('agentSkills', 'agentKey', agentKeys)");
    expect(source).toContain("['agentRunCalls', 'agentRunSteps', 'agentArtifacts', 'agentRunSources', 'agentArtifactChecks']");
    expect(source).toContain("FILTER thread.rootMessageKey IN @keys");
    expect(source).toContain('DOCUMENT(images, upload.imageKey) == null');
  });
});
