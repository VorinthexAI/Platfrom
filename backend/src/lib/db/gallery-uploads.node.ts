import { z } from 'zod';
import { createNodeHelpers } from './base';

export const GALLERY_UPLOADS_COLLECTION = 'galleryUploads';
export const galleryUploadStatusSchema = z.enum(['reserved', 'queued', 'processing', 'completed', 'failed']);
export const galleryUploadSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().min(1),
  scopeKey: z.string().cuid(),
  actorKey: z.string().cuid(),
  imageKey: z.string().cuid(),
  collectionKey: z.string().cuid().nullable(),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.literal('image/jpeg'),
  sizeBytes: z.number().int().positive().max(20 * 1024 * 1024),
  storageKey: z.string().min(1),
  status: galleryUploadStatusSchema,
  errorCode: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type GalleryUpload = z.infer<typeof galleryUploadSchema>;

const helpers = createNodeHelpers(GALLERY_UPLOADS_COLLECTION, galleryUploadSchema, [], { requireEmbedding: false });
export const insertGalleryUpload = helpers.insert;
export const getGalleryUploadById = helpers.getById;
export const updateGalleryUpload = helpers.updateById;
