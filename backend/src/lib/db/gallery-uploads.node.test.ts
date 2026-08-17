import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { galleryUploadSchema } from './gallery-uploads.node';

const validUpload = {
  key: newId(),
  organizationKey: newId(),
  scopeKey: newId(),
  actorKey: newId(),
  imageKey: newId(),
  collectionKey: null,
  filename: 'photo.jpg',
  mimeType: 'image/jpeg' as const,
  sizeBytes: 1024,
  storageKey: `pending/gallery/${newId()}/original.jpg`,
  status: 'reserved' as const,
  errorCode: null,
  createdAt: '2026-08-11T12:00:00.000Z',
  updatedAt: '2026-08-11T12:00:00.000Z',
  expiresAt: '2026-08-11T12:15:00.000Z',
};

describe('Gallery upload reservations', () => {
  test('accepts a server-owned JPEG reservation', () => {
    expect(galleryUploadSchema.parse(validUpload)).toEqual({ ...validUpload, processingMode: 'library' });
    expect(galleryUploadSchema.parse({ ...validUpload, processingMode: 'cover' })).toMatchObject({ processingMode: 'cover' });
  });

  test('rejects oversized files and unsupported media types', () => {
    expect(() => galleryUploadSchema.parse({ ...validUpload, sizeBytes: 20 * 1024 * 1024 + 1 })).toThrow();
    expect(() => galleryUploadSchema.parse({ ...validUpload, mimeType: 'image/png' })).toThrow();
  });

  test('strips Arango metadata from reads', () => {
    const parsed = galleryUploadSchema.parse({ ...validUpload, _key: validUpload.key, _id: `galleryUploads/${validUpload.key}`, unexpected: true });
    expect(parsed).not.toHaveProperty('_key');
    expect(parsed).not.toHaveProperty('_id');
    expect(parsed).not.toHaveProperty('unexpected');
  });
});
