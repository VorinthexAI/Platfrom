import { describe, expect, test } from 'bun:test';
import { createArchivePersistence, type ArchiveQueryExecutor } from './archive-persistence.node';

const scopeKey = 'cm00000000000000000000001';
const folderKey = 'cm00000000000000000000002';
const timestamp = '2026-07-22T10:00:00.000Z';

describe('scoped Archive persistence', () => {
  test('updates by key and scope and explicitly unsets optional fields', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ArchiveQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        return { async next() { return { _key: folderKey, scopeKey, name: 'Root', embedding: [], createdAt: timestamp, updatedAt: timestamp }; } };
      },
    };
    const result = await createArchivePersistence(executor).updateFolder(scopeKey, folderKey, {
      parentFolderKey: undefined,
      description: undefined,
      deletedAt: null,
      updatedAt: timestamp,
    });
    expect(result).toMatchObject({ key: folderKey, scopeKey, name: 'Root' });
    expect(calls[0]?.query).toContain('current._key == @key && current.scopeKey == @scopeKey');
    expect(calls[0]?.query).toContain('current._internalDeletion');
    expect(calls[0]?.query).toContain('DOCUMENT(folders, @destinationKey)');
    expect(calls[0]?.query).toContain('REPLACE current WITH UNSET');
    expect(calls[0]?.bindVars).toMatchObject({ key: folderKey, scopeKey, unset: ['parentFolderKey', 'description'], patch: { deletedAt: null, updatedAt: timestamp } });
  });

  test('returns false when a scope-bounded delete matches nothing', async () => {
    const executor: ArchiveQueryExecutor = { async query() { return { async next() { return undefined; } }; } };
    expect(await createArchivePersistence(executor).deleteDocument(scopeKey, folderKey)).toBe(false);
  });

  test('only the marker owner can unfreeze a pending deletion', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ArchiveQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return undefined; } }; } };
    await createArchivePersistence(executor).setFolderDeletion(scopeKey, folderKey, undefined, 'invocation-owner');
    expect(calls[0]?.query).toContain('current._internalDeletion.owner == @owner');
    expect(calls[0]?.bindVars).toMatchObject({ owner: 'invocation-owner', unset: ['_internalDeletion'] });
  });

  test('guards every Archive insert with its folder or document owner', async () => {
    const source = await Bun.file(new URL('./archive-persistence.node.ts', import.meta.url)).text();
    expect(source).toContain('Folder destination is pending deletion.');
    expect(source).toContain('Document destination is pending deletion.');
    expect(source).toContain('Share owner is pending deletion.');
    expect(source).toContain('Version owner is pending deletion.');
    expect(source.match(/DOCUMENT\(folders,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/DOCUMENT\(documents,/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
