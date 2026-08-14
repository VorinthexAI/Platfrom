import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas, GalleryOperationError, normalizeGalleryOperationError } from './operations';

const key = () => newId();
const validInputs = {
  overview: {},
  createCollection: { name: 'Summer', description: 'Summer memories' },
  reserveUploads: { files: [{ clientKey: 'local-1', filename: 'photo.jpeg', sizeBytes: 1_024 }] },
  completeUploads: { uploadKeys: [key()] },
  uploadStatus: { uploadKeys: [key()] },
  search: { query: 'red dog', limit: 25 },
  setFavorite: { imageKey: key(), isFavorite: true },
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
    expect(galleryOperationInputSchemas.overview.parse({})).toEqual({});
    expect(galleryOperationInputSchemas.listSubjects.parse({})).toEqual({ includeDeleted: false });
    expect(galleryOperationInputSchemas.search.parse({ query: 'mountains' })).toEqual({ query: 'mountains', limit: 50 });
  });

  test('accepts an optional collection search boundary', () => {
    const collectionKey = key();
    expect(galleryOperationInputSchemas.search.parse({ query: 'mountains', collectionKey })).toEqual({ query: 'mountains', collectionKey, limit: 50 });
  });

  test('enforces mutually exclusive search sources', () => {
    expect(() => galleryOperationInputSchemas.search.parse({})).toThrow('exactly one');
    expect(() => galleryOperationInputSchemas.search.parse({ query: 'dog', imageKey: key() })).toThrow('exactly one');
    expect(galleryOperationInputSchemas.search.parse({ imageKey: key() })).toBeDefined();
    expect(() => galleryOperationInputSchemas.search.parse({ imageKey: key(), collectionKey: key() })).toThrow('text query');
  });

  test('enforces transfer and subject uniqueness invariants', () => {
    const sourceCollectionKey = key(), destination = key(), image = key();
    expect(() => galleryOperationInputSchemas.transferCollectionImages.parse({ sourceCollectionKey, destinationCollectionKeys: [sourceCollectionKey], imageKeys: [image], mode: 'move' })).toThrow('source collection');
    expect(() => galleryOperationInputSchemas.transferCollectionImages.parse({ sourceCollectionKey, destinationCollectionKeys: [destination, destination], imageKeys: [image], mode: 'copy' })).toThrow('unique');
    expect(() => galleryOperationInputSchemas.createSubject.parse({ name: 'Alex', imageKeys: [image, image] })).toThrow('unique');
  });

  test('preserves operation errors and sanitizes validation and unknown failures', () => {
    const expected = new GalleryOperationError(409, 'GALLERY_CHANGED', 'Changed.');
    expect(normalizeGalleryOperationError(expected)).toBe(expected);
    expect(normalizeGalleryOperationError(new SyntaxError())).toMatchObject({ status: 400, code: 'GALLERY_INVALID_INPUT' });
    expect(normalizeGalleryOperationError(new Error('database secret'))).toMatchObject({ status: 500, code: 'GALLERY_FAILED', message: 'Gallery request failed.' });
  });
});
