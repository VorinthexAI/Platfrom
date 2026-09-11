import { describe, expect, test } from 'bun:test';
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
    expect(query).toContain('collection.mutationPolicy == "system-only" && scoped');
    expect(query).toContain('collection.ownerKey == @actorKey');
    expect(query).not.toContain('collectionMembers');
    expect(query).not.toContain('collaborator');
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
