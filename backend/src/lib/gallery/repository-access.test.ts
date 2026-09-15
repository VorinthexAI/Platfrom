import { describe, expect, test } from 'bun:test';
import { CONTRIBUTABLE_MANAGED_COLLECTION_PURPOSES, READABLE_MANAGED_COLLECTION_PURPOSES } from '@/lib/db/collections.node';
import { newId } from '@/lib/ids';
import { createGalleryRepository } from './repository';

describe('Gallery repository collection access', () => {
  test('authorizes user collections by owner key while preserving manager and system-viewer access', async () => {
    let query = '';
    const database = {
      async query(value: string) {
        query = value;
        return { async all() { return []; } };
      },
    };

    const repository = createGalleryRepository(database as never);
    await expect(repository.getCollectionRole(newId(), newId(), newId())).resolves.toBeNull();

    expect(query).toContain('membership.status == "active"');
    expect(query).toContain('membership.teamKey == scope.teamKey');
    expect(query).toContain('membership.teamRole IN ["owner", "admin"] || scopeRole IN ["owner", "admin", "moderator"]');
    expect(query).toContain('collection.purpose IN ["email-media","generated-media","place-media","scope-directory"]');
    expect(query).toContain('collection.mutationPolicy == "system-only" && scoped');
    expect(query).toContain('collection.ownerKey == @actorKey');
    expect(query).not.toContain('collectionMembers');
    expect(query).not.toContain('collaborator');
  });

  test('separates approved managed contribution from container management', async () => {
    let query = '';
    const database = { async query(value: string) { query = value; return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database as never);

    await expect(repository.canContributeToCollection(newId(), newId(), newId())).resolves.toBe(false);
    expect(query).toContain('collection.purpose IN ["email-media","generated-media","place-media"]');
    expect(query).toContain('collection.mutationPolicy == "system-only" ?');
    expect(query).not.toContain('scope-directory');
  });

  test('keeps every contributable managed purpose readable while scope-directory remains read-only', async () => {
    expect(CONTRIBUTABLE_MANAGED_COLLECTION_PURPOSES).toEqual(['email-media', 'generated-media', 'place-media']);
    expect(READABLE_MANAGED_COLLECTION_PURPOSES).toEqual(['email-media', 'generated-media', 'place-media', 'scope-directory']);

    const queries: string[] = [];
    const database = { async query(value: string) { queries.push(value); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database as never);
    const scopeKey = newId(), actorKey = newId();
    await repository.getCollectionRole(scopeKey, newId(), actorKey);
    await repository.listOverview({ scopeKey, actorKey, limit: 10 });
    await repository.searchAccessibleCollections({ scopeKey, actorKey, embedding: [], minimumScore: 0, limit: 10 });

    const readablePolicy = 'collection.purpose IN ["email-media","generated-media","place-media","scope-directory"]';
    expect(queries).toHaveLength(4);
    for (const query of queries) expect(query).toContain(readablePolicy);
  });

  test('keeps approved managed upload queue and finalization actor-owned and rejects system children', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const queue = source.slice(source.indexOf('    queueUploads(input)'), source.indexOf('    claimUploads(', source.indexOf('    queueUploads(input)')));
    const finalize = source.slice(source.indexOf('    finalizeUpload('), source.indexOf('    compensateUpload(', source.indexOf('    finalizeUpload(')));
    const canFinalize = source.slice(source.indexOf('    async canFinalizeUpload('), source.indexOf('    searchAccessibleImages:', source.indexOf('    async canFinalizeUpload(')));
    for (const policy of [queue, finalize, canFinalize]) {
      expect(policy).toContain('collection.purpose IN ${CONTRIBUTABLE_MANAGED_COLLECTION_PURPOSES}');
      expect(policy).not.toContain('scope-directory');
    }
    expect(finalize).toContain('image.createdByKey == @actorKey && image.mutationPolicy != "system-only"');
  });

  test('limits managed highlight and memory flows to actor-owned mutable artifacts', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const intelligence = source.slice(source.indexOf('    async listHighlightCandidates('));
    expect(intelligence).toContain('image.createdByKey == @actorKey && image.mutationPolicy != "system-only"');
    expect(intelligence).toContain('highlight.createdByKey == @actorKey');
    expect(intelligence).toContain('memory.createdByKey == @actorKey');
    expect(intelligence).toContain('collection.purpose IN ${CONTRIBUTABLE_MANAGED_COLLECTION_PURPOSES}');
  });

  test('authorizes favorite separately for readable managed and system images', async () => {
    const queries: string[] = [];
    const database = { async query(query: string) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database as never);

    await repository.canFavoriteImage(newId(), newId(), newId());
    await repository.setImageFavorite(newId(), newId(), newId(), true, new Date().toISOString());

    for (const query of queries) {
      expect(query).toContain('collection.purpose IN ["email-media","generated-media","place-media","scope-directory"]');
      expect(query).toContain('readableManaged');
      expect(query).not.toContain('image.mutationPolicy != "system-only" FILTER');
    }
    expect(queries[0]).toContain('FILTER elevated || readableManaged || mutable');
    expect(queries[1]).toContain('FILTER elevated || readableManaged || mutable UPDATE image');
  });

  test('clears scope cover references inside both image deletion transactions', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const duplicateDeletion = source.slice(source.indexOf('    deleteDuplicateImages(scopeKey'), source.indexOf('    deleteImages(scopeKey'));
    const directDeletion = source.slice(source.indexOf('    deleteImages(scopeKey'), source.indexOf('    transferCollectionImages(input'));
    for (const deletion of [duplicateDeletion, directDeletion]) {
      expect(deletion).toContain('"scopes"');
      expect(deletion).toContain('scope.coverImageKey IN @imageKeys');
      expect(deletion.indexOf('scope.coverImageKey IN @imageKeys')).toBeLessThan(deletion.lastIndexOf('REMOVE image IN images'));
    }
  });

  test('attaches conversation media only through the exact managed uploaded-image boundary', async () => {
    const queries: string[] = [];
    const database = { async query(query: string) { queries.push(query); return { async all() { return query.includes('RETURN { elevated:') ? [{ elevated: true, memberScopes: [], relations: [] }] : [newId()]; } }; } };
    const repository = createGalleryRepository(database as never, async (_collections, operation) => operation(database as never));
    await expect(repository.attachConversationMedia(newId(), newId(), [newId()], newId(), new Date().toISOString())).resolves.toBe(true);
    const attachment = queries.find((query) => query.includes('image.origin == "uploaded"')) ?? '';
    expect(attachment).toContain('collection.purpose == "generated-media"');
    expect(attachment).toContain('collection.mutationPolicy == "system-only"');
    expect(attachment).toContain('image.mutationPolicy == "user"');
    expect(attachment).toContain('image.createdByKey == @actorKey');
  });

  test('declares only the bind variables used by each upload queue query', async () => {
    const now = new Date().toISOString();
    const uploadKey = newId();
    const input = { uploadKeys: [uploadKey], teamKey: 'team', scopeKey: newId(), actorKey: newId(), now };
    const upload = {
      _key: uploadKey,
      teamKey: input.teamKey,
      scopeKey: input.scopeKey,
      actorKey: input.actorKey,
      imageKey: newId(),
      collectionKey: null,
      filename: 'cover.png',
      mimeType: 'image/png',
      sizeBytes: 8,
      storageKey: `pending/gallery/${uploadKey}.png`,
      processingMode: 'cover',
      status: 'reserved',
      processingLeaseId: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const calls: Array<Record<string, unknown>> = [];
    const database = {
      async query(_query: string, bindVars: Record<string, unknown>) {
        calls.push(bindVars);
        return { async all() { return [{ ...upload, status: calls.length === 1 ? 'reserved' : 'queued' }]; } };
      },
    };
    const repository = createGalleryRepository(database as never, async (_collections, operation) => operation(database as never));

    await expect(repository.queueUploads(input)).resolves.toHaveLength(1);
    expect(Object.keys(calls[0]!).sort()).toEqual(['actorKey', 'now', 'scopeKey', 'teamKey', 'uploadKeys']);
    expect(calls[1]).toEqual({ uploadKeys: [uploadKey], now });
  });

  test('fails expired reservations and durably queues their storage keys for cleanup', async () => {
    const now = new Date().toISOString();
    const storageKey = 'pending/gallery/expired.png';
    const queries: string[] = [];
    const database = {
      async query(query: string) {
        queries.push(query);
        return { async all() {
          if (query.includes('upload.status == "reserved"')) return [true];
          return [];
        } };
      },
    };
    const repository = createGalleryRepository(database as never, async (_collections, operation) => operation(database as never));

    await expect(repository.recoverUploadQueue(now, now)).resolves.toEqual({ uploads: [], storageKeys: [] });
    const expiration = queries.find((query) => query.includes('upload.status == "reserved"')) ?? '';
    expect(expiration).toContain('UPSERT { storageKey: upload.storageKey }');
    expect(expiration).toContain('errorCode: "UPLOAD_RESERVATION_EXPIRED"');
  });
});
