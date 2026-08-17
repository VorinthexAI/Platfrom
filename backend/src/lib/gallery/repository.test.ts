import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createGalleryRepository } from './repository';
import type { MediaLibraryDatabase } from '@/lib/media-library';

describe('Gallery repository transactions', () => {
  test('returns collection images as bound keyset cursor pages of at most one hundred', async () => {
    const scopeKey = newId(), collectionKey = newId();
    const rows = ['2026-08-17T12:00:03.000Z', '2026-08-17T12:00:02.000Z', '2026-08-17T12:00:01.000Z'].map((createdAt, index) => ({
      _key: newId(), scopeKey, filename: `${index}.jpg`, caption: `Image ${index}`, imageCaptionKey: null, storageKey: `media/${index}`, mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding: Array(4_096).fill(0), isFavorite: false, deletedAt: null, createdAt, updatedAt: createdAt,
    }));
    const imageBinds: Record<string, unknown>[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (query.includes('FOR collection IN collections')) return [];
      imageBinds.push(bindVars ?? {});
      return rows;
    } }; } };
    const repository = createGalleryRepository(database);
    const first = await repository.listOverview({ scopeKey, collectionKey, limit: 2 });
    expect(first.images.items.map(({ key }) => key)).toEqual(rows.slice(0, 2).map(({ _key }) => _key));
    expect(first.images.nextCursor).toBeString();
    await repository.listOverview({ scopeKey, collectionKey, limit: 2, cursor: first.images.nextCursor! });
    expect(imageBinds[1]).toMatchObject({ afterCreatedAt: rows[1]!.createdAt, afterImageKey: rows[1]!._key, queryLimit: 3 });
    await expect(repository.listOverview({ scopeKey, collectionKey: newId(), limit: 2, cursor: first.images.nextCursor! })).rejects.toThrow('Cursor does not belong');
  });

  test('rejects duplicate deletion when the protected duplicate set changes', async () => {
    const database: MediaLibraryDatabase = { async query() { return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const result = await repository.deleteDuplicateImages(newId(), newId(), [newId()], '2026-08-13T12:00:00.000Z');
    expect(result).toBeNull();
  });

  test('returns a selection conflict before writing collection transfers', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const result = await repository.transferCollectionImages({ scopeKey: newId(), actorKey: newId(), sourceCollectionKey: newId(), destinationCollectionKeys: [newId()], imageKeys: [newId()], mode: 'move', now: '2026-08-13T12:00:00.000Z' });
    expect(result).toEqual({ status: 'selection-changed' });
    expect(queries).toHaveLength(1);
  });

  test('copies every selected image to every destination in one transaction', async () => {
    const imageKeys = [newId(), newId()], destinationCollectionKeys = [newId(), newId()];
    const queries: string[] = [];
    const queryBindVars: Record<string, unknown>[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars) {
      queries.push(query);
      queryBindVars.push(bindVars ?? {});
      return { async all() {
        if (query.includes('LET relation = FIRST')) return imageKeys;
        if (query.includes('LET member = FIRST')) return destinationCollectionKeys;
        if (query.includes('UPSERT')) return [true];
        return [];
      } };
    } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const result = await repository.transferCollectionImages({ scopeKey: newId(), actorKey: newId(), sourceCollectionKey: newId(), destinationCollectionKeys, imageKeys, mode: 'copy', now: '2026-08-13T12:00:00.000Z' });
    expect(result).toEqual({ status: 'ok', createdRelationCount: 4 });
    expect(queries.filter((query) => query.includes('UPSERT'))).toHaveLength(4);
    expect(queryBindVars[0]).toEqual({ imageKeys, scopeKey: expect.any(String), sourceCollectionKey: expect.any(String) });
  });

  test('soft deletes images and removes dependent collection and subject links atomically', async () => {
    const imageKeys = [newId(), newId()];
    const queries: string[] = [];
    let transactionCollections: unknown;
    const database: MediaLibraryDatabase = { async query(query, bindVars) {
      queries.push(query);
      return { async all() { return query.includes('LET image = DOCUMENT') ? imageKeys : []; } };
    } };
    const repository = createGalleryRepository(database, async (collections, operation) => { transactionCollections = collections; return operation(database); });
    await expect(repository.deleteImages(newId(), imageKeys, '2026-08-13T12:00:00.000Z')).resolves.toEqual({ deletedImageKeys: imageKeys });
    expect(transactionCollections).toEqual({ read: ['images'], write: ['images', 'collectionImages', 'collections', 'imageIdentities', 'visualIdentities'] });
    expect(queries).toHaveLength(6);
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE relation IN imageIdentities'))).toBe(true);
    expect(queries.some((query) => query.includes('LET replacement = FIRST') && query.includes('referenceImageKey: replacement'))).toBe(true);
    expect(queries.some((query) => query.includes('UPDATE image WITH { deletedAt: @now'))).toBe(true);
  });

  test('keeps operation persistence behind the repository boundary', async () => {
    const source = await Bun.file(new URL('./operations.ts', import.meta.url)).text();
    expect(source).not.toMatch(/\bdb\.query\b|\bwithTransaction\b|\btoArangoDoc\b/);
  });
});
