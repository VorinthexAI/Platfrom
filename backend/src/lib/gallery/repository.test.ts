import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createGalleryRepository, isCaptionScoreEligibleForGalleryCleanup } from './repository';
import type { MediaLibraryDatabase } from '@/lib/media-library';
import { collectionInviteSchema } from '@/lib/db/collection-invites.node';
import { shareSchema } from '@/lib/db/shares.node';
import { galleryUploadSchema } from '@/lib/db/gallery-uploads.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';

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
      expect(query).toContain('member.role == "owner"');
      expect(query).toContain('@ownerKey');
      expect(query).toContain('actor.status == "active"');
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
    await repository.updateImageDetails(newId(), newId(), newId(), 'photo.jpg', false, Array(EMBEDDING_DIMENSIONS).fill(0), '2026-08-18T12:00:00.000Z');
    for (const query of queries) {
      expect(query).toContain('"owner" IN roles');
      expect(query).toContain('image.createdByKey == @actorKey');
      expect(query).toContain('"collaborator" IN roles');
      expect(query).toContain('UPDATE image');
    }
  });

  test('atomically authorizes collection updates and validates custom cover membership', async () => {
    const queries: string[] = [];
    const binds: Record<string, unknown>[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars) { queries.push(query); binds.push(bindVars ?? {}); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database);
    const coverImageKey = newId();
    await repository.updateCollectionDetails(newId(), newId(), newId(), 'Summer', false, coverImageKey, Array(EMBEDDING_DIMENSIONS).fill(0), '2026-08-18T12:00:00.000Z');
    await repository.updateCollectionDetails(newId(), newId(), newId(), 'Summer', false, null, Array(EMBEDDING_DIMENSIONS).fill(0), '2026-08-18T12:00:00.000Z');
    await repository.updateCollectionDetails(newId(), newId(), newId(), 'Summer', false, undefined, Array(EMBEDDING_DIMENSIONS).fill(0), '2026-08-18T12:00:00.000Z');
    const query = queries[0]!;
    expect(query).toContain('actor.status == "active"');
    expect(query).toContain('actor.orgRole IN ["owner", "admin"]');
    expect(query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(query).toContain('owner != null');
    expect(query).toContain('related != null');
    expect(query).toContain('cover.scopeKey == @scopeKey');
    expect(query).toContain('relation.collectionKey == @collectionKey');
    expect(query).toContain('OPTIONS { keepNull: false }');
    expect(binds[0]).toMatchObject({ coverImageKey, setCover: true });
    expect(binds[1]).toMatchObject({ coverImageKey: null, setCover: true });
    expect(binds[2]).toMatchObject({ coverImageKey: null, setCover: false });
  });

  test('guards collection create/delete and subject writes at write time', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    for (const marker of ['createCollection(collection, member)', 'deleteCollection(scopeKey, collectionKey, actorKey', 'createSubject(identity, relations, referenceImageKeys, actorKey)', 'deleteSubject(scopeKey, identityKey, actorKey']) {
      const section = source.slice(source.indexOf(marker), source.indexOf(marker) + 2_500);
      expect(section).toContain('actor.status ==');
      expect(section).toContain('actor.orgRole IN');
      expect(section).toMatch(/scope(?:Member|Role).*IN/);
    }
    expect(source).toContain('RETURN { isFavorite: collection.isFavorite == true, formerUserKeys }');
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
    expect(queries[0]).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(queries[0]).toContain('explicitOwnerCount == 0');
    expect(queries[0]).toContain('member.role == "owner"');
    expect(queries[0]).toContain('isOwned');
    expect(queries[0]).toContain('SORT relation.createdAt ASC, relation._key ASC');
    expect(queries[1]).toContain('LENGTH(accessibleCollections) > 0');
    expect(queries[1]).toContain('image.createdByKey == @actorKey && relationCount == 0');
  });

  test('projects explicit ownership independently from elevated effective access', async () => {
    const scopeKey = newId(), actorKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const rows = [true, false].map((isOwned, index) => ({
      collection: { _key: newId(), scopeKey, name: isOwned ? 'Mine' : 'Shared', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now },
      count: 0, cover: null, role: 'owner', isOwned,
    }));
    const database: MediaLibraryDatabase = { async query(query) { return { async all() { return query.includes('FOR collection IN collections') ? rows : []; } }; } };
    const result = await createGalleryRepository(database).listOverview({ scopeKey, actorKey, limit: 10 });
    expect(result.collections.map(({ role, isOwned }) => ({ role, isOwned }))).toEqual([{ role: 'owner', isOwned: true }, { role: 'owner', isOwned: false }]);
  });

  test('includes active scope moderators in manager-only subject event audiences', async () => {
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return []; } }; } };
    await createGalleryRepository(database).listScopeManagerUserKeys(newId());
    expect(query).toContain('membership.status == "active"');
    expect(query).toContain('member.status == "active"');
    expect(query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
  });

  test('returns only an authorized live visual identity in the requested scope', async () => {
    const scopeKey = newId(), identityKey = newId(), actorKey = newId();
    const identity = { _key: identityKey, scopeKey, createdByKey: actorKey, name: 'Alex', description: 'A person.', referenceImageKey: newId(), embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z' };
    let authorized = false;
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (query.includes('LET actorMembership')) return authorized ? [true] : [];
      expect(bindVars).toEqual({ scopeKey, identityKey, actorKey });
      return [identity];
    } }; } };
    const repository = createGalleryRepository(database);
    expect(await repository.getVisualIdentity(scopeKey, identityKey, actorKey)).toBeNull();
    authorized = true;
    expect(await repository.getVisualIdentity(scopeKey, identityKey, actorKey)).toMatchObject({ key: identityKey, scopeKey });
  });

  test('returns collection images as bound keyset cursor pages of at most one hundred', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId();
    const rows = ['2026-08-17T12:00:03.000Z', '2026-08-17T12:00:02.000Z', '2026-08-17T12:00:01.000Z'].map((createdAt, index) => ({
      _key: newId(), scopeKey, filename: `${index}.jpg`, caption: `Image ${index}`, imageCaptionKey: null, storageKey: `media/${index}`, mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt, updatedAt: createdAt,
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
    expect(JSON.parse(Buffer.from(first.images.nextCursor!, 'base64url').toString('utf8'))).toEqual({ version: 1, scopeKey, collectionKey, createdAt: rows[1]!.createdAt, imageKey: rows[1]!._key });
    await repository.listOverview({ scopeKey, actorKey, collectionKey, limit: 2, cursor: first.images.nextCursor! });
    expect(imageBinds[1]).toMatchObject({ afterCreatedAt: rows[1]!.createdAt, afterImageKey: rows[1]!._key, queryLimit: 3 });
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey: newId(), limit: 2, cursor: first.images.nextCursor! })).rejects.toThrow('Cursor does not belong');
  });

  test('filters caption scores before stable keyset pagination and binds the threshold into cursors', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId();
    const createdAt = '2026-08-17T12:00:00.000Z';
    const rows = [0, 1, 2].map((index) => ({
      _key: newId(), scopeKey, filename: `${index}.jpg`, caption: `Image ${index}`, imageCaptionKey: newId(), storageKey: `media/${index}`, mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt, updatedAt: createdAt,
    }));
    let imageQuery = '', imageBinds: Record<string, unknown> = {};
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (query.includes('FOR collection IN collections')) return [];
      imageQuery = query;
      imageBinds = bindVars ?? {};
      return rows;
    } }; } };
    const repository = createGalleryRepository(database);
    const first = await repository.listOverview({ scopeKey, actorKey, collectionKey, maxCaptionScore: 40, limit: 2 });
    expect(imageQuery).toContain('LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey)');
    expect(imageQuery).toContain('caption.scopeKey == @scopeKey');
    expect(imageQuery).toContain('IS_NUMBER(caption.score) && caption.score >= 1 && caption.score <= 100 && caption.score <= @maxCaptionScore');
    expect(imageQuery).toContain('(caption.scoreVersion == 1 || (caption.scoreVersion == 0 && caption.score > 1))');
    expect(imageQuery.indexOf('LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey)')).toBeGreaterThan(imageQuery.indexOf('FILTER @collectionKey == null ?'));
    expect(imageQuery.indexOf('caption.score <= @maxCaptionScore')).toBeLessThan(imageQuery.indexOf('FILTER @afterCreatedAt'));
    expect(imageQuery).toContain('SORT image.createdAt DESC, image._key ASC LIMIT @queryLimit');
    expect(imageBinds).toMatchObject({ maxCaptionScore: 40, queryLimit: 3 });
    expect(JSON.parse(Buffer.from(first.images.nextCursor!, 'base64url').toString('utf8'))).toMatchObject({ version: 2, maxCaptionScore: 40 });
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey, maxCaptionScore: 40, limit: 2, cursor: first.images.nextCursor! })).resolves.toBeDefined();
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey, maxCaptionScore: 41, limit: 2, cursor: first.images.nextCursor! })).rejects.toThrow('Cursor does not belong');
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey, limit: 2, cursor: first.images.nextCursor! })).rejects.toThrow('Cursor does not belong');
  });

  test('accepts only current scores and real preserved legacy scores for cleanup', () => {
    const scopeKey = newId();
    const eligible = (caption: unknown, maxCaptionScore = 40) => isCaptionScoreEligibleForGalleryCleanup(caption, scopeKey, maxCaptionScore);
    expect([
      eligible({ scopeKey, scoreVersion: 1, score: 1 }, 1),
      eligible({ scopeKey, scoreVersion: 1, score: 40 }),
      eligible({ scopeKey, scoreVersion: 0, score: 2 }),
      eligible({ scopeKey, scoreVersion: 0, score: 40 }),
    ]).toEqual([true, true, true, true]);
    for (const caption of [
      { scopeKey, scoreVersion: 0, score: 1 },
      { scopeKey, scoreVersion: 0, score: 0 },
      { scopeKey, scoreVersion: 1, score: 0 },
      { scopeKey, scoreVersion: 1, score: 101 },
      { scopeKey, scoreVersion: 1, score: 41 },
      { scopeKey, scoreVersion: 2, score: 20 },
      { scopeKey, scoreVersion: 1, score: null },
      { scopeKey, scoreVersion: 1, score: '20' },
      { scopeKey, scoreVersion: 1 },
      { scopeKey: newId(), scoreVersion: 1, score: 20 },
      null,
    ]) expect(eligible(caption)).toBe(false);
  });

  test('accepts legacy overview cursors only for unfiltered requests and omits caption AQL when unfiltered', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), imageKey = newId(), createdAt = '2026-08-17T12:00:00.000Z';
    const cursor = Buffer.from(JSON.stringify({ version: 1, scopeKey, collectionKey, createdAt, imageKey }), 'utf8').toString('base64url');
    let imageQuery = '', imageBinds: Record<string, unknown> = {};
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (query.includes('FOR collection IN collections')) return [];
      imageQuery = query;
      imageBinds = bindVars ?? {};
      return [];
    } }; } };
    const repository = createGalleryRepository(database);
    await repository.listOverview({ scopeKey, actorKey, collectionKey, limit: 2, cursor });
    expect(imageQuery).not.toContain('imageCaptions');
    expect(imageBinds).not.toHaveProperty('maxCaptionScore');
    expect(imageBinds).toMatchObject({ afterCreatedAt: createdAt, afterImageKey: imageKey });
    await expect(repository.listOverview({ scopeKey, actorKey, collectionKey, maxCaptionScore: 40, limit: 2, cursor })).rejects.toThrow('Cursor does not belong');
  });

  test('lists persisted visual identity matches within an optional collection', async () => {
    const scopeKey = newId(), identityKey = newId(), collectionKey = newId(), imageKey = newId(), actorKey = newId();
    const image = { _key: imageKey, scopeKey, filename: 'reference.jpg', caption: 'Reference', imageCaptionKey: null, storageKey: 'media/reference', mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: '2026-08-17T12:00:00.000Z', updatedAt: '2026-08-17T12:00:00.000Z' };
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      expect(query).toContain('collectionImage.collectionKey == @collectionKey');
      expect(bindVars).toEqual({ scopeKey, identityKey, actorKey, collectionKey });
      return [{ image, confidence: 1 }];
    } }; } };
    await expect(createGalleryRepository(database).listSubjectImages(scopeKey, identityKey, actorKey, collectionKey)).resolves.toEqual([{ image: expect.objectContaining({ key: imageKey }), confidence: 1 }]);
  });

  test('rejects duplicate deletion when the protected duplicate set changes', async () => {
    const database: MediaLibraryDatabase = { async query() { return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const result = await repository.deleteDuplicateImages(newId(), newId(), [newId()], newId(), '2026-08-13T12:00:00.000Z');
    expect(result).toBeNull();
  });

  test('returns a tagged favorite collection result without transactional writes', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return [{ isFavorite: true, formerUserKeys: [newId()] }]; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.deleteCollection(newId(), newId(), newId(), '2026-08-18T12:00:00.000Z')).resolves.toEqual({ status: 'favorite' });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('RETURN { isFavorite: collection.isFavorite == true, formerUserKeys }');
    expect(queries[0]).not.toContain('UPDATE collection');
  });

  test('hard removes a collection and every Gallery dependent after authorization', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('RETURN { isFavorite:') ? [{ isFavorite: false, formerUserKeys: [] }] : []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.deleteCollection(newId(), newId(), newId(), '2026-08-18T12:00:00.000Z')).resolves.toEqual({ status: 'deleted', formerUserKeys: [] });
    for (const collection of ['collectionImages', 'collectionMembers', 'collectionInvites', 'imageCollecitionHightlights', 'tagAssignments', 'shares', 'userHiddens', 'collections']) {
      expect(queries.some((query) => query.includes(`IN ${collection}`))).toBe(true);
    }
  });

  test('partitions validated duplicate favorites and leaves favorite relations and covers untouched', async () => {
    const scopeKey = newId(), collectionKey = newId(), selected = [newId(), newId()];
    const makeImage = (imageKey: string, isFavorite: boolean, createdAt: string) => ({ _key: imageKey, scopeKey, filename: `${imageKey}.jpg`, caption: 'Duplicate', imageCaptionKey: newId(), storageKey: `media/${imageKey}`, mimeType: 'image/jpeg', sizeBytes: 10, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite, createdAt, updatedAt: createdAt });
    const rows = [
      { image: makeImage(newId(), false, '2026-08-18T10:00:00.000Z'), perceptualHash: '0000000000000000', protected: false },
      { image: makeImage(selected[0]!, true, '2026-08-18T10:01:00.000Z'), perceptualHash: '0000000000000000', protected: false },
      { image: makeImage(newId(), false, '2026-08-18T10:02:00.000Z'), perceptualHash: 'ffffffffffffffff', protected: false },
      { image: makeImage(selected[1]!, false, '2026-08-18T10:03:00.000Z'), perceptualHash: 'ffffffffffffffff', protected: false },
    ];
    const queries: string[] = [], binds: Record<string, unknown>[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars) { queries.push(query); binds.push(bindVars ?? {}); return { async all() {
      if (query.includes('RETURN true')) return [true];
      if (query.includes('perceptualHash')) return rows;
      if (query.includes('RETURN { imageKey: image._key')) return [{ imageKey: selected[1], storageKey: `media/${selected[1]}`, imageCaptionKey: null }];
      return [];
    } }; } };
    const result = await createGalleryRepository(database, async (_collections, operation) => operation(database)).deleteDuplicateImages(scopeKey, collectionKey, selected, newId(), '2026-08-18T12:00:00.000Z');
    expect(result).toEqual({ removedImageKeys: [selected[1]], deletedImageKeys: [selected[1]], favoriteImageKeys: [selected[0]], collectionKeys: [collectionKey], memoryCollectionKeys: [], subjectChanged: false, storageKeys: [`media/${selected[1]}`] });
    for (let index = 2; index < binds.length; index += 1) if ('imageKeys' in binds[index]!) expect(binds[index]?.imageKeys).toEqual([selected[1]]);
  });

  test('removes collection-only duplicate removals from highlights and durably queues deleted objects', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const start = source.lastIndexOf('deleteDuplicateImages(');
    const duplicateDeletion = source.slice(start, source.indexOf('deleteImages(scopeKey', start));
    for (const collection of ['images', 'collectionImages', 'imageCollectionMemories', 'storageDeletionJobs']) expect(duplicateDeletion).toContain(`"${collection}"`);
    expect(duplicateDeletion).toContain('UPSERT { storageKey: @storageKey }');
    expect(duplicateDeletion).toContain('{ scopeKey, imageKeys: removedImageKeys, now }');
    expect(duplicateDeletion).toContain('REMOVE memory IN imageCollectionMemories');
  });

  test('keeps global image memory uniqueness and preserves memories across relation changes', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    expect(source).toContain('UPSERT { scopeKey: @scopeKey, imageKey: @imageKey }');
    const transfer = source.slice(source.indexOf('transferCollectionImages(input)'), source.indexOf('insertUploads(uploads)'));
    expect(transfer).not.toContain('imageCollectionMemories');
    const collectionDeleteStart = source.lastIndexOf('deleteCollection(scopeKey');
    const collectionDelete = source.slice(collectionDeleteStart, source.indexOf('listSubjects:', collectionDeleteStart));
    expect(collectionDelete).not.toContain('imageCollectionMemories');
  });

  test('resolves memory identity names by direct actor-owned cosine similarity', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), imageKey = newId(), now = new Date().toISOString();
    const image = { _key: imageKey, scopeKey, filename: 'hugo.jpg', caption: 'Hugo in the snow.', imageCaptionKey: null, storageKey: 'hugo.jpg', mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), createdByKey: actorKey, isFavorite: false, createdAt: now, updatedAt: now };
    let query = '';
    const database: MediaLibraryDatabase = { async query(value, bindVars) { query = value; expect(bindVars).toEqual({ scopeKey, collectionKey, actorKey }); return { async all() { return [[{ image, caption: image.caption, captionScore: 90, identityNames: ['Hugo'] }]]; } }; } };
    const candidates = await createGalleryRepository(database).listMemoryCandidates(scopeKey, collectionKey, actorKey);
    expect(candidates?.[0]?.identityNames).toEqual(['Hugo']);
    expect(query).toContain('identity.createdByKey == @actorKey');
    expect(query).toContain('COSINE_SIMILARITY(identity.embedding, image.embedding)');
    expect(query).toContain('confidence >= 0.82');
    expect(query).not.toContain('FOR imageIdentity IN imageIdentities');
  });

  test('deletes a global memory only through the exact owned containing collection', async () => {
    const scopeKey = newId(), memoryKey = newId(), collectionKey = newId(), actorKey = newId(), imageKey = newId(), now = new Date().toISOString();
    const memory = { _key: memoryKey, scopeKey, imageKey, text: 'One.\n\nTwo.\n\nThree.', createdByKey: actorKey, createdAt: now, updatedAt: now };
    const image = { _key: imageKey, scopeKey, filename: 'memory.jpg', caption: 'Memory', imageCaptionKey: null, storageKey: 'memory.jpg', mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdByKey: actorKey, isFavorite: false, createdAt: now, updatedAt: now };
    let query = '', binds: unknown;
    const database: MediaLibraryDatabase = { async query(value, bindVars) { query = value; binds = bindVars; return { async all() { return [{ memory, image, collectionKeys: [collectionKey, newId()] }]; } }; } };
    const deleted = await createGalleryRepository(database).deleteAccessibleMemory(scopeKey, memoryKey, collectionKey, actorKey);
    expect(deleted?.memory.key).toBe(memoryKey);
    expect(binds).toEqual({ scopeKey, memoryKey, collectionKey, actorKey });
    expect(query).toContain('relation.collectionKey == @collectionKey && relation.imageKey == memory.imageKey');
    expect(query).toContain('member.collectionKey == @collectionKey');
    expect(query).toContain('member.role == "owner"');
    expect(query).toContain('RETURN DISTINCT relation.collectionKey');
  });

  test('validates the duplicate set before partitioning and makes all-favorite duplicate batches no-ops', async () => {
    const scopeKey = newId(), collectionKey = newId(), canonicalKey = newId(), favoriteKey = newId(), invalidKey = newId();
    const createdAt = '2026-08-18T10:00:00.000Z';
    const image = (imageKey: string, isFavorite: boolean, offset: number) => ({ _key: imageKey, scopeKey, filename: `${offset}.jpg`, caption: 'Duplicate', imageCaptionKey: newId(), storageKey: `media/${offset}`, mimeType: 'image/jpeg', sizeBytes: 10, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite, createdAt: new Date(Date.parse(createdAt) + offset).toISOString(), updatedAt: createdAt });
    for (const imageKeys of [[favoriteKey, invalidKey], [favoriteKey]]) {
      const queries: string[] = [];
      const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() {
        if (query.includes('RETURN true')) return [true];
        if (query.includes('perceptualHash')) return [{ image: image(canonicalKey, false, 0), perceptualHash: '0'.repeat(16), protected: false }, { image: image(favoriteKey, true, 1), perceptualHash: '0'.repeat(16), protected: false }];
        return [];
      } }; } };
      const result = await createGalleryRepository(database, async (_collections, operation) => operation(database)).deleteDuplicateImages(scopeKey, collectionKey, imageKeys, newId(), '2026-08-18T12:00:00.000Z');
      expect(result).toEqual(imageKeys.length === 2 ? null : { removedImageKeys: [], deletedImageKeys: [], favoriteImageKeys: [favoriteKey], collectionKeys: [], memoryCollectionKeys: [], subjectChanged: false, storageKeys: [] });
      expect(queries).toHaveLength(2);
    }
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
    expect(result).toEqual({ status: 'ok', createdRelationCount: 4, collectionKeys: [expect.any(String), ...destinationCollectionKeys] });
    expect(queries.filter((query) => query.includes('UPSERT'))).toHaveLength(4);
    expect(queryBindVars[0]).toEqual({ imageKeys, scopeKey: expect.any(String), sourceCollectionKey: expect.any(String), actorKey: expect.any(String) });
    for (const query of queries.slice(0, 2)) {
      expect(query).toContain('actor.status == "active"');
      expect(query).toContain('actor.organizationId == scope.organizationKey');
      expect(query).toContain('actor.orgRole IN ["owner", "admin"]');
      expect(query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    }
    expect(queries[0]).toContain('member.role == "owner"');
    expect(queries[0]).toContain('image.createdByKey == @actorKey');
    expect(queries[1]).toContain('member.role IN ["owner", "collaborator", "member"]');
  });

  test('hard deletes images and removes dependent records atomically', async () => {
    const imageKeys = [newId(), newId()];
    const queries: string[] = [];
    let transactionCollections: unknown;
    const database: MediaLibraryDatabase = { async query(query, bindVars) {
      queries.push(query);
      return { async all() { return query.includes('LET image = DOCUMENT') ? imageKeys : []; } };
    } };
    const repository = createGalleryRepository(database, async (collections, operation) => { transactionCollections = collections; return operation(database); });
    await expect(repository.deleteImages(newId(), imageKeys, newId(), '2026-08-13T12:00:00.000Z')).resolves.toEqual({ deletedImageKeys: imageKeys, favoriteImageKeys: [], collectionKeys: [], memoryCollectionKeys: [], subjectChanged: false, hadUnfiledImages: false, storageKeys: [] });
    expect(transactionCollections).toEqual(expect.objectContaining({ write: expect.arrayContaining(['images', 'imageCaptions', 'collectionImages', 'imageIdentities', 'visualIdentities', 'imageCollecitionHightlights', 'tagAssignments', 'shares', 'userHiddens']) }));
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE relation IN imageIdentities'))).toBe(true);
    expect(queries.some((query) => query.includes('LET replacement = FIRST') && query.includes('referenceImageKey: replacement'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE image IN images'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE identity IN visualIdentities'))).toBe(true);
  });

  test('partitions persisted image favorites in request order and mutates only nonfavorites', async () => {
    const imageKeys = [newId(), newId(), newId()], favoriteKeys = new Set([imageKeys[0], imageKeys[2]]);
    const binds: Record<string, unknown>[] = [];
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars) { queries.push(query); binds.push(bindVars ?? {}); return { async all() {
      if (query.includes('RETURN { imageKey, isFavorite:')) return imageKeys.map((imageKey) => ({ imageKey, isFavorite: favoriteKeys.has(imageKey) }));
      if (query.includes('RETURN { imageKey: image._key')) return [{ imageKey: imageKeys[1], storageKey: `media/${imageKeys[1]}`, imageCaptionKey: null }];
      return [];
    } }; } };
    const result = await createGalleryRepository(database, async (_collections, operation) => operation(database)).deleteImages(newId(), imageKeys, newId(), '2026-08-18T12:00:00.000Z');
    expect(result).toEqual({ deletedImageKeys: [imageKeys[1]], favoriteImageKeys: [imageKeys[0], imageKeys[2]], collectionKeys: [], memoryCollectionKeys: [], subjectChanged: false, hadUnfiledImages: false, storageKeys: [`media/${imageKeys[1]}`] });
    for (let index = 1; index < binds.length; index += 1) if ('imageKeys' in binds[index]!) expect(binds[index]?.imageKeys).toEqual([imageKeys[1]]);
    expect(queries.some((query) => query.includes('REMOVE image IN images'))).toBe(true);
  });

  test('validates the complete image batch before favorite partitioning and makes all-favorite batches no-ops', async () => {
    const imageKeys = [newId(), newId()];
    for (const authorized of [false, true]) {
      const queries: string[] = [];
      const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() {
        if (!query.includes('RETURN { imageKey, isFavorite:')) return [];
        return authorized ? imageKeys.map((imageKey) => ({ imageKey, isFavorite: true })) : [{ imageKey: imageKeys[0], isFavorite: true }];
      } }; } };
      const result = await createGalleryRepository(database, async (_collections, operation) => operation(database)).deleteImages(newId(), imageKeys, newId(), '2026-08-18T12:00:00.000Z');
      expect(result).toEqual(authorized ? { deletedImageKeys: [], favoriteImageKeys: imageKeys, collectionKeys: [], memoryCollectionKeys: [], subjectChanged: false, hadUnfiledImages: false, storageKeys: [] } : null);
      expect(queries).toHaveLength(1);
    }
  });

  test('atomically compensates only a processing upload and transitions it to failed', async () => {
    const uploadKey = newId(), scopeKey = newId(), imageKey = newId();
    const queries: string[] = [];
    let transactionCollections: unknown;
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('FOR upload IN galleryUploads') ? [imageKey] : []; } }; } };
    const repository = createGalleryRepository(database, async (collections, operation) => { transactionCollections = collections; return operation(database); });
    await expect(repository.compensateUpload(uploadKey, scopeKey, newId(), 'IMAGE_PROCESSING_FAILED', 'failed', '2026-08-17T12:00:00.000Z')).resolves.toEqual({ collectionKeys: [], subjectChanged: false, imageChanged: false, storageKeys: [] });
    expect(transactionCollections).toEqual({ read: ['images', 'visualIdentities'], write: ['galleryUploads', 'images', 'imageCaptions', 'collectionImages', 'collections', 'imageIdentities', 'visualIdentities'] });
    expect(queries.some((query) => query.includes('status: @status'))).toBe(true);
    expect(queries[0]).toContain('upload.status == "processing"');
    expect(queries[0]).toContain('upload.processingLeaseId == @leaseId');
    expect(queries.some((query) => query.includes('REMOVE relation IN collectionImages'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE image IN images'))).toBe(true);
  });

  test('claims only queued siblings with one compare-and-set query', async () => {
    const uploadKeys = [newId(), newId()], leaseId = newId(), now = '2026-08-18T12:00:00.000Z';
    const rows = uploadKeys.map((key) => ({ _key: key, organizationKey: 'organization', scopeKey: newId(), actorKey: newId(), imageKey: newId(), collectionKey: null, filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: `pending/${key}`, processingMode: 'library', status: 'processing', errorCode: null, createdAt: now, updatedAt: now, expiresAt: '2026-08-18T12:15:00.000Z' }));
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return rows; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.claimUploads(uploadKeys, leaseId, now)).resolves.toHaveLength(2);
    expect(queries).toHaveLength(1);
    expect(queries.every((query) => query.includes('upload.status == "queued"'))).toBe(true);
    expect(queries[0]).toContain('status: "processing"');
    expect(queries[0]).toContain('processingLeaseId: @leaseId');

    const deniedQueries: string[] = [];
    const deniedDatabase: MediaLibraryDatabase = { async query(query) { deniedQueries.push(query); return { async all() { return [rows[0]]; } }; } };
    const denied = createGalleryRepository(deniedDatabase, async (_collections, operation) => operation(deniedDatabase));
    await expect(denied.claimUploads(uploadKeys, leaseId, now)).resolves.toHaveLength(1);
    expect(deniedQueries).toHaveLength(1);
    expect(deniedQueries[0]).toContain('upload.status == "queued"');
  });

  test('renews only processing uploads owned by the current lease', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return [true, true]; } }; } };
    const repository = createGalleryRepository(database);
    await expect(repository.renewUploadLease([newId(), newId()], newId(), '2026-08-18T12:05:00.000Z')).resolves.toBe(2);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('upload.status == "processing" && upload.processingLeaseId == @leaseId');
    expect(queries[0]).toContain('updatedAt: @now');
  });

  test('queues an entire validated upload set in one transaction or none', async () => {
    const scopeKey = newId(), actorKey = newId(), uploadKeys = [newId(), newId()], now = '2026-08-18T12:00:00.000Z';
    const rows = uploadKeys.map((key) => ({ _key: key, organizationKey: 'organization', scopeKey, actorKey, imageKey: newId(), collectionKey: null, filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: `pending/${key}`, processingMode: 'library', status: 'reserved', errorCode: null, createdAt: now, updatedAt: now, expiresAt: '2026-08-18T12:15:00.000Z' }));
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('RETURN upload') ? rows : rows.map((row) => ({ ...row, status: 'queued' })); } }; } };
    let collections: unknown;
    const repository = createGalleryRepository(database, async (value, operation) => { collections = value; return operation(database); });
    await expect(repository.queueUploads({ uploadKeys, organizationKey: 'organization', scopeKey, actorKey, now })).resolves.toHaveLength(2);
    expect(collections).toEqual({ read: [], write: ['galleryUploads'] });
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('upload.status == "reserved"');
    expect(queries[1]).toContain('status: "queued"');

    const changedDatabase: MediaLibraryDatabase = { async query() { return { async all() { return [rows[0]]; } }; } };
    const changed = createGalleryRepository(changedDatabase, async (_value, operation) => operation(changedDatabase));
    await expect(changed.queueUploads({ uploadKeys, organizationKey: 'organization', scopeKey, actorKey, now })).resolves.toBeNull();
  });

  test('inserts upload reservations as one transactional batch', async () => {
    const now = '2026-08-18T12:00:00.000Z', scopeKey = newId(), actorKey = newId();
    const uploads = [newId(), newId()].map((key) => galleryUploadSchema.parse({ key, organizationKey: 'organization', scopeKey, actorKey, imageKey: newId(), collectionKey: null, filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: `pending/${key}`, processingMode: 'library', status: 'reserved', errorCode: null, createdAt: now, updatedAt: now, expiresAt: '2026-08-18T12:15:00.000Z' }));
    const queries: string[] = [];
    let collections: unknown;
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (value, operation) => { collections = value; return operation(database); });
    await expect(repository.insertUploads(uploads)).resolves.toEqual(uploads);
    expect(collections).toEqual({ read: [], write: ['galleryUploads'] });
    expect(queries).toEqual(['INSERT @upload INTO galleryUploads', 'INSERT @upload INTO galleryUploads']);
  });

  test('requeues only stale processing uploads while preserving active and completed rows', async () => {
    const scopeKey = newId(), actorKey = newId(), now = '2026-08-18T13:00:00.000Z', staleBefore = '2026-08-18T12:30:00.000Z';
    const make = (status: 'queued' | 'processing' | 'completed', updatedAt: string) => ({ _key: newId(), organizationKey: 'organization', scopeKey, actorKey, imageKey: newId(), collectionKey: null, filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: `pending/${status}-${updatedAt}`, processingMode: 'library', status, errorCode: null, createdAt: updatedAt, updatedAt, expiresAt: '2026-08-18T14:00:00.000Z' });
    const queued = make('queued', '2026-08-18T12:50:00.000Z'), stale = make('processing', '2026-08-18T12:00:00.000Z'), active = make('processing', '2026-08-18T12:45:00.000Z'), completed = make('completed', '2026-08-18T12:10:00.000Z');
    const rows = new Map([queued, stale, active, completed].map((row) => [row._key, row]));
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query, bindVars = {}) { queries.push(query); return { async all() {
      if (query.includes('upload.updatedAt < @staleBefore')) return [...rows.values()].filter((row) => row.status === 'processing' && row.updatedAt < String(bindVars.staleBefore)).map((row) => ({ key: row._key, scopeKey: row.scopeKey, leaseId: null }));
      if (query.includes('RETURN upload.imageKey')) { const row = rows.get(String(bindVars.uploadKey)); return row?.status === 'processing' ? [row.imageKey] : []; }
      if (query.includes('status: @status')) { const row = rows.get(String(bindVars.uploadKey)); if (!row || row.status !== 'processing') return []; row.status = 'queued'; row.updatedAt = String(bindVars.now); return [true]; }
      if (query.includes('upload.status == "queued"')) return [...rows.values()].filter((row) => row.status === 'queued');
      return [];
    } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    const recovered = await repository.recoverUploadQueue(staleBefore, now);
    expect(recovered.uploads.map(({ key }) => key).sort()).toEqual([queued._key, stale._key].sort());
    expect(rows.get(active._key)?.status).toBe('processing');
    expect(rows.get(completed._key)?.status).toBe('completed');
    expect(queries[0]).toContain('upload.status == "processing" && upload.updatedAt < @staleBefore');
  });

  test('lists pending invites for elevated organization and scope managers', async () => {
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return []; } }; } };
    await createGalleryRepository(database).listPendingInvites(newId(), newId(), '2026-08-18T12:00:00.000Z');
    expect(query).toContain('membership.organizationId == scope.organizationKey');
    expect(query).toContain('membership.orgRole IN ["owner", "admin"]');
    expect(query).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(query).toContain('FILTER manager || ownsCollection || invite.inviteeKey == @actorKey');
  });

  test('atomically revalidates upload contribution while attaching and completing', async () => {
    const now = '2026-08-18T12:00:00.000Z', scopeKey = newId(), actorKey = newId(), collectionKey = newId();
    const leaseId = newId();
    const upload = galleryUploadSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey, actorKey, imageKey: newId(), collectionKey, filename: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, storageKey: 'pending/photo', processingMode: 'library', status: 'processing', processingLeaseId: leaseId, errorCode: null, createdAt: now, updatedAt: now, expiresAt: '2026-08-18T12:15:00.000Z' });
    const relation = { key: newId(), scopeKey, collectionKey, imageKey: upload.imageKey, addedByKey: actorKey, createdAt: now };
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { if (query.includes('LET current = DOCUMENT')) return [true]; if (query.includes('UPDATE current')) return [true]; return []; } }; } };
    let collections: unknown;
    const repository = createGalleryRepository(database, async (value, operation) => { collections = value; return operation(database); });
    await expect(repository.finalizeUpload(upload, relation, leaseId, now, 'failed', 'UPLOAD_ACCESS_REVOKED')).resolves.toEqual({ status: 'completed' });
    expect(collections).toEqual({ read: ['images', 'scopes', 'userOrganizations', 'scopeMembers', 'collections', 'collectionMembers', 'visualIdentities'], write: ['galleryUploads', 'images', 'collectionImages', 'collections', 'imageIdentities', 'visualIdentities'] });
    expect(queries[0]).toContain('scopeRole IN ["owner", "admin", "moderator"]');
    expect(queries[0]).toContain('member.role IN ["owner", "collaborator", "member"]');
    expect(queries.some((query) => query.includes('UPSERT'))).toBe(true);
    expect(queries.some((query) => query.includes('status: "completed"'))).toBe(true);
    expect(queries[0]).toContain('current.processingLeaseId == @leaseId');

    const deniedQueries: string[] = [];
    const deniedDatabase: MediaLibraryDatabase = { async query(query) { deniedQueries.push(query); return { async all() { if (query.includes('LET current = DOCUMENT')) return []; if (query.includes('RETURN upload.imageKey')) return [upload.imageKey]; if (query.includes('status: @status')) return [true]; return []; } }; } };
    const denied = createGalleryRepository(deniedDatabase, async (_value, operation) => operation(deniedDatabase));
    await expect(denied.finalizeUpload(upload, relation, leaseId, now, 'queued', 'UPLOAD_ACCESS_REVOKED')).resolves.toMatchObject({ status: 'compensated', effects: { imageChanged: false } });
    expect(deniedQueries.some((query) => query.includes('UPSERT'))).toBe(false);
    expect(deniedQueries.some((query) => query.includes('UPDATE current'))).toBe(false);
  });

  test('does not compensate or requeue an upload that already completed or failed', async () => {
    const queries: string[] = [];
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.compensateUpload(newId(), newId(), newId(), 'IMAGE_PROCESSING_FAILED', 'queued', '2026-08-17T12:00:00.000Z')).resolves.toBeNull();
    expect(queries).toHaveLength(1);
  });

  test('keeps operation persistence behind the repository boundary', async () => {
    const source = await Bun.file(new URL('./operations.ts', import.meta.url)).text();
    expect(source).not.toMatch(/\bdb\.query\b|\bwithTransaction\b|\btoArangoDoc\b/);
  });

  test('loads every live collection image as a highlight candidate without deduplication', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const image = { _key: newId(), scopeKey, filename: 'same.jpg', caption: 'Same image', storageKey: newId(), mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdByKey: actorKey, isFavorite: false, createdAt: now, updatedAt: now };
    let query = '';
    const database: MediaLibraryDatabase = { async query(value) { query = value; return { async all() { return [[{ image, qualityScore: 90 }, { image: { ...image, _key: newId(), storageKey: newId() }, qualityScore: 90 }]]; } }; } };
    const rows = await createGalleryRepository(database).listHighlightCandidates(scopeKey, collectionKey, actorKey);
    expect(rows).toHaveLength(2);
    expect(query).toContain('LET qualityScore');
    expect(query).toContain('caption.score >= 1 && caption.score <= 100');
    expect(query).toContain('collectionMember.role == "owner"');
    expect(query).not.toContain('DISTINCT');
    expect(query).not.toContain('perceptualHash');
  });

  test('atomically persists an empty highlight after access revalidation', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const highlight = { key: newId(), scopeKey, collectionKey, imageKeys: [], createdByKey: actorKey, createdAt: now, updatedAt: now };
    const queries: string[] = [];
    let transactionCollections: unknown;
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return query.includes('UPSERT') ? [{ ...highlight, _key: highlight.key }] : [{ selected: [] }]; } }; } };
    const repository = createGalleryRepository(database, async (collections, operation) => { transactionCollections = collections; return operation(database); });
    await expect(repository.createHighlight(highlight, actorKey)).resolves.toMatchObject({ key: highlight.key, imageKeys: [] });
    expect(transactionCollections).toEqual(expect.objectContaining({ write: ['imageCollecitionHightlights'] }));
    expect(queries[0]).toContain('RETURN { selected }');
    expect(queries[0]).toContain('collectionMember.role == "owner"');
    expect(queries[1]).toContain('UPSERT { _key: @highlightKey }');
  });

  test('silently drops image pointers that disappear while a highlight is being created', async () => {
    const scopeKey = newId(), collectionKey = newId(), actorKey = newId(), now = '2026-08-18T12:00:00.000Z';
    const retained = newId(), removed = newId();
    const highlight = { key: newId(), scopeKey, collectionKey, imageKeys: [retained, removed], createdByKey: actorKey, createdAt: now, updatedAt: now };
    const database: MediaLibraryDatabase = { async query(query, bindVars) { return { async all() {
      if (!query.includes('UPSERT')) return [{ selected: [retained] }];
      const persisted = (bindVars as { highlight: Omit<typeof highlight, "key"> & { _key: string } }).highlight;
      return [{ ...persisted, key: persisted._key }];
    } }; } };

    const persisted = await createGalleryRepository(database, async (_collections, operation) => operation(database)).createHighlight(highlight, actorKey);
    expect(persisted).toMatchObject({ imageKeys: [retained] });
  });

  test('hydrates ordered keys through current collection relations and hard-deletes only the highlight', async () => {
    const queries: string[] = [];
    const scopeKey = newId(), actorKey = newId(), highlightKey = newId();
    const database: MediaLibraryDatabase = { async query(query) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createGalleryRepository(database);
    await repository.listHighlights(scopeKey, undefined, actorKey);
    await repository.getHighlight(scopeKey, highlightKey, actorKey);
    await repository.deleteHighlight(scopeKey, highlightKey, actorKey);
    for (const query of queries.slice(0, 2)) {
      expect(query).toContain('FOR imageKey IN highlight.imageKeys');
      expect(query).toContain('relation.collectionKey == highlight.collectionKey');
      expect(query).toContain('collectionMember != null');
    }
    expect(queries[0]).toContain('elevated || collectionMember != null');
    expect(queries[2]).toContain('member.role == "owner"');
    expect(queries[2]).toContain('owner != null');
    expect(queries[2]).toContain('REMOVE highlight IN imageCollecitionHightlights RETURN OLD');
    expect(queries[2]).not.toContain('highlight.createdByKey == @actorKey');
    expect(queries[2]).not.toContain('UPDATE image');
  });
});
