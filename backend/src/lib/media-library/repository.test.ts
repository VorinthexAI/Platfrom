import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createMediaLibraryRepository, type MediaLibraryDatabase } from './repository';

describe('MediaLibrary repository transactions', () => {
  test('requires existing source-image access in the add query', async () => {
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return []; } }; } };
    const repository = createMediaLibraryRepository(database, async (operation) => operation(database));
    await expect(repository.addImageToCollection({ key: newId(), scopeKey: newId(), collectionKey: newId(), imageKey: newId(), addedByKey: newId(), createdAt: '2026-08-08T12:00:00.000Z' })).rejects.toThrow('Source image access');
    expect(query).toContain('LET sourceAccess =');
    expect(query).toContain('image.ownerKey == @addedByKey');
    expect(query).toContain('sourceCollection.deletedAt == null');
    expect(query).toContain('actor != null && sourceAccess');
  });

  test('clears a source cover in the same transaction when moving its image', async () => {
    const scopeKey = newId(), sourceCollectionKey = newId(), collectionKey = newId(), imageKey = newId(), actorKey = newId(), relationKey = newId();
    const now = '2026-08-08T12:00:00.000Z';
    const queries: string[] = [];
    const transaction: MediaLibraryDatabase = {
      async query(query) {
        queries.push(query);
        if (query.includes('LET current = FIRST')) return { async all() { return [{ _key: relationKey }]; } };
        if (query.includes('UPSERT { scopeKey: @scopeKey')) return { async all() { return [{ _key: relationKey, scopeKey, collectionKey, imageKey, addedByKey: actorKey, createdAt: now }]; } };
        return { async all() { return []; } };
      },
    };
    const repository = createMediaLibraryRepository(transaction, async (operation) => operation(transaction));
    await repository.moveImageBetweenCollections(sourceCollectionKey, { key: relationKey, scopeKey, collectionKey, imageKey, addedByKey: actorKey, createdAt: now });
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    const coverQuery = queries.find((query) => query.includes('collection.coverImageKey == @imageKey'));
    expect(coverQuery).toContain('UPDATE collection WITH { coverImageKey: null');
    expect(coverQuery).toContain('OPTIONS { keepNull: false }');
  });
});
