import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS, currentEmbeddingSchema } from '@/lib/embeddings';
import { createMediaLibraryRepository, searchAccessibleImages, type MediaLibraryDatabase } from './repository';

describe('MediaLibrary repository transactions', () => {
  test('routes surviving place polymorphism without referencing retired trips', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(value) { queries.push(value); return { async all() { return []; } }; } };
    const repository = createMediaLibraryRepository(database, async (operation) => operation(database));
    await repository.createTagAssignment({ key: newId(), scopeKey: newId(), tagKey: newId(), sourceType: 'place', sourceKey: newId(), source: 'user', createdAt: '2026-08-08T12:00:00.000Z' }, newId());
    await repository.getActiveGlobalShareByTokenHash('a'.repeat(64), '2026-08-08T12:00:00.000Z');
    expect(queries.join('\n')).toContain('DOCUMENT(places');
    expect(queries.join('\n')).not.toContain('DOCUMENT(trips');
    expect(queries.join('\n')).not.toContain('"trip"');
  });
  test('requires existing source-image access in the add query', async () => {
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return []; } }; } };
    const repository = createMediaLibraryRepository(database, async (operation) => operation(database));
    await expect(repository.addImageToCollection({ key: newId(), scopeKey: newId(), collectionKey: newId(), imageKey: newId(), addedByKey: newId(), createdAt: '2026-08-08T12:00:00.000Z' })).rejects.toThrow('Source image access');
    expect(query).toContain('LET sourceAccess =');
    expect(query).toContain('scoped || elevated');
    expect(query).not.toContain('image.ownerKey');
    expect(query).toContain('actor != null && sourceAccess');
  });

  test('requires write-level scope access to share standalone images', async () => {
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return []; } }; } };
    const repository = createMediaLibraryRepository(database, async (operation) => operation(database));
    await repository.ownsImage(newId(), newId(), newId());
    expect(query).toContain('LET writable = scopedRole IN ["owner", "admin", "moderator"]');
    expect(query).toContain('FILTER writable || elevated');
    expect(query).not.toContain('FILTER scoped || elevated');
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

describe('MediaLibrary image similarity search', () => {
  test('enforces Gallery access and returns descending cosine matches', async () => {
    const organizationKey = newId(), scopeKey = newId(), actorKey = newId(), collectionKey = newId(), imageKey = newId();
    const embedding = currentEmbeddingSchema.parse(Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25));
    const now = '2026-08-11T12:00:00.000Z';
    let query = '';
    let bindVars: Record<string, unknown> = {};
    const database: MediaLibraryDatabase = {
      async query(value, variables) {
        query = value;
        bindVars = variables ?? {};
        return { async all() { return [{ image: { _key: imageKey, scopeKey, filename: 'image.jpg', caption: 'Caption', storageKey: 'private/image.jpg', mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding, isFavorite: false, createdAt: now, updatedAt: now }, score: 0.9 }]; } };
      },
    };

    const results = await searchAccessibleImages({ organizationKey, scopeKey, actorKey, collectionKey, embedding, limit: 50 }, database);
    expect(query).toContain('actorMembership.status == "active"');
    expect(query).toContain('actorMembership.organizationId == @organizationKey');
    expect(query).toContain('actorScope.organizationKey == @organizationKey');
    expect(query).toContain('FILTER privileged || (image.createdByKey == @actorKey && relationCount == 0) || collectionAccess');
    expect(query).toContain('collectionImage.collectionKey == @collectionKey');
    expect(query).toContain('LENGTH(image.embedding) == @dimensions');
    expect(query).toContain('COSINE_SIMILARITY(image.embedding, @embedding)');
    expect(query).toContain('FILTER @threshold == null || score >= @threshold');
    expect(query).toContain('SORT score DESC, image._key ASC');
    expect(query).toContain('LIMIT @limit');
    expect(bindVars).toMatchObject({ organizationKey, scopeKey, actorKey, collectionKey, dimensions: EMBEDDING_DIMENSIONS, threshold: null, limit: 50 });
    expect(results).toEqual([{ image: expect.objectContaining({ key: imageKey, filename: 'image.jpg' }), score: 0.9 }]);
    expect(results[0]?.image).not.toHaveProperty('_key');
  });

  test('binds an explicit threshold without interpolating it into AQL', async () => {
    let bindVars: Record<string, unknown> = {};
    const database: MediaLibraryDatabase = { async query(_query, variables) { bindVars = variables ?? {}; return { async all() { return []; } }; } };
    await searchAccessibleImages({ organizationKey: newId(), scopeKey: newId(), actorKey: newId(), embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0), threshold: 0.97, limit: 10 }, database);
    expect(bindVars).toMatchObject({ threshold: 0.97, limit: 10 });
  });
});
