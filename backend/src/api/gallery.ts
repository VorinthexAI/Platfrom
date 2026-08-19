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
const idempotencyKeySchema = z.string().trim().min(1).max(200);
export const galleryHighlightListQuerySchema = z.object({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), collectionKey: z.string().cuid() }).strict();

async function context(c: Context, organizationKey: string, scopeKey: string): Promise<GalleryOperationContext> {
  const identity = await getAuthIdentity(c);
  if (!identity) throw new GalleryOperationError(401, 'GALLERY_UNAUTHORIZED', 'Authentication required.');
  if (identity.identityType !== 'user') throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'A user session is required.');
  const membership = await getUserOrganizationByOrganizationAndUser(organizationKey, identity.key);
  if (!membership) throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'Gallery scope access denied.');
  const rawIdempotencyKey = c.req.header('idempotency-key')?.trim();
  const idempotencyKey = rawIdempotencyKey ? idempotencyKeySchema.parse(rawIdempotencyKey) : undefined;
  return { organizationKey, scopeKey, membership, ...(idempotencyKey ? { idempotencyKey } : {}), signal: c.req.raw.signal };
}

function handler(name: GalleryOperationName, successStatus = 200, transformInput: (input: Record<string, unknown>) => unknown = (input) => input) {
  return async (c: Context) => {
    try {
      const { organizationKey, scopeKey, ...input } = trustedContextSchema.parse(await c.req.json());
      const operation = galleryOperations[name] as (input: unknown, context: GalleryOperationContext) => Promise<unknown>;
      const data = await operation(transformInput(input), await context(c, organizationKey, scopeKey));
      return c.json({ success: true, data }, successStatus as 200);
    } catch (error) {
      const normalized = normalizeGalleryOperationError(error);
      return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status);
    }
  };
}

export function duplicateSearchTransportInput<Input extends Record<string, unknown>>(input: Input) {
  return { ...input, duplicates: true as const };
}

export const galleryOverview = handler('overview');
export const createGalleryCollection = handler('createCollection', 201);
export const updateGalleryCollection = handler('updateCollection');
export const deleteGalleryCollection = handler('deleteCollection');
export const listGalleryCollectionMembers = handler('listMembers');
export const listGalleryPendingInvites = handler('listPendingInvites');
export const createGalleryCollectionInvite = handler('createInvite', 201);
export const acceptGalleryCollectionInvite = handler('acceptInvite');
export const rejectGalleryCollectionInvite = handler('rejectInvite');
export const revokeGalleryCollectionInvite = handler('revokeInvite');
export const updateGalleryCollectionMemberRole = handler('updateMemberRole');
export const removeGalleryCollectionMember = handler('removeMember');
export const leaveGalleryCollection = handler('leaveCollection');
export const listGalleryCollectionShares = handler('listShares');
export const createGalleryCollectionShare = handler('createShare', 201);
export const updateGalleryCollectionShare = handler('updateShare');
export const revokeGalleryCollectionShare = handler('revokeShare');
export const activateGalleryCollectionShare = handler('activateShare');
export const presignGalleryUploads = handler('reserveUploads', 201);
export const completeGalleryUploads = handler('completeUploads', 202);
export const galleryUploadStatus = handler('uploadStatus');
export const searchGalleryImages = handler('search');
export const setGalleryImageFavorite = handler('setFavorite');
export const updateGalleryImage = handler('updateImage');
export const deleteGalleryImages = handler('deleteImages');
export const findGalleryCollectionDuplicates = handler('search', 200, duplicateSearchTransportInput);
export const deleteGalleryCollectionDuplicates = handler('deleteDuplicates');
export const transferGalleryCollectionImages = handler('transferCollectionImages');
export const listGallerySubjects = handler('listSubjects');
export const createGallerySubject = handler('createSubject', 201);
export const listGallerySubjectImages = handler('listSubjectImages');
export const deleteGallerySubject = handler('deleteSubject');
export const createGalleryHighlight = handler('createHighlight', 201);
export const listGalleryHighlights = async (c: Context) => {
  try {
    const { organizationKey, scopeKey, ...input } = galleryHighlightListQuerySchema.parse(c.req.query());
    const data = await galleryOperations.listHighlights(input, await context(c, organizationKey, scopeKey));
    return c.json({ success: true, data }, 200);
  } catch (error) {
    const normalized = normalizeGalleryOperationError(error);
    return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status);
  }
};
export const readGalleryHighlight = handler('readHighlight');
export const deleteGalleryHighlight = handler('deleteHighlight');
