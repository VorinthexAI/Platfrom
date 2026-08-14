import type { Context } from 'hono';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import {
  galleryOperations,
  GalleryOperationError,
  normalizeGalleryOperationError,
  type GalleryOperationContext,
  type GalleryOperationName,
} from '@/lib/gallery/operations';
import { getAuthIdentity } from './security';
import { z } from 'zod';

const trustedContextSchema = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() }).passthrough();

async function context(c: Context, organizationKey: string, scopeKey: string): Promise<GalleryOperationContext> {
  const identity = await getAuthIdentity(c);
  if (!identity) throw new GalleryOperationError(401, 'GALLERY_UNAUTHORIZED', 'Authentication required.');
  if (identity.identityType !== 'user') throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'A user session is required.');
  const membership = await getUserOrganizationByOrganizationAndUser(organizationKey, identity.key);
  if (!membership) throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'Gallery scope access denied.');
  return { organizationKey, scopeKey, membership, signal: c.req.raw.signal };
}

function handler(name: GalleryOperationName, successStatus = 200) {
  return async (c: Context) => {
    try {
      const { organizationKey, scopeKey, ...input } = trustedContextSchema.parse(await c.req.json());
      const operation = galleryOperations[name] as (input: unknown, context: GalleryOperationContext) => Promise<unknown>;
      const data = await operation(input, await context(c, organizationKey, scopeKey));
      return c.json({ success: true, data }, successStatus as 200);
    } catch (error) {
      const normalized = normalizeGalleryOperationError(error);
      return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status);
    }
  };
}

export const galleryOverview = handler('overview');
export const createGalleryCollection = handler('createCollection', 201);
export const presignGalleryUploads = handler('reserveUploads', 201);
export const completeGalleryUploads = handler('completeUploads', 202);
export const galleryUploadStatus = handler('uploadStatus');
export const searchGalleryImages = handler('search');
export const setGalleryImageFavorite = handler('setFavorite');
export const deleteGalleryImages = handler('deleteImages');
export const findGalleryCollectionDuplicates = handler('findDuplicates');
export const deleteGalleryCollectionDuplicates = handler('deleteDuplicates');
export const transferGalleryCollectionImages = handler('transferCollectionImages');
export const listGallerySubjects = handler('listSubjects');
export const createGallerySubject = handler('createSubject', 201);
export const listGallerySubjectImages = handler('listSubjectImages');
export const deleteGallerySubject = handler('deleteSubject');
export const restoreGallerySubject = handler('restoreSubject');
