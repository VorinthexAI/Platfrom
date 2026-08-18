import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas, GalleryOperationError, normalizeGalleryOperationError, projectCollectionShare, projectCollectionShares, safeImage } from './operations';
import { collectionMemberSchema } from '@/lib/db/collection-members.node';
import { collectionInviteSchema } from '@/lib/db/collection-invites.node';
import { imageSchema } from '@/lib/db/images.node';
import { shareSchema } from '@/lib/db/shares.node';
import { encryptAuthenticatedJson } from '@/lib/authenticated-encryption';

const key = () => newId();
const validInputs = {
  overview: {},
  createCollection: { name: 'Summer', isFavorite: true },
  updateCollection: { collectionKey: key(), name: 'Favorites', isFavorite: true },
  deleteCollection: { collectionKey: key() },
  listMembers: { collectionKey: key() },
  listPendingInvites: {},
  createInvite: { collectionKey: key(), inviteeKey: key(), role: 'collaborator' },
  acceptInvite: { inviteKey: key() },
  rejectInvite: { inviteKey: key() },
  revokeInvite: { collectionKey: key(), inviteKey: key() },
  updateMemberRole: { collectionKey: key(), memberKey: key(), role: 'viewer' },
  removeMember: { collectionKey: key(), memberKey: key() },
  leaveCollection: { collectionKey: key() },
  listShares: { collectionKey: key() },
  createShare: { collectionKey: key(), role: 'viewer' },
  updateShare: { collectionKey: key(), shareKey: key(), active: true },
  revokeShare: { collectionKey: key(), shareKey: key() },
  activateShare: { token: 'x'.repeat(32) },
  reserveUploads: { files: [{ clientKey: 'local-1', filename: 'photo.jpeg', sizeBytes: 1_024 }] },
  completeUploads: { uploadKeys: [key()] },
  uploadStatus: { uploadKeys: [key()] },
  search: { query: 'red dog', limit: 25 },
  setFavorite: { imageKey: key(), isFavorite: true },
  updateImage: { imageKey: key(), name: 'portrait.jpg', isFavorite: true },
  deleteImages: { imageKeys: [key()] },
  findDuplicates: { collectionKey: key() },
  deleteDuplicates: { collectionKey: key(), imageKeys: [key()] },
  transferCollectionImages: { sourceCollectionKey: key(), destinationCollectionKeys: [key()], imageKeys: [key()], mode: 'copy' },
  listSubjects: {},
  createSubject: { name: 'Alex', imageKeys: [key()] },
  listSubjectImages: { identityKey: key() },
  deleteSubject: { identityKey: key() },
  restoreSubject: { identityKey: key() },
} as const;

describe('Gallery operation boundaries', () => {
  test('projects image creator attribution for collaborator ownership checks', async () => {
    process.env.AWS_ACCESS_KEY_ID ??= 'test';
    process.env.AWS_SECRET_ACCESS_KEY ??= 'test';
    const createdByKey = key(), now = new Date().toISOString();
    const image = imageSchema.parse({ key: key(), scopeKey: key(), filename: 'photo.jpg', caption: 'Photo.', imageCaptionKey: null, createdByKey, storageKey: 'gallery/photo.jpg', mimeType: 'image/jpeg', sizeBytes: 10, width: 10, height: 10, embedding: Array(4_096).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
    expect(await safeImage(image)).toMatchObject({ key: image.key, createdByKey });
  });

  test('recovers copyable canonical share URLs only from authenticated ciphertext', () => {
    const previous = process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
    process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = Buffer.alloc(32, 7).toString('base64');
    try {
      const token = 'secure-token-'.padEnd(43, 'x'), now = new Date().toISOString();
      const share = shareSchema.parse({ key: key(), scopeKey: key(), sourceType: 'collection', sourceKey: key(), permission: 'viewer', tokenHash: 'a'.repeat(64), createdAt: now, updatedAt: now });
      const projected = projectCollectionShare(share, encryptAuthenticatedJson({ token }));
      expect(projected).toMatchObject({ token, url: `https://vorinthex.com/share/${token}` });
      expect(projected).not.toHaveProperty('tokenHash');
      expect(projected.url).not.toContain(share.key);
      expect(projectCollectionShares([{ share, responseCiphertext: encryptAuthenticatedJson({ token }) }], true)[0]).not.toHaveProperty('token');
      expect(projectCollectionShares([{ share, responseCiphertext: encryptAuthenticatedJson({ token }) }], true)[0]).not.toHaveProperty('url');
      expect(() => projectCollectionShare(share, 'invalid')).toThrow();
    } finally {
      if (previous === undefined) delete process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY;
      else process.env.ORCHESTRATION_CREDENTIALS_MASTER_KEY = previous;
    }
  });

  test('normalizes legacy member roles and preserves invite access roles', () => {
    const common = { key: key(), scopeKey: key(), collectionKey: key(), memberKey: key(), createdAt: new Date().toISOString() };
    expect(collectionMemberSchema.parse({ ...common, role: 'member' }).role).toBe('collaborator');
    const invite = { key: key(), scopeKey: common.scopeKey, collectionKey: common.collectionKey, invitedByKey: key(), inviteeKey: key(), tokenHash: 'a'.repeat(64), createdAt: common.createdAt, updatedAt: common.createdAt };
    expect(collectionInviteSchema.parse({ ...invite, role: 'viewer' }).role).toBe('viewer');
    expect(collectionInviteSchema.parse(invite).role).toBe('collaborator');
  });
  test('defines one strict input boundary for every canonical operation', () => {
    expect(Object.keys(galleryOperationInputSchemas)).toEqual(Object.keys(validInputs));
    for (const name of Object.keys(validInputs) as Array<keyof typeof validInputs>) {
      expect(galleryOperationInputSchemas[name].parse(validInputs[name])).toBeDefined();
      expect(() => galleryOperationInputSchemas[name].parse({ ...validInputs[name], organizationKey: 'forged', scopeKey: key(), actorKey: key() })).toThrow();
    }
  });

  test('normalizes defaults at the shared boundary', () => {
    expect(galleryOperationInputSchemas.overview.parse({})).toEqual({ limit: 100 });
    expect(galleryOperationInputSchemas.createCollection.parse({ name: 'Summer' })).toEqual({ name: 'Summer', isFavorite: false });
    expect(() => galleryOperationInputSchemas.createCollection.parse({ name: 'Summer', description: 'Memories' })).toThrow();
    expect(galleryOperationInputSchemas.listSubjects.parse({})).toEqual({ includeDeleted: false });
    expect(galleryOperationInputSchemas.search.parse({ query: 'mountains' })).toEqual({ query: 'mountains', recordHistory: true, limit: 50 });
    expect(galleryOperationInputSchemas.createShare.parse({ collectionKey: key(), role: 'viewer' })).toMatchObject({ active: true });
    expect(galleryOperationInputSchemas.createShare.parse({ collectionKey: key(), role: 'viewer', active: false })).toMatchObject({ active: false });
  });

  test('accepts an optional collection search boundary', () => {
    const collectionKey = key();
    expect(galleryOperationInputSchemas.search.parse({ query: 'mountains', collectionKey })).toEqual({ query: 'mountains', collectionKey, recordHistory: true, limit: 50 });
    expect(galleryOperationInputSchemas.search.parse({ query: 'mountains', recordHistory: false })).toMatchObject({ recordHistory: false });
    expect(galleryOperationInputSchemas.search.parse({ duplicates: true, collectionKey })).toEqual({ duplicates: true, collectionKey });
    const identityKey = key();
    expect(galleryOperationInputSchemas.search.parse({ identityKey, collectionKey })).toEqual({ identityKey, collectionKey });
  });

  test('enforces reusable overview pagination boundaries', () => {
    expect(galleryOperationInputSchemas.overview.parse({ limit: 100 })).toEqual({ limit: 100 });
    expect(() => galleryOperationInputSchemas.overview.parse({ limit: 101 })).toThrow();
    expect(galleryOperationInputSchemas.overview.parse({ cursor: 'opaque', limit: 20 })).toEqual({ cursor: 'opaque', limit: 20 });
  });

  test('overview DTO exposes server-derived collection creation capability', async () => {
    const source = await Bun.file(new URL('./operations.ts', import.meta.url)).text();
    expect(source).toContain('const canCreateCollections = await repository.canManageScope(input.scopeKey, membership.key)');
    expect(source).toContain('canCreateCollections,');
  });

  test('accepts only complete image coordinate pairs', () => {
    const file = { clientKey: 'local-1', filename: 'photo.jpg', sizeBytes: 1_024 };
    expect(galleryOperationInputSchemas.reserveUploads.parse({ files: [{ ...file, latitude: 59.3293, longitude: 18.0686 }] })).toMatchObject({ files: [{ latitude: 59.3293, longitude: 18.0686 }] });
    expect(() => galleryOperationInputSchemas.reserveUploads.parse({ files: [{ ...file, latitude: 59.3293 }] })).toThrow('both latitude and longitude');
  });

  test('enforces mutually exclusive search sources', () => {
    expect(() => galleryOperationInputSchemas.search.parse({})).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ query: 'dog', imageKey: key() })).toThrow();
    expect(galleryOperationInputSchemas.search.parse({ imageKey: key() })).toEqual(expect.objectContaining({ limit: 50 }));
    expect(galleryOperationInputSchemas.search.parse({ imageKey: key(), collectionKey: key() })).toEqual(expect.objectContaining({ limit: 50 }));
    expect(() => galleryOperationInputSchemas.search.parse({ imageKey: key(), recordHistory: false })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ duplicates: true, collectionKey: key(), threshold: 0.9 })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ duplicates: true, collectionKey: key(), recordHistory: false })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ identityKey: key(), query: 'dog' })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ identityKey: key(), imageKey: key() })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ identityKey: key(), threshold: 0.9 })).toThrow();
    expect(() => galleryOperationInputSchemas.search.parse({ identityKey: key(), limit: 10 })).toThrow();
  });

  test('enforces transfer and subject uniqueness invariants', () => {
    const sourceCollectionKey = key(), destination = key(), image = key();
    expect(() => galleryOperationInputSchemas.transferCollectionImages.parse({ sourceCollectionKey, destinationCollectionKeys: [sourceCollectionKey], imageKeys: [image], mode: 'move' })).toThrow('source collection');
    expect(() => galleryOperationInputSchemas.transferCollectionImages.parse({ sourceCollectionKey, destinationCollectionKeys: [destination, key()], imageKeys: [image], mode: 'copy' })).toThrow();
    expect(() => galleryOperationInputSchemas.createSubject.parse({ name: 'Alex', imageKeys: [image, image] })).toThrow('unique');
    expect(() => galleryOperationInputSchemas.deleteImages.parse({ imageKeys: [image, image] })).toThrow('unique');
    expect(() => galleryOperationInputSchemas.deleteDuplicates.parse({ collectionKey: sourceCollectionKey, imageKeys: [image, image] })).toThrow('unique');
  });

  test('rejects owner roles and ambiguous invite recipients', () => {
    expect(() => galleryOperationInputSchemas.createInvite.parse({ collectionKey: key(), inviteeKey: key(), email: 'member@example.com', role: 'viewer' })).toThrow();
    expect(() => galleryOperationInputSchemas.createInvite.parse({ collectionKey: key(), inviteeKey: key(), role: 'owner' })).toThrow();
    expect(() => galleryOperationInputSchemas.createShare.parse({ collectionKey: key(), role: 'owner' })).toThrow();
  });

  test('preserves operation errors and sanitizes validation and unknown failures', () => {
    const expected = new GalleryOperationError(409, 'GALLERY_CHANGED', 'Changed.');
    expect(normalizeGalleryOperationError(expected)).toBe(expected);
    expect(normalizeGalleryOperationError(new SyntaxError())).toMatchObject({ status: 400, code: 'GALLERY_INVALID_INPUT' });
    expect(normalizeGalleryOperationError(new Error('database secret'))).toMatchObject({ status: 500, code: 'GALLERY_FAILED', message: 'Gallery request failed.' });
  });
});
