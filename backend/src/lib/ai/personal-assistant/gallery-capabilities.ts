import { z } from 'zod';
import { contentZodToJsonSchema } from '@/lib/ai/tools/content-json-schema';
import type { AssistantCapability, AssistantCapabilityContext } from './capabilities';
import { GalleryOperationError, galleryOperations, type GalleryOperationContext, type GalleryOperationName } from '@/lib/gallery/operations';

type GalleryExecutor = (input: unknown, context: GalleryOperationContext) => Promise<unknown>;

const key = z.string().cuid();
const keys = (maxItems: number) => z.array(key).min(1).max(maxItems);

const definitions: Array<{
  operation: GalleryOperationName;
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  mutation?: boolean;
}> = [
  { operation: 'overview', name: 'gallery_overview', description: 'List Gallery collections and recent images, optionally within one collection.', schema: z.object({ collectionKey: key.optional() }).strict() },
  { operation: 'createCollection', name: 'gallery_collection_create', description: 'Create a Gallery collection.', schema: z.object({ name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(1_000).optional() }).strict(), mutation: true },
  { operation: 'search', name: 'search_images', description: 'Search Gallery by visible content or find images visually similar to one image.', schema: z.object({ query: z.string().trim().min(1).max(12_000).optional(), imageKey: key.optional(), threshold: z.number().min(-1).max(1).optional(), limit: z.number().int().min(1).max(50).default(50) }).strict().refine((value) => Boolean(value.query) !== Boolean(value.imageKey), 'Provide exactly one of query or imageKey') },
  { operation: 'setFavorite', name: 'gallery_image_favorite', description: 'Set or clear an image favorite.', schema: z.object({ imageKey: key, isFavorite: z.boolean() }).strict(), mutation: true },
  { operation: 'findDuplicates', name: 'gallery_duplicates_find', description: 'Find redundant images in a collection.', schema: z.object({ collectionKey: key }).strict() },
  { operation: 'deleteDuplicates', name: 'gallery_duplicates_delete', description: 'Delete images returned by the latest duplicate check.', schema: z.object({ collectionKey: key, imageKeys: keys(500) }).strict(), mutation: true },
  { operation: 'transferCollectionImages', name: 'gallery_collection_transfer', description: 'Copy or move selected images from one collection to other collections.', schema: z.object({ sourceCollectionKey: key, destinationCollectionKeys: keys(20), imageKeys: keys(100), mode: z.enum(['copy', 'move']) }).strict(), mutation: true },
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
  };
}

export function createGalleryAssistantCapabilities(operations: Partial<Record<GalleryOperationName, GalleryExecutor>> = galleryOperations): AssistantCapability[] {
  return definitions.map(({ operation, name, description, schema, mutation }) => ({
    inputSchema: schema,
    ...(mutation ? { mutationWorkspace: 'gallery' as const } : {}),
    definition: { name, description, inputSchema: contentZodToJsonSchema(schema) },
    async execute(input, context) {
      const execute = context.gallery?.[operation] ?? operations[operation];
      if (!execute) throw new Error(`Gallery operation is unavailable: ${operation}`);
      return { kind: 'continue', result: await execute(schema.parse(input), trustedContext(context)) };
    },
  }));
}

export const galleryAssistantCapabilities = createGalleryAssistantCapabilities();
export const galleryAssistantCapabilityNames = galleryAssistantCapabilities.map(({ definition }) => definition.name);
