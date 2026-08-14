import { describe, expect, test } from 'bun:test';
import { createContentPersistence, type ContentQueryExecutor } from './content-persistence.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const scopeKey = 'cm00000000000000000000001';
const folderKey = 'cm00000000000000000000002';
const timestamp = '2026-07-22T10:00:00.000Z';
const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);

describe('scoped Content persistence', () => {
  test('updates by key and scope and explicitly unsets optional fields', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        return { async next() { return { _key: folderKey, scopeKey, name: 'Root', embedding, createdAt: timestamp, updatedAt: timestamp }; } };
      },
    };
    const result = await createContentPersistence(executor).updateFolder(scopeKey, folderKey, {
      parentFolderKey: undefined,
      description: undefined,
      coverImageKey: undefined,
      embedding,
      deletedAt: null,
      updatedAt: timestamp,
    });
    expect(result).toMatchObject({ key: folderKey, scopeKey, name: 'Root' });
    expect(calls[0]?.query).toContain('current._key == @key && current.scopeKey == @scopeKey');
    expect(calls[0]?.query).toContain('current._internalDeletion');
    expect(calls[0]?.query).toContain('DOCUMENT(folders, @destinationKey)');
    expect(calls[0]?.query).toContain('REPLACE current WITH UNSET');
    expect(calls[0]?.bindVars).toMatchObject({ key: folderKey, scopeKey, unset: ['parentFolderKey', 'description', 'coverImageKey'], patch: { embedding, deletedAt: null, updatedAt: timestamp } });
    expect(calls[0]?.bindVars).not.toHaveProperty('changesLocation');
    expect(() => createContentPersistence(executor).updateFolder(scopeKey, folderKey, { name: 'Renamed' })).toThrow('Folder semantic updates require a fresh embedding.');
  });

  test('returns false when a scope-bounded delete matches nothing', async () => {
    const executor: ContentQueryExecutor = { async query() { return { async next() { return undefined; } }; } };
    expect(await createContentPersistence(executor).deleteDocument(scopeKey, folderKey)).toBe(false);
  });

  test('binds a null folder for root document inserts', async () => {
    let bindVars: Record<string, unknown> | undefined;
    const executor: ContentQueryExecutor = {
      async query(_query, values) {
        bindVars = values;
        return { async next() { return values?.document; } };
      },
    };
    const documentKey = 'cm00000000000000000000003';
    const document = await createContentPersistence(executor).insertDocument({
      key: documentKey,
      scopeKey,
      name: 'Root note',
      html: '<p>Body</p>',
      content: 'Body',
      embedding,
      isFavorite: false,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(document.key).toBe(documentKey);
    expect(bindVars).toMatchObject({ folderKey: null, scopeKey });
  });

  test('canonicalizes HTML and derives content at the document write boundary', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(query, bindVars) {
        calls.push({ query, bindVars });
        return { async next() { return undefined; } };
      },
    };
    await createContentPersistence(executor).updateDocument(scopeKey, folderKey, {
      html: '<p>Hello <strong>Core</strong></p>',
      content: 'Hello Core',
      embedding: Array(EMBEDDING_DIMENSIONS).fill(1),
    });
    expect(calls[0]?.bindVars?.patch).toMatchObject({ html: '<p>Hello <strong>Core</strong></p>', content: 'Hello Core' });
    expect(calls[0]?.bindVars).toMatchObject({ changesLocation: false });
    expect(calls[0]?.query).toContain('current.updatedAt == @expectedUpdatedAt');
    expect(() => createContentPersistence(executor).updateDocument(scopeKey, folderKey, { content: 'detached' })).toThrow('Document content must be updated through HTML.');
    expect(() => createContentPersistence(executor).updateDocument(scopeKey, folderKey, { html: '<p>Detached</p>' })).toThrow('Document HTML updates require a fresh embedding.');
    expect(() => createContentPersistence(executor).updateDocument(scopeKey, folderKey, { html: '<p onclick="bad()">Detached</p>', content: 'Detached', embedding: Array(EMBEDDING_DIMENSIONS).fill(1) })).toThrow('Document representations must be canonical and agreeing.');
  });

  test('persists favorite-only document patches without representation fields', async () => {
    const calls: Array<{ bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = {
      async query(_query, bindVars) {
        calls.push({ bindVars });
        return { async next() { return undefined; } };
      },
    };
    const persistence = createContentPersistence(executor);
    await persistence.updateDocument(scopeKey, folderKey, { isFavorite: true, updatedAt: timestamp });
    expect(calls.map(({ bindVars }) => bindVars?.patch)).toEqual([{ isFavorite: true, updatedAt: timestamp }]);
  });

  test('only the marker owner can unfreeze a pending deletion', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const executor: ContentQueryExecutor = { async query(query, bindVars) { calls.push({ query, bindVars }); return { async next() { return undefined; } }; } };
    await createContentPersistence(executor).setFolderDeletion(scopeKey, folderKey, undefined, 'invocation-owner');
    expect(calls[0]?.query).toContain('current._internalDeletion.owner == @owner');
    expect(calls[0]?.bindVars).toMatchObject({ owner: 'invocation-owner', unset: ['_internalDeletion'] });
  });

  test('guards every Content insert with its folder or document owner', async () => {
    const source = await Bun.file(new URL('./content-persistence.node.ts', import.meta.url)).text();
    expect(source).toContain('Folder destination is pending deletion.');
    expect(source).toContain('Document destination is pending deletion.');
    expect(source).toContain('Share owner is pending deletion.');
    expect(source).toContain('Version owner is pending deletion.');
    expect(source.match(/DOCUMENT\(folders,/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source.match(/DOCUMENT\(documents,/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test('pushes share lifecycle filters into both legacy and global reads', async () => {
    for (const collections of [
      [{ name: 'documentShares' }],
      [{ name: 'documentShares' }, { name: 'shares' }],
    ]) {
      const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
      const executor: ContentQueryExecutor = {
        async query(query, bindVars) {
          calls.push({ query, bindVars });
          if (query.includes('COLLECTIONS()')) return { async next() { return { legacy: true, global: collections.length === 2 }; } };
          if (query.includes('DOCUMENT(shares, @key)')) return { async next() { return collections.length === 2 ? { state: 'global' } : null; } };
          return { async next() { return undefined; } };
        },
      };
      await createContentPersistence(executor).listShares(scopeKey, [folderKey], { includeArchived: true, includeExpired: true, includeRevoked: true, at: timestamp });
      const read = calls.at(-1)!;
      expect(read.query).toContain(collections.length === 2 ? 'FOR share IN shares' : 'FOR share IN documentShares');
      expect(read.query).toContain('@includeArchived');
      expect(read.query).toContain('@includeRevoked');
      expect(read.query).toContain('@includeExpired');
      expect(read.bindVars).toMatchObject({ includeArchived: true, includeExpired: true, includeRevoked: true, at: timestamp });
    }
  });

  test('keeps each dual share mutation in one atomic AQL query', async () => {
    const source = await Bun.file(new URL('./content-persistence.node.ts', import.meta.url)).text();
    expect(source).toContain('INSERT @globalShare INTO shares LET created = NEW INSERT @legacyShare INTO documentShares RETURN created');
    expect(source).toContain('UPDATE global WITH MERGE(@patch');
    expect(source).toContain('UPDATE legacy WITH MERGE(@patch');
    expect(source).toContain('REMOVE global IN shares');
    expect(source).toContain('REMOVE legacy IN documentShares');
    expect(source).not.toContain('Legacy share mirror failed after the durable global write.');
  });

  test('keeps global token revocation authoritative after cutover', async () => {
    const source = await Bun.file(new URL('./document-shares.node.ts', import.meta.url)).text();
    const markerGuard = source.indexOf("marker?.state === 'global'");
    expect(markerGuard).toBeGreaterThan(0);
    expect(markerGuard).toBeLessThan(source.indexOf('FOR share IN ${db.collection(DOCUMENT_SHARES_COLLECTION)}', markerGuard));
  });
});
