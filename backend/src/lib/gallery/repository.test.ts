import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createGalleryRepository } from './repository';
import type { MediaLibraryDatabase } from '@/lib/media-library';

describe('Gallery repository transactions', () => {
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

  test('keeps operation persistence behind the repository boundary', async () => {
    const source = await Bun.file(new URL('./operations.ts', import.meta.url)).text();
    expect(source).not.toMatch(/\bdb\.query\b|\bwithTransaction\b|\btoArangoDoc\b/);
  });
});
