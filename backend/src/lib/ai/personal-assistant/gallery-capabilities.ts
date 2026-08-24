import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';
import { GalleryOperationError, galleryOperationInputSchemas, galleryOperations, redactCollectionShareOutput, type GalleryOperationContext, type GalleryOperationName } from '@/lib/gallery/operations';
import { nonTextImageSearchInputSchema, nonTextImageSearchProviderInputSchema } from '@/lib/ai/tools/image-search';
import { userHiddenOperations } from '@/lib/user-hiddens/operations';
import { createImageGenerationService, imageGenerateModelInputSchema, imageIdeasInputSchema, type ImageGenerationService } from '@/lib/image-generation/service';

type GalleryExecutor = (input: unknown, context: GalleryOperationContext) => Promise<unknown>;

const key = z.string().cuid();

const definitions: Array<{
  operation: GalleryOperationName;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  mutation?: boolean;
}> = [
  { operation: 'overview', name: 'collection.list', description: 'List Gallery collections and a cursor page of recent images, optionally within one collection and filtered by maximum compatible caption score; legacy migration placeholder scores are excluded.', schema: galleryOperationInputSchemas.overview },
  { operation: 'createCollection', name: 'collection.create', description: 'Create a Gallery collection.', schema: galleryOperationInputSchemas.createCollection, mutation: true },
  { operation: 'updateCollection', name: 'collection.update', description: 'Update a Gallery collection name, favorite state, and optional custom cover.', schema: galleryOperationInputSchemas.updateCollection, mutation: true },
  { operation: 'deleteCollection', name: 'collection.delete', description: 'Delete a non-favorite Gallery collection without deleting images that remain in Gallery. Favorite collections must be unfavorited first.', schema: galleryOperationInputSchemas.deleteCollection, mutation: true },
  { operation: 'listMembers', name: 'collection.member.list', description: 'List collection members grouped by owner, collaborator, and viewer role.', schema: galleryOperationInputSchemas.listMembers },
  { operation: 'listPendingInvites', name: 'collection.invite.pending.list', description: 'List pending collection invitations relevant to the authenticated user.', schema: galleryOperationInputSchemas.listPendingInvites },
  { operation: 'createInvite', name: 'collection.invite.create', description: 'Invite a collaborator or viewer to a collection.', schema: galleryOperationInputSchemas.createInvite, mutation: true },
  { operation: 'acceptInvite', name: 'collection.invite.accept', description: 'Accept a collection invitation relevant to the authenticated user.', schema: galleryOperationInputSchemas.acceptInvite, mutation: true },
  { operation: 'rejectInvite', name: 'collection.invite.reject', description: 'Reject a collection invitation relevant to the authenticated user.', schema: galleryOperationInputSchemas.rejectInvite, mutation: true },
  { operation: 'revokeInvite', name: 'collection.invite.revoke', description: 'Revoke a pending collection invitation.', schema: galleryOperationInputSchemas.revokeInvite, mutation: true },
  { operation: 'updateMemberRole', name: 'collection.member.role.update', description: 'Set a collection member role to collaborator or viewer.', schema: galleryOperationInputSchemas.updateMemberRole, mutation: true },
  { operation: 'removeMember', name: 'collection.member.remove', description: 'Remove a non-owner member from a collection without deleting images.', schema: galleryOperationInputSchemas.removeMember, mutation: true },
  { operation: 'leaveCollection', name: 'collection.leave', description: 'Leave a collection without deleting images.', schema: galleryOperationInputSchemas.leaveCollection, mutation: true },
  { operation: 'listShares', name: 'collection.share.list', description: 'List global share links for a collection.', schema: galleryOperationInputSchemas.listShares },
  { operation: 'createShare', name: 'collection.share.create', description: 'Create a viewer or collaborator global share link for a collection.', schema: galleryOperationInputSchemas.createShare, mutation: true },
  { operation: 'updateShare', name: 'collection.share.update', description: 'Activate or deactivate a collection share link.', schema: galleryOperationInputSchemas.updateShare, mutation: true },
  { operation: 'revokeShare', name: 'collection.share.revoke', description: 'Revoke a collection share link.', schema: galleryOperationInputSchemas.revokeShare, mutation: true },
  { operation: 'activateShare', name: 'collection.share.activate', description: 'Activate a collection share token for the authenticated user.', schema: galleryOperationInputSchemas.activateShare, mutation: true },
  { operation: 'search', name: 'image.search', description: 'Find Gallery images from a source image or saved visual identity, or find duplicates in a collection. Use app.search for text queries.', schema: nonTextImageSearchInputSchema },
  { operation: 'setFavorite', name: 'image.favorite', description: 'Set or clear an image favorite.', schema: galleryOperationInputSchemas.setFavorite, mutation: true },
  { operation: 'updateImage', name: 'image.update', description: 'Update an image name and favorite state.', schema: galleryOperationInputSchemas.updateImage, mutation: true },
  { operation: 'deleteImages', name: 'image.delete', description: 'Permanently delete non-favorite Gallery images and their dependent records. Favorite images are reported and left untouched.', schema: galleryOperationInputSchemas.deleteImages, mutation: true },
  { operation: 'deleteDuplicates', name: 'collection.duplicates.delete', description: 'Delete non-favorite images returned by the latest duplicate check. Favorite images are reported and left in the collection.', schema: galleryOperationInputSchemas.deleteDuplicates, mutation: true },
  { operation: 'transferCollectionImages', name: 'collection.image.transfer', description: 'Copy or move selected images from one collection to one destination collection.', schema: galleryOperationInputSchemas.transferCollectionImages, mutation: true },
  { operation: 'listSubjects', name: 'subject.list', description: 'List Gallery subjects.', schema: galleryOperationInputSchemas.listSubjects },
  { operation: 'createSubject', name: 'subject.create', description: 'Create a named subject from reference images.', schema: galleryOperationInputSchemas.createSubject, mutation: true },
  { operation: 'listSubjectImages', name: 'subject.image.list', description: 'List images associated with a Gallery subject.', schema: galleryOperationInputSchemas.listSubjectImages },
  { operation: 'deleteSubject', name: 'subject.delete', description: 'Delete a Gallery subject.', schema: galleryOperationInputSchemas.deleteSubject, mutation: true },
  { operation: 'createHighlight', name: 'highlight.create', description: 'Create an owner-managed persistent randomized image highlight for a collection, including an empty highlight when the collection has no images.', schema: galleryOperationInputSchemas.createHighlight, mutation: true },
  { operation: 'listHighlights', name: 'highlight.list', description: 'List accessible persistent image highlights with currently visible collection images.', schema: galleryOperationInputSchemas.listHighlights },
  { operation: 'readHighlight', name: 'highlight.read', description: 'Read one accessible persistent image highlight with currently visible collection images.', schema: galleryOperationInputSchemas.readHighlight },
  { operation: 'deleteHighlight', name: 'highlight.delete', description: 'Delete an owner-managed persistent image highlight without deleting its images.', schema: galleryOperationInputSchemas.deleteHighlight, mutation: true },
  { operation: 'createMemory', name: 'image.create-memory', description: 'Create a generated memory for one unused image in an owned collection.', schema: galleryOperationInputSchemas.createMemory, mutation: true },
  { operation: 'listMemories', name: 'image.memory.list', description: 'List image memories in an accessible collection.', schema: galleryOperationInputSchemas.listMemories },
  { operation: 'readMemory', name: 'image.memory.read', description: 'Read an accessible image memory.', schema: galleryOperationInputSchemas.readMemory },
  { operation: 'deleteMemory', name: 'image.memory.delete', description: 'Delete an image memory from an owned collection.', schema: galleryOperationInputSchemas.deleteMemory, mutation: true },
];

export const galleryAssistantMutationOperations = definitions.filter(({ mutation }) => mutation).map(({ operation }) => operation);

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

export function createGalleryAssistantCapabilities(operations: Partial<Record<GalleryOperationName, GalleryExecutor>> = galleryOperations, imageService: ImageGenerationService = createImageGenerationService()): AssistantCapability[] {
  const gallery: AssistantCapability[] = definitions.map(({ operation, name, description, schema, mutation }) => {
    return ({
    inputSchema: schema,
    ...(mutation ? { mutationWorkspace: 'gallery' as const } : {}),
    definition: { name, description, inputSchema: name === 'image.search' ? nonTextImageSearchProviderInputSchema : contentZodToJsonSchema(schema) },
    async execute(input: unknown, context: AssistantCapabilityContext) {
      const execute = context.gallery?.[operation] ?? operations[operation];
      if (!execute) throw new Error(`Gallery operation is unavailable: ${operation}`);
      const result = await execute(schema.parse(input), trustedContext(context));
      return { kind: 'continue' as const, result: ['listShares', 'createShare', 'updateShare', 'revokeShare'].includes(operation) ? redactCollectionShareOutput(result) : result };
    },
    });
  });
  const hidden = (['collection', 'image'] as const).flatMap((source) => (['hide', 'reveal'] as const).map((operation): AssistantCapability => ({
    inputSchema: z.object({ sourceKey: key }).strict(),
    mutationWorkspace: 'gallery',
    definition: { name: `${source}.${operation}`, description: `${operation === 'hide' ? 'Hide' : 'Reveal'} an accessible Gallery ${source} for the current user.`, inputSchema: contentZodToJsonSchema(z.object({ sourceKey: key }).strict()) },
    async execute(input, context) {
      const parsed = z.object({ sourceKey: key }).strict().parse(input);
      const principal = context.domain.principal;
      if (principal.kind !== 'member') throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'A user session is required.');
      const result = await userHiddenOperations[operation]({ source, sourceKey: parsed.sourceKey }, { userKey: principal.user.key, organizationKey: context.domain.organizationKey, membershipKey: principal.userOrganization.key, service: context.userHiddens });
      return { kind: 'continue', result };
    },
  })));
  const generated: AssistantCapability[] = [
    {
      inputSchema: imageIdeasInputSchema,
      definition: { name: 'image.ideas.create', description: 'Create distinct, production-ready image concepts and complete generation prompts from a creative brief.', inputSchema: contentZodToJsonSchema(imageIdeasInputSchema) },
      async execute(input, context) { return { kind: 'continue', result: await (context.images ?? imageService).createIdeas(imageIdeasInputSchema.parse(input), context.domain) }; },
    },
    {
      inputSchema: imageGenerateModelInputSchema,
      mutationWorkspace: 'gallery',
      definition: { name: 'image.generate', description: 'Generate images and save them into the current user Gallery scope. Use default mode for maximum quality or fast mode for low-latency generation.', inputSchema: contentZodToJsonSchema(imageGenerateModelInputSchema) },
      async execute(input, context) { return { kind: 'continue', result: await (context.images ?? imageService).generate(imageGenerateModelInputSchema.parse(input), context.domain, context.requestKey) }; },
    },
  ];
  return [...gallery, ...hidden, ...generated];
}

export const galleryAssistantCapabilities = createGalleryAssistantCapabilities();
export const galleryAssistantCapabilityNames = galleryAssistantCapabilities.map(({ definition }) => definition.name);
