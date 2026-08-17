import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas, GalleryOperationError, normalizeGalleryOperationError } from './operations';

const key = () => newId();
const validInputs = {
  overview: {},
  createCollection: { name: 'Summer', isFavorite: true },
  updateCollection: { collectionKey: key(), name: 'Favorites', isFavorite: true },
  deleteCollection: { collectionKey: key() },
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

  test('preserves operation errors and sanitizes validation and unknown failures', () => {
    const expected = new GalleryOperationError(409, 'GALLERY_CHANGED', 'Changed.');
    expect(normalizeGalleryOperationError(expected)).toBe(expected);
    expect(normalizeGalleryOperationError(new SyntaxError())).toMatchObject({ status: 400, code: 'GALLERY_INVALID_INPUT' });
    expect(normalizeGalleryOperationError(new Error('database secret'))).toMatchObject({ status: 500, code: 'GALLERY_FAILED', message: 'Gallery request failed.' });
  });
});
