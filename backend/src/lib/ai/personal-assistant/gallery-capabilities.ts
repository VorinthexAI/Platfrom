import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';
import { GalleryOperationError, galleryOperationInputSchemas, galleryOperations, type GalleryOperationContext, type GalleryOperationName } from '@/lib/gallery/operations';
import { nonTextImageSearchInputSchema, nonTextImageSearchProviderInputSchema } from '@/lib/ai/tools/image-search';
import { userHiddenOperations } from '@/lib/user-hiddens/operations';
import { createImageGenerationService, imageGenerateModelInputSchema, imageGenerationHistoryDeleteInputSchema, imageGenerationHistoryListInputSchema, imageIdeasInputSchema, type ImageGenerationService } from '@/lib/image-generation/service';

type GalleryExecutor = (input: unknown, context: GalleryOperationContext) => Promise<unknown>;

const key = z.string().cuid();

const definitions: Array<{
  operation: GalleryOperationName;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  mutation?: boolean;
}> = [
  { operation: 'overview', name: 'collection.list', description: 'List Gallery collections and a cursor page of recent images, optionally within one collection and filtered by maximum compatible caption score; legacy migration placeholder scores are excluded. Use only for total counts, exhaustive inventories, or listing metadata; when the user wants to find or show specific collections, use app.search with the "collections" slug instead.', schema: galleryOperationInputSchemas.overview },
  { operation: 'createCollection', name: 'collection.create', description: 'Create a Gallery collection.', schema: galleryOperationInputSchemas.createCollection, mutation: true },
  { operation: 'updateCollection', name: 'collection.update', description: 'Update a Gallery collection name, favorite state, and optional custom cover.', schema: galleryOperationInputSchemas.updateCollection, mutation: true },
  { operation: 'deleteCollection', name: 'collection.delete', description: 'Delete a non-favorite Gallery collection without deleting images that remain in Gallery. Favorite collections must be unfavorited first.', schema: galleryOperationInputSchemas.deleteCollection, mutation: true },
  { operation: 'search', name: 'image.search', description: 'Find Gallery images from a source image or saved visual identity, or find duplicates in a collection. Use app.search for text queries.', schema: nonTextImageSearchInputSchema },
  { operation: 'setFavorite', name: 'image.favorite', description: 'Set or clear an image favorite.', schema: galleryOperationInputSchemas.setFavorite, mutation: true },
  { operation: 'updateImage', name: 'image.update', description: 'Update an image name and favorite state.', schema: galleryOperationInputSchemas.updateImage, mutation: true },
  { operation: 'deleteImages', name: 'image.delete', description: 'Permanently delete non-favorite Gallery images and their dependent records. Favorite images are reported and left untouched.', schema: galleryOperationInputSchemas.deleteImages, mutation: true },
  { operation: 'deleteDuplicates', name: 'collection.duplicates.delete', description: 'Delete non-favorite images returned by the latest duplicate check. Favorite images are reported and left in the collection.', schema: galleryOperationInputSchemas.deleteDuplicates, mutation: true },
  { operation: 'transferCollectionImages', name: 'collection.image.transfer', description: 'Copy or move selected images from one collection to one destination collection.', schema: galleryOperationInputSchemas.transferCollectionImages, mutation: true },
  { operation: 'listSubjects', name: 'subject.list', description: 'List Gallery subjects.', schema: galleryOperationInputSchemas.listSubjects },
  { operation: 'createSubject', name: 'visual-identity.create', description: 'Create a named visual identity from reference images.', schema: galleryOperationInputSchemas.createSubject, mutation: true },
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
    teamKey: context.domain.teamKey,
    scopeKey: context.domain.runtimeScopeKey,
    membership: principal.userTeam,
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
      return { kind: 'continue' as const, result };
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
      const result = await userHiddenOperations[operation]({ source, sourceKey: parsed.sourceKey }, { userKey: principal.user.key, teamKey: context.domain.teamKey, teamMembershipKey: principal.userTeam.key, service: context.userHiddens });
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
      definition: { name: 'image.generate', description: 'Generate images and save them into an authorized Gallery collection, optionally using accessible reference images.', inputSchema: contentZodToJsonSchema(imageGenerateModelInputSchema) },
      async execute(input, context) { return { kind: 'continue', result: await (context.images ?? imageService).generate(imageGenerateModelInputSchema.parse(input), context.domain, context.requestKey) }; },
    },
    {
      inputSchema: imageGenerationHistoryListInputSchema,
      definition: { name: 'image.generation-history.list', description: 'List the authenticated user\'s recent image-generation prompts.', inputSchema: contentZodToJsonSchema(imageGenerationHistoryListInputSchema) },
      async execute(input, context) { return { kind: 'continue', result: await (context.images ?? imageService).listHistory(input, context.domain) }; },
    },
    {
      inputSchema: imageGenerationHistoryDeleteInputSchema,
      mutationWorkspace: 'gallery',
      definition: { name: 'image.generation-history.delete', description: 'Delete one matching image-generation prompt from the authenticated user\'s history.', inputSchema: contentZodToJsonSchema(imageGenerationHistoryDeleteInputSchema) },
      async execute(input, context) { return { kind: 'continue', result: await (context.images ?? imageService).deleteHistory(input, context.domain) }; },
    },
  ];
  return [...gallery, ...hidden, ...generated];
}

export const galleryAssistantCapabilities = createGalleryAssistantCapabilities();
export const galleryAssistantCapabilityNames = galleryAssistantCapabilities.map(({ definition }) => definition.name);
