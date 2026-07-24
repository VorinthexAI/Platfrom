import { describe, expect, test } from 'bun:test';
import { isLegacyIndex, normalizeLegacyDocumentSharePermission } from './arango-migrate-indexes';
import { legacyContentRepresentations, stageLegacyDocumentShares } from './archive-migration';

describe('Arango migration indexes', () => {
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
    expect(source).toContain("{ fields: ['directUserOrganizationKey', 'directOrchestratorKey'], unique: true, sparse: true }");
    expect(source).toContain("{ fields: ['pollKey', 'optionKey', 'participantKey'], unique: true }");
    expect(source).toContain("fields[0] === 'scopeKey' && fields[1] === 'name'");
    expect(source).toContain('Dropped obsolete unique channel-name index');
  });
  test('derives deterministic historical representations from version content', () => {
    expect(legacyContentRepresentations('First <line>\n\nSecond')).toEqual({
      html: '<p>First &lt;line&gt;</p><p>Second</p>',
      json: { type: 'doc', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First <line>' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
      ] },
    });
    expect(() => legacyContentRepresentations('   ')).toThrow('must not be blank');
  });
  test('migration never hashes missing data or borrows current document representations', async () => {
    const source = await Bun.file(new URL('./arango-migrate.ts', import.meta.url)).text();
    const helperSource = await Bun.file(new URL('./archive-migration.ts', import.meta.url)).text();
    expect(source).toContain('FILTER !IS_STRING(share.token) || LENGTH(share.token) == 0');
    expect(source).toContain('RETURN { key: share._key, hash: SHA256(share.token) }');
    expect(source).not.toContain('document.html');
    expect(source).not.toContain('document.json');
    expect(helperSource).toContain('has neither a valid tokenHash nor a plaintext token');
    expect(source).toContain('beginTransaction');
    expect(source).toContain('migration verification failed');
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
});
