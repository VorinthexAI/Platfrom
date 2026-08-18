import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createGalleryRepository } from './repository';
import type { MediaLibraryDatabase } from '@/lib/media-library';
import { collectionInviteSchema } from '@/lib/db/collection-invites.node';
import { shareSchema } from '@/lib/db/shares.node';

describe('Gallery repository transactions', () => {
  test('accepts an invite with separate valid transaction queries and returns the upserted membership', async () => {
    const scopeKey = newId(), collectionKey = newId(), inviteKey = newId(), actorKey = newId(), memberKey = newId(), ownerKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const invite = { _key: inviteKey, scopeKey, collectionKey, invitedByKey: ownerKey, inviteeKey: actorKey, role: 'viewer', tokenHash: 'a'.repeat(64), createdAt: now, updatedAt: now };
    const membership = { _key: memberKey, scopeKey, collectionKey, memberKey: actorKey, role: 'viewer', createdAt: now };
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); const index = queries.length; return { async all() { return index === 1 ? [invite] : index === 2 ? [membership] : [true]; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.acceptCollectionInvite(scopeKey, inviteKey, actorKey, memberKey, now)).resolves.toMatchObject({ memberKey: actorKey, role: 'viewer' });
    expect(queries).toHaveLength(3);
    expect(queries[0]).toContain('recipientMembership.organizationId == scope.organizationKey');
    expect(queries[0]).toContain('owner.role == "owner"');
    expect(queries[1]).toContain('UPSERT');
    expect(queries[1]).toContain('@requestedRole');
    expect(queries[2]).toContain('acceptedAt: @now');
    expect(queries[1]).not.toContain('UPDATE invite');
  });

  test('guards every owner-managed collaboration write inside its AQL query', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database);
    const scopeKey = newId(), collectionKey = newId(), ownerKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const invite = collectionInviteSchema.parse({ key: newId(), scopeKey, collectionKey, invitedByKey: ownerKey, inviteeKey: newId(), role: 'viewer', tokenHash: 'a'.repeat(64), createdAt: now, updatedAt: now });
    const share = shareSchema.parse({ key: newId(), scopeKey, sourceType: 'collection', sourceKey: collectionKey, permission: 'viewer', tokenHash: 'b'.repeat(64), createdAt: now, updatedAt: now });
    await repository.createCollectionInvite(invite, { requestHash: 'hash', responseCiphertext: 'ciphertext' });
    await repository.revokeCollectionInvite(scopeKey, collectionKey, invite.key, ownerKey, now);
    await repository.updateCollectionMemberRole(scopeKey, collectionKey, newId(), 'viewer', ownerKey);
    await repository.removeCollectionMember(scopeKey, collectionKey, newId(), ownerKey);
    await repository.listCollectionShares(scopeKey, collectionKey, ownerKey);
    await repository.createCollectionShare(share, ownerKey, { requestHash: 'hash', responseCiphertext: 'v1:encrypted:token:value' });
    await repository.setCollectionShareActive(scopeKey, collectionKey, share.key, ownerKey, false, now);
    expect(queries.find((query) => query.includes('IN collectionInvites'))).toContain('UPSERT');
    expect(queries.find((query) => query.includes('IN shares') && query.includes('@shareKey'))).toContain('UPSERT');
    for (const query of queries) {
      expect(query).toContain('collection.deletedAt == null');
      expect(query).toContain('member.role == "owner"');
      expect(query).toContain('@ownerKey');
      expect(query).toContain('actor.status == "active"');
      expect(query).toContain('scope.deletedAt == null');
    }
  });

  test('activates only live collection shares and never demotes stronger memberships', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), memberKey = newId(), now = '2026-08-18T12:00:00.000Z';
    let query = '', binds: Record<string, unknown> = {};
    const row = { _key: memberKey, scopeKey, collectionKey, memberKey: actorKey, role: 'collaborator', createdAt: now };
    const database: MediaLibraryDatabase = { async query(value, variables) { query = value; binds = variables ?? {}; return { async all() { return [row]; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.activateCollectionShare(scopeKey, 'a'.repeat(64), actorKey, memberKey, now)).resolves.toMatchObject({ role: 'collaborator', collectionKey });
    expect(query).toContain('share.revokedAt == null');
    expect(query).toContain('share.scopeKey == @scopeKey');
    expect(query).toContain('share.expiresAt > @now');
    expect(query).toContain('OLD.role == "owner" || OLD.role == "collaborator"');
    expect(binds).toMatchObject({ scopeKey, tokenHash: 'a'.repeat(64), actorKey, memberKey, now });
  });

  test('rechecks owner-any-image and collaborator-own-image authority in image writes', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database);
    await repository.setImageFavorite(newId(), newId(), newId(), true, '2026-08-18T12:00:00.000Z');
    await repository.updateImageDetails(newId(), newId(), newId(), 'photo.jpg', false, Array(4_096).fill(0), '2026-08-18T12:00:00.000Z');
    for (const query of queries) {
      expect(query).toContain('"owner" IN roles');
      expect(query).toContain('image.createdByKey == @actorKey');
      expect(query).toContain('"collaborator" IN roles');
      expect(query).toContain('UPDATE image');
    }
  });

  test('encodes the owner, collaborator, and viewer mutation matrix without post-membership creator access', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database);
    await repository.canMutateImage(newId(), newId(), newId());
    const query = queries[0]!;
    expect(query).toContain('"owner" IN roles');
    expect(query).toContain('"collaborator" IN roles');
    expect(query).not.toContain('"viewer" IN roles');
    expect(query).toContain('relationCount == 0');
    expect(query).toContain('image.createdByKey == @actorKey');
  });

  test('actor-filters overview collections and images while preserving elevated scope administrators', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    await createGalleryRepository(database).listOverview({ scopeKey: newId(), actorKey: newId(), limit: 10 });
    expect(queries[0]).toContain('item.memberKey == @actorKey');
    expect(queries[0]).toContain('scopeRole IN ["owner", "admin"]');
    expect(queries[1]).toContain('LENGTH(accessibleCollections) > 0');
    expect(queries[1]).toContain('image.createdByKey == @actorKey && relationCount == 0');
  });

  test('returns only an authorized live visual identity in the requested scope', async () => {
    const scopeKey = newId(), identityKey = newId(), actorKey = newId();
    const identity = { _key: identityKey, scopeKey, name: 'Alex', description: 'A person.', referenceImageKey: newId(), embedding: Array(4_096).fill(0), deletedAt: null, createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z' };
    let authorized = false;
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (query.includes('LET actorMembership')) return authorized ? [true] : [];
      expect(bindVars).toEqual({ scopeKey, identityKey });
      expect(query).toContain('identity.deletedAt == null');
      return [identity];
    } }; } };
    const repository = createGalleryRepository(database);
    expect(await repository.getVisualIdentity(scopeKey, identityKey, actorKey)).toBeNull();
    authorized = true;
    expect(await repository.getVisualIdentity(scopeKey, identityKey, actorKey)).toMatchObject({ key: identityKey, scopeKey, deletedAt: null });
  });

  test('returns collection images as bound keyset cursor pages of at most one hundred', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId();
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
    const first = await repository.listOverview({ scopeKey, actorKey, collectionKey, limit: 2 });
    expect(first.images.items.map(({ key }) => key)).toEqual(rows.slice(0, 2).map(({ _key }) => _key));
    expect(first.images.nextCursor).toBeString();
    await repository.listOverview({ scopeKey, actorKey, collectionKey, limit: 2, cursor: first.images.nextCursor! });
    expect(imageBinds[1]).toMatchObject({ afterCreatedAt: rows[1]!.createdAt, afterImageKey: rows[1]!._key, queryLimit: 3 });
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey: newId(), limit: 2, cursor: first.images.nextCursor! })).rejects.toThrow('Cursor does not belong');
  });

  test('lists persisted visual identity matches within an optional collection', async () => {
    const scopeKey = newId(), identityKey = newId(), collectionKey = newId(), imageKey = newId();
    const image = { _key: imageKey, scopeKey, filename: 'reference.jpg', caption: 'Reference', imageCaptionKey: null, storageKey: 'media/reference', mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding: Array(4_096).fill(0), isFavorite: false, deletedAt: null, createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z' };
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      expect(query).toContain('collectionImage.collectionKey == @collectionKey');
      expect(bindVars).toEqual({ scopeKey, identityKey, collectionKey });
      return [{ image, confidence: 1 }];
    } }; } };
    await expect(createGalleryRepository(database).listSubjectImages(scopeKey, identityKey, collectionKey)).resolves.toEqual([{ image: expect.objectContaining({ key: imageKey }), confidence: 1 }]);
  });

  test('rejects duplicate deletion when the protected duplicate set changes', async () => {
    const database: MediaLibraryDatabase = { async query() { return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const result = await repository.deleteDuplicateImages(newId(), newId(), [newId()], newId(), '2026-08-13T12:00:00.000Z');
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
    expect(queryBindVars[0]).toEqual({ imageKeys, scopeKey: expect.any(String), sourceCollectionKey: expect.any(String), actorKey: expect.any(String) });
    for (const query of queries.slice(0, 2)) {
      expect(query).toContain('actor.status == "active"');
      expect(query).toContain('actor.organizationId == scope.organizationKey');
      expect(query).toContain('scope.deletedAt == null');
      expect(query).toContain('actor.orgRole IN ["owner", "admin"]');
      expect(query).toContain('scopeRole IN ["owner", "admin"]');
    }
    expect(queries[0]).toContain('member.role == "owner"');
    expect(queries[0]).toContain('image.createdByKey == @actorKey');
    expect(queries[1]).toContain('member.role IN ["owner", "collaborator", "member"]');
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
    await expect(repository.deleteImages(newId(), imageKeys, newId(), '2026-08-13T12:00:00.000Z')).resolves.toEqual({ deletedImageKeys: imageKeys });
    expect(transactionCollections).toEqual({ read: ['images', 'userOrganizations', 'scopes', 'scopeMembers', 'collectionMembers'], write: ['images', 'collectionImages', 'collections', 'imageIdentities', 'visualIdentities'] });
    expect(queries).toHaveLength(6);
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE relation IN imageIdentities'))).toBe(true);
    expect(queries.some((query) => query.includes('LET replacement = FIRST') && query.includes('referenceImageKey: replacement'))).toBe(true);
    expect(queries.some((query) => query.includes('UPDATE image WITH { deletedAt: @now'))).toBe(true);
  });

  test('atomically fails an upload and compensates its persisted image', async () => {
    const uploadKey = newId(), scopeKey = newId(), imageKey = newId();
    const queries: string[] = [];
    let transactionCollections: unknown;
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('FOR upload IN galleryUploads') ? [imageKey] : []; } }; } };
    const repository = createGalleryRepository(database, async (collections, operation) => { transactionCollections = collections; return operation(database); });
    await expect(repository.failUpload(uploadKey, scopeKey, 'IMAGE_PROCESSING_FAILED', '2026-08-17T12:00:00.000Z')).resolves.toBe(true);
    expect(transactionCollections).toEqual({ read: ['images'], write: ['galleryUploads', 'images', 'collectionImages', 'collections', 'imageIdentities', 'visualIdentities'] });
    expect(queries.some((query) => query.includes('status: "failed"'))).toBe(true);
    expect(queries[0]).toContain('upload.status != "completed"');
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    expect(queries.some((query) => query.includes('UPDATE image WITH { deletedAt: @now'))).toBe(true);
  });

  test('does not compensate an upload that completed before failure handling', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.failUpload(newId(), newId(), 'IMAGE_PROCESSING_FAILED', '2026-08-17T12:00:00.000Z')).resolves.toBe(false);
    expect(queries).toHaveLength(1);
  });

  test('keeps operation persistence behind the repository boundary', async () => {
    const source = await Bun.file(new URL('./operations.ts', import.meta.url)).text();
    expect(source).not.toMatch(/\bdb\.query\b|\bwithTransaction\b|\btoArangoDoc\b/);
  });
});
