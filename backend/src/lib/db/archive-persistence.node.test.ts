import { describe, expect, test } from 'bun:test';
import { createArchivePersistence, type ArchiveQueryExecutor } from './archive-persistence.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

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
    expect(calls[0]?.bindVars).not.toHaveProperty('changesLocation');
  });

  test('returns false when a scope-bounded delete matches nothing', async () => {
    const executor: ArchiveQueryExecutor = { async query() { return { async next() { return undefined; } }; } };
    expect(await createArchivePersistence(executor).deleteDocument(scopeKey, folderKey)).toBe(false);
  });

  test('canonicalizes HTML and derives content at the document write boundary', async () => {
    const calls: Array<{ bindVars?: Record<string, unknown> }> = [];
    const executor: ArchiveQueryExecutor = {
      async query(_query, bindVars) {
        calls.push({ bindVars });
        return { async next() { return undefined; } };
      },
    };
    await createArchivePersistence(executor).updateDocument(scopeKey, folderKey, {
      html: '<p>Hello <strong>Core</strong></p>',
      content: 'Hello Core',
      embedding: Array(EMBEDDING_DIMENSIONS).fill(1),
    });
    expect(calls[0]?.bindVars?.patch).toMatchObject({ html: '<p>Hello <strong>Core</strong></p>', content: 'Hello Core' });
    expect(calls[0]?.bindVars).toMatchObject({ changesLocation: false });
    expect(() => createArchivePersistence(executor).updateDocument(scopeKey, folderKey, { content: 'detached' })).toThrow('Document content must be updated through HTML.');
    expect(() => createArchivePersistence(executor).updateDocument(scopeKey, folderKey, { html: '<p>Detached</p>' })).toThrow('Document HTML updates require a fresh embedding.');
    expect(() => createArchivePersistence(executor).updateDocument(scopeKey, folderKey, { html: '<p onclick="bad()">Detached</p>', content: 'Detached', embedding: Array(EMBEDDING_DIMENSIONS).fill(1) })).toThrow('Document representations must be canonical and agreeing.');
  });

  test('persists favorite-only folder and document patches without representation fields', async () => {
    const calls: Array<{ bindVars?: Record<string, unknown> }> = [];
    const executor: ArchiveQueryExecutor = {
      async query(_query, bindVars) {
        calls.push({ bindVars });
        return { async next() { return undefined; } };
      },
    };
    const persistence = createArchivePersistence(executor);
    await persistence.updateFolder(scopeKey, folderKey, { isFavorite: true, updatedAt: timestamp });
    await persistence.updateDocument(scopeKey, folderKey, { isFavorite: true, updatedAt: timestamp });
    expect(calls.map(({ bindVars }) => bindVars?.patch)).toEqual([
      { isFavorite: true, updatedAt: timestamp },
      { isFavorite: true, updatedAt: timestamp },
    ]);
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
