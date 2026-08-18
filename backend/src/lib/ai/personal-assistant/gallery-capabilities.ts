import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';
import { GalleryOperationError, galleryOperationInputSchemas, galleryOperations, redactCollectionShareOutput, type GalleryOperationContext, type GalleryOperationName } from '@/lib/gallery/operations';
import { imageSearchInputSchema, imageSearchTool } from '@/lib/ai/tools/image-search';

type GalleryExecutor = (input: unknown, context: GalleryOperationContext) => Promise<unknown>;

const key = z.string().cuid();
const keys = (maxItems: number) => z.array(key).min(1).max(maxItems);
const toolNames: Record<string, string> = {
  gallery_overview: 'collection.list', gallery_collection_create: 'collection.create', gallery_collection_update: 'collection.update', gallery_collection_delete: 'collection.delete', search_images: 'image.search', gallery_image_favorite: 'image.favorite',
  gallery_image_update: 'image.update', image_delete: 'image.delete',
  gallery_duplicates_delete: 'collection.duplicates.delete', gallery_collection_transfer: 'collection.image.transfer',
  gallery_subject_list: 'subject.list', gallery_subject_create: 'subject.create', gallery_subject_images: 'subject.image.list', gallery_subject_delete: 'subject.delete', gallery_subject_restore: 'subject.restore',
  gallery_upload_reserve: 'image.upload.reserve', gallery_upload_status: 'image.upload.status', gallery_upload_complete: 'image.upload.complete',
  collection_member_list: 'collection.member.list', collection_invite_pending_list: 'collection.invite.pending.list', collection_invite_create: 'collection.invite.create', collection_invite_accept: 'collection.invite.accept', collection_invite_reject: 'collection.invite.reject', collection_invite_revoke: 'collection.invite.revoke',
  collection_member_role_update: 'collection.member.role.update', collection_member_remove: 'collection.member.remove', collection_leave: 'collection.leave', collection_share_list: 'collection.share.list', collection_share_create: 'collection.share.create', collection_share_update: 'collection.share.update', collection_share_revoke: 'collection.share.revoke',
  collection_share_activate: 'collection.share.activate',
};

const definitions: Array<{
  operation: GalleryOperationName;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  mutation?: boolean;
}> = [
  { operation: 'overview', name: 'gallery_overview', description: 'List Gallery collections and a cursor page of recent images, optionally within one collection.', schema: z.object({ collectionKey: key.optional(), cursor: z.string().trim().min(1).max(2_000).optional(), limit: z.number().int().min(1).max(100).default(100) }).strict() },
  { operation: 'createCollection', name: 'gallery_collection_create', description: 'Create a Gallery collection.', schema: z.object({ name: z.string().trim().min(1).max(120), isFavorite: z.boolean().default(false) }).strict(), mutation: true },
  { operation: 'updateCollection', name: 'gallery_collection_update', description: 'Update a Gallery collection name and favorite state.', schema: z.object({ collectionKey: key, name: z.string().trim().min(1).max(120), isFavorite: z.boolean() }).strict(), mutation: true },
  { operation: 'deleteCollection', name: 'gallery_collection_delete', description: 'Delete a Gallery collection without deleting images that remain in Gallery.', schema: z.object({ collectionKey: key }).strict(), mutation: true },
  { operation: 'listMembers', name: 'collection_member_list', description: 'List collection members grouped by owner, collaborator, and viewer role.', schema: galleryOperationInputSchemas.listMembers },
  { operation: 'listPendingInvites', name: 'collection_invite_pending_list', description: 'List pending collection invitations relevant to the authenticated user.', schema: galleryOperationInputSchemas.listPendingInvites },
  { operation: 'createInvite', name: 'collection_invite_create', description: 'Invite a collaborator or viewer to a collection.', schema: galleryOperationInputSchemas.createInvite, mutation: true },
  { operation: 'acceptInvite', name: 'collection_invite_accept', description: 'Accept a collection invitation relevant to the authenticated user.', schema: galleryOperationInputSchemas.acceptInvite, mutation: true },
  { operation: 'rejectInvite', name: 'collection_invite_reject', description: 'Reject a collection invitation relevant to the authenticated user.', schema: galleryOperationInputSchemas.rejectInvite, mutation: true },
  { operation: 'revokeInvite', name: 'collection_invite_revoke', description: 'Revoke a pending collection invitation.', schema: galleryOperationInputSchemas.revokeInvite, mutation: true },
  { operation: 'updateMemberRole', name: 'collection_member_role_update', description: 'Set a collection member role to collaborator or viewer.', schema: galleryOperationInputSchemas.updateMemberRole, mutation: true },
  { operation: 'removeMember', name: 'collection_member_remove', description: 'Remove a non-owner member from a collection without deleting images.', schema: galleryOperationInputSchemas.removeMember, mutation: true },
  { operation: 'leaveCollection', name: 'collection_leave', description: 'Leave a collection without deleting images.', schema: galleryOperationInputSchemas.leaveCollection, mutation: true },
  { operation: 'listShares', name: 'collection_share_list', description: 'List global share links for a collection.', schema: galleryOperationInputSchemas.listShares },
  { operation: 'createShare', name: 'collection_share_create', description: 'Create a viewer or collaborator global share link for a collection.', schema: galleryOperationInputSchemas.createShare, mutation: true },
  { operation: 'updateShare', name: 'collection_share_update', description: 'Activate or deactivate a collection share link.', schema: galleryOperationInputSchemas.updateShare, mutation: true },
  { operation: 'revokeShare', name: 'collection_share_revoke', description: 'Revoke a collection share link.', schema: galleryOperationInputSchemas.revokeShare, mutation: true },
  { operation: 'activateShare', name: 'collection_share_activate', description: 'Activate a collection share token for the authenticated user.', schema: galleryOperationInputSchemas.activateShare, mutation: true },
  { operation: 'search', name: 'search_images', description: 'Search Gallery by visible content, a source image, or a saved visual identity, or find duplicates in a collection.', schema: imageSearchInputSchema },
  { operation: 'setFavorite', name: 'gallery_image_favorite', description: 'Set or clear an image favorite.', schema: z.object({ imageKey: key, isFavorite: z.boolean() }).strict(), mutation: true },
  { operation: 'updateImage', name: 'gallery_image_update', description: 'Update an image name and favorite state.', schema: z.object({ imageKey: key, name: z.string().trim().min(1).max(255), isFavorite: z.boolean() }).strict(), mutation: true },
  { operation: 'deleteImages', name: 'image_delete', description: 'Move Gallery images to trash and remove them from collections and subjects.', schema: z.object({ imageKeys: keys(100).refine((values) => new Set(values).size === values.length, 'Image keys must be unique') }).strict(), mutation: true },
  { operation: 'deleteDuplicates', name: 'gallery_duplicates_delete', description: 'Delete images returned by the latest duplicate check.', schema: z.object({ collectionKey: key, imageKeys: keys(500).refine((values) => new Set(values).size === values.length, 'Image keys must be unique') }).strict(), mutation: true },
  { operation: 'transferCollectionImages', name: 'gallery_collection_transfer', description: 'Copy or move selected images from one collection to one destination collection.', schema: z.object({ sourceCollectionKey: key, destinationCollectionKeys: keys(1), imageKeys: keys(100), mode: z.enum(['copy', 'move']) }).strict(), mutation: true },
  { operation: 'listSubjects', name: 'gallery_subject_list', description: 'List Gallery subjects, optionally including deleted subjects.', schema: z.object({ includeDeleted: z.boolean().default(false) }).strict() },
  { operation: 'createSubject', name: 'gallery_subject_create', description: 'Create a named subject from reference images.', schema: z.object({ name: z.string().trim().min(1).max(120), imageKeys: keys(8) }).strict(), mutation: true },
  { operation: 'listSubjectImages', name: 'gallery_subject_images', description: 'List images associated with a Gallery subject.', schema: z.object({ identityKey: key }).strict() },
  { operation: 'deleteSubject', name: 'gallery_subject_delete', description: 'Delete a Gallery subject.', schema: z.object({ identityKey: key }).strict(), mutation: true },
  { operation: 'restoreSubject', name: 'gallery_subject_restore', description: 'Restore a deleted Gallery subject.', schema: z.object({ identityKey: key }).strict(), mutation: true },
  { operation: 'reserveUploads', name: 'gallery_upload_reserve', description: 'Reserve JPEG uploads and return signed destinations. The user or client must upload the raw bytes.', schema: z.object({ collectionKey: key.nullable().optional(), files: z.array(z.object({ clientKey: z.string().min(1).max(120), filename: z.string().trim().regex(/^[^/\\]+\.jpe?g$/i), sizeBytes: z.number().int().positive().max(20 * 1024 * 1024) }).strict()).min(1).max(20) }).strict(), mutation: true },
  { operation: 'uploadStatus', name: 'gallery_upload_status', description: 'Read Gallery upload processing status.', schema: z.object({ uploadKeys: keys(20) }).strict() },
  { operation: 'completeUploads', name: 'gallery_upload_complete', description: 'Confirm user-mediated JPEG uploads and start processing.', schema: z.object({ uploadKeys: keys(20) }).strict(), mutation: true },
];

function trustedContext(context: AssistantCapabilityContext): GalleryOperationContext {
  const principal = context.domain.principal;
  if (principal.kind !== 'member') throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'A user session is required.');
  return {
    organizationKey: context.domain.organizationKey,
    scopeKey: context.domain.runtimeScopeKey,
    membership: principal.userOrganization,
    modelVisible: true,
    ...(context.requestKey ? { idempotencyKey: context.requestKey } : {}),
  };
}

export function createGalleryAssistantCapabilities(operations: Partial<Record<GalleryOperationName, GalleryExecutor>> = galleryOperations): AssistantCapability[] {
  return definitions.map(({ operation, name: configuredName, description, schema, mutation }) => {
    const name = toolNames[configuredName] ?? configuredName;
    return ({
    inputSchema: schema,
    ...(mutation ? { mutationWorkspace: 'gallery' as const } : {}),
    definition: { name, description, inputSchema: name === imageSearchTool.name ? imageSearchTool.providerDefinition.inputSchema : contentZodToJsonSchema(schema) },
    async execute(input, context) {
      const execute = context.gallery?.[operation] ?? operations[operation];
      if (!execute) throw new Error(`Gallery operation is unavailable: ${operation}`);
      const result = await execute(schema.parse(input), trustedContext(context));
      return { kind: 'continue', result: ['listShares', 'createShare', 'updateShare', 'revokeShare'].includes(operation) ? redactCollectionShareOutput(result) : result };
    },
    });
  });
}

export const galleryAssistantCapabilities = createGalleryAssistantCapabilities();
export const galleryAssistantCapabilityNames = galleryAssistantCapabilities.map(({ definition }) => definition.name);
