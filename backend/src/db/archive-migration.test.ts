import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { stageLegacyDocumentShares } from './archive-migration';

describe('Archive share migration staging', () => {
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
    expect(source).toContain("const fields = ['scopeKey', 'sourceType', 'sourceKey', 'permission', 'tokenHash', 'passwordHash', 'expiresAt', 'revokedAt', 'deletedAt', 'createdAt', 'updatedAt']");
    expect(source).toContain('if (!copied || !equal(copied, prepared))');
  });
});
