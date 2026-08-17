import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z, ZodError } from 'zod';
import { collectionSchema } from '@/lib/db/collections.node';
import { collectionMemberSchema } from '@/lib/db/collection-members.node';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { galleryUploadSchema, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { imageSchema } from '@/lib/db/images.node';
import { visualIdentitySchema } from '@/lib/db/visual-identities.node';
import { imageIdentitySchema } from '@/lib/db/image-identities.node';
import type { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import { ImageProcessingError, processImage } from '@/lib/ai/image-processing';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { imageSearchInputSchema, imageSearchTool } from '@/lib/ai/tools/image-search';
import { imageCreateVisualIdentityTool } from '@/lib/ai/tools/image-create-visual-identity';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { EMBEDDING_DIMENSIONS, currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { getDefaultGalleryRepository } from './repository';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { strictObject } from '@/api/validation';
import { signedImageUrl } from './image-url';
import { getDefaultUserSearchService } from '@/lib/user-searches/service';

const overviewSchema = strictObject({ collectionKey: z.string().cuid().optional() });
const collectionCreateSchema = strictObject({ name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(1_000).optional() });
const uploadFileSchema = strictObject({ clientKey: z.string().min(1).max(120), filename: z.string().trim().regex(/^[^/\\]+\.jpe?g$/i), sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), processingMode: z.enum(['library', 'cover']).default('library') });
const presignSchema = strictObject({ collectionKey: z.string().cuid().nullable().optional(), files: z.array(uploadFileSchema).min(1).max(20) });
const completeSchema = strictObject({ uploadKeys: z.array(z.string().cuid()).min(1).max(20) });
const searchSchema = imageSearchInputSchema;
const statusSchema = strictObject({ uploadKeys: z.array(z.string().cuid()).min(1).max(20) });
const favoriteSchema = strictObject({ imageKey: z.string().cuid(), isFavorite: z.boolean() });
const deleteImagesSchema = strictObject({ imageKeys: z.array(z.string().cuid()).min(1).max(100) }).refine(({ imageKeys }) => new Set(imageKeys).size === imageKeys.length, 'Image keys must be unique');
const duplicatesSchema = strictObject({ collectionKey: z.string().cuid() });
const deleteDuplicatesSchema = strictObject({ collectionKey: z.string().cuid(), imageKeys: z.array(z.string().cuid()).min(1).max(500) });
const subjectListSchema = strictObject({ includeDeleted: z.boolean().default(false) });
const subjectCreateSchema = strictObject({ name: z.string().trim().min(1).max(120), imageKeys: z.array(z.string().cuid()).min(1).max(8) }).refine(({ imageKeys }) => new Set(imageKeys).size === imageKeys.length, 'Reference image keys must be unique');
const subjectKeySchema = strictObject({ identityKey: z.string().cuid() });
const collectionTransferSchema = strictObject({
  sourceCollectionKey: z.string().cuid(),
  destinationCollectionKeys: z.array(z.string().cuid()).min(1).max(20),
  imageKeys: z.array(z.string().cuid()).min(1).max(100),
  mode: z.enum(['copy', 'move']),
}).superRefine((value, context) => {
  if (new Set(value.destinationCollectionKeys).size !== value.destinationCollectionKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Destination collection keys must be unique.', path: ['destinationCollectionKeys'] });
  if (new Set(value.imageKeys).size !== value.imageKeys.length) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Image keys must be unique.', path: ['imageKeys'] });
  if (value.destinationCollectionKeys.includes(value.sourceCollectionKey)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'The source collection cannot be a destination.', path: ['destinationCollectionKeys'] });
});

type GalleryMembership = NonNullable<Awaited<ReturnType<typeof getUserOrganizationByOrganizationAndUser>>>;
const repository = getDefaultGalleryRepository();
const publicS3 = createPublicS3Client();
// Bun can retain duplicate Smithy type packages across AWS SDK clients even when
// the runtime SDK versions are aligned. Keep that package-only mismatch local.
const signUrl = getSignedUrl as unknown as (
  client: S3Client,
  command: PutObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export interface GalleryOperationContext {
  organizationKey: string;
  scopeKey: string;
  membership: GalleryMembership;
  signal?: AbortSignal;
  recordUserSearch?: (userKey: string, query: string) => Promise<unknown>;
}

async function authorize(context: GalleryOperationContext) {
  if (context.membership.organizationId !== context.organizationKey || context.membership.status !== 'active' || !await repository.canManageScope(context.scopeKey, context.membership.key)) throw new GalleryOperationError(403, 'GALLERY_FORBIDDEN', 'Gallery scope access denied.');
  return context.membership;
}

export class GalleryOperationError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 500, readonly code: string, message: string) { super(message); }
}

export function normalizeGalleryOperationError(error: unknown) {
  if (error instanceof GalleryOperationError) return error;
  if (error instanceof ZodError || error instanceof SyntaxError) return new GalleryOperationError(400, 'GALLERY_INVALID_INPUT', 'Gallery request input was invalid.');
  return new GalleryOperationError(500, 'GALLERY_FAILED', 'Gallery request failed.');
}

const imageUrl = signedImageUrl;

async function safeImage(image: z.infer<typeof imageSchema>, score?: number) {
  return {
    key: image.key, filename: image.filename, caption: image.caption, imageCaptionKey: image.imageCaptionKey ?? null,
    mimeType: image.mimeType, sizeBytes: image.sizeBytes, width: image.width, height: image.height,
    isFavorite: image.isFavorite, createdAt: image.createdAt, updatedAt: image.updatedAt,
    url: await imageUrl(image.storageKey), ...(score === undefined ? {} : { score }),
  };
}

async function persistIdentityMatches(scopeKey: string, identityKey: string, matches: Array<{ imageKey: string; confidence: number }>) {
  await repository.persistIdentityMatches(scopeKey, identityKey, matches);
}

async function reconcileVisualIdentity(identity: z.infer<typeof visualIdentitySchema>, organizationKey: string, actorKey: string) {
  const matches = await repository.searchAccessibleImages({ organizationKey, scopeKey: identity.scopeKey, actorKey, embedding: identity.embedding, threshold: 0.82, limit: 50 });
  await persistIdentityMatches(identity.scopeKey, identity.key, matches.map(({ image, score }) => ({ imageKey: image.key, confidence: score })));
}

async function classifyImageSubjects(image: z.infer<typeof imageSchema>) {
  const matches = await repository.listIdentityMatches(image.scopeKey, image.embedding);
  for (const match of matches) await persistIdentityMatches(image.scopeKey, match.identityKey, [{ imageKey: image.key, confidence: match.confidence }]);
}

async function safeSubject(row: { identity: z.infer<typeof visualIdentitySchema>; reference: z.infer<typeof imageSchema>; imageCount: number }) {
  const { identity, reference } = row;
  return {
    key: identity.key, name: identity.name, description: identity.description, referenceImageKey: identity.referenceImageKey,
    referenceUrl: await imageUrl(reference.storageKey), imageCount: row.imageCount, deletedAt: identity.deletedAt,
    createdAt: identity.createdAt, updatedAt: identity.updatedAt,
  };
}

async function processReservedUpload(upload: GalleryUpload) {
  try {
    await repository.updateUpload(upload.key, { status: 'processing', updatedAt: new Date().toISOString() });
    const stored = await documentStorage.download(upload.storageKey);
    if (stored.bytes.byteLength !== upload.sizeBytes) throw new Error('Uploaded image size changed.');
    const sourceUrl = upload.processingMode === 'library' ? await imageUrl(upload.storageKey) : undefined;
    const image = await processImage({ scopeKey: upload.scopeKey, ownerKey: upload.actorKey, file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, bytes: stored.bytes } }, {
      createKey: () => upload.imageKey,
      caption: upload.processingMode === 'cover'
        ? async () => 'Folder cover image.'
        : async () => (await imageCaptionTool.execute({ imageUrls: [sourceUrl!] }, { organizationKey: upload.organizationKey })).captions[0]!,
      ...(upload.processingMode === 'cover' ? { embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0) } : {}),
    });
    // Subject reads reconcile again, so a transient classification failure does not fail an otherwise valid upload.
    await classifyImageSubjects(image).catch(() => undefined);
    if (upload.collectionKey) await repository.addImageToCollection(collectionImageSchema.parse({ key: newId(), scopeKey: upload.scopeKey, collectionKey: upload.collectionKey, imageKey: image.key, addedByKey: upload.actorKey, createdAt: new Date().toISOString() }));
    await documentStorage.delete(upload.storageKey).catch(() => undefined);
    await repository.updateUpload(upload.key, { status: 'completed', updatedAt: new Date().toISOString(), errorCode: null });
  } catch (error) {
    const errorCode = error instanceof ImageProcessingError ? error.code : 'IMAGE_PROCESSING_FAILED';
    console.error('gallery upload processing failed', { uploadKey: upload.key, imageKey: upload.imageKey, errorCode, error });
    await repository.updateUpload(upload.key, { status: 'failed', errorCode, updatedAt: new Date().toISOString() }).catch(() => undefined);
  }
}

async function overview(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...overviewSchema.parse(rawInput), ...context };
    await authorize(context);
    const { collections, images } = await repository.listOverview(input.scopeKey, input.collectionKey);
    return {
      collections: await Promise.all(collections.map(async ({ collection, count, cover }) => ({ key: collection.key, name: collection.name, description: collection.description ?? null, count, coverUrl: cover ? await imageUrl(cover.storageKey) : null }))),
      images: await Promise.all(images.map((image) => safeImage(image))),
    };
}

async function createCollection(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...collectionCreateSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const now = new Date().toISOString();
    const collection = collectionSchema.parse({ key: newId(), scopeKey: input.scopeKey, name: input.name, ...(input.description ? { description: input.description } : {}), embedding: currentEmbeddingSchema.parse(await embedText({ text: `${input.name}\n\n${input.description ?? ''}` })), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
    const member = collectionMemberSchema.parse({ key: newId(), scopeKey: input.scopeKey, collectionKey: collection.key, memberKey: membership.key, role: 'owner', createdAt: now });
    await repository.createCollection(collection, member);
    return { key: collection.key, name: collection.name, description: collection.description ?? null, count: 0, coverUrl: null };
}

async function reserveUploads(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...presignSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    if (input.collectionKey) { const collection = await repository.getCollection(input.scopeKey, input.collectionKey); if (!collection) throw new GalleryOperationError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.'); }
    const now = new Date();
    const uploads = await Promise.all(input.files.map(async (file) => {
      const key = newId(), imageKey = newId();
      const storageKey = `pending/gallery/${input.scopeKey}/${key}/original.jpg`;
      const record = galleryUploadSchema.parse({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, imageKey, collectionKey: input.collectionKey ?? null, filename: file.filename.replace(/\.jpeg$/i, '.jpg'), mimeType: 'image/jpeg', sizeBytes: file.sizeBytes, storageKey, processingMode: file.processingMode, status: 'reserved', errorCode: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() });
      await repository.insertUpload(record);
      const url = await signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: storageKey, ContentType: 'image/jpeg' }), { expiresIn: 10 * 60 });
      return { clientKey: file.clientKey, uploadKey: key, imageKey, url, headers: { 'Content-Type': 'image/jpeg' } };
    }));
    return { uploads };
}

async function completeUploads(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...completeSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const uploads = await Promise.all(input.uploadKeys.map(async (key) => {
      const upload = await repository.getUpload(key);
      if (!upload || upload.scopeKey !== input.scopeKey || upload.organizationKey !== input.organizationKey || upload.actorKey !== membership.key) throw new GalleryOperationError(404, 'GALLERY_UPLOAD_NOT_FOUND', 'Upload reservation not found.');
      if (upload.status === 'completed' || upload.status === 'queued' || upload.status === 'processing') return upload;
      if (Date.parse(upload.expiresAt) <= Date.now()) throw new GalleryOperationError(409, 'GALLERY_UPLOAD_EXPIRED', 'Upload reservation expired.');
      const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: upload.storageKey }));
      if (head.ContentLength !== upload.sizeBytes || head.ContentType !== 'image/jpeg') throw new GalleryOperationError(409, 'GALLERY_UPLOAD_MISMATCH', 'Uploaded image does not match its reservation.');
      return repository.updateUpload(upload.key, { status: 'queued', updatedAt: new Date().toISOString(), errorCode: null });
    }));
    for (const upload of uploads) if (upload.status === 'queued') void processReservedUpload(upload);
    return { jobs: uploads.map(({ key, imageKey, status }) => ({ key, imageKey, status })) };
}

async function uploadStatus(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...statusSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const uploads = await Promise.all(input.uploadKeys.map((key) => repository.getUpload(key)));
    if (uploads.some((upload) => !upload || upload.organizationKey !== input.organizationKey || upload.scopeKey !== input.scopeKey || upload.actorKey !== membership.key)) throw new GalleryOperationError(404, 'GALLERY_UPLOAD_NOT_FOUND', 'Upload reservation not found.');
    return { jobs: uploads.map((upload) => ({ key: upload!.key, imageKey: upload!.imageKey, status: upload!.status, errorCode: upload!.errorCode })) };
}

async function search(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...searchSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const collection = input.collectionKey ? await repository.getCollection(input.scopeKey, input.collectionKey) : undefined;
    if (input.collectionKey && !collection) throw new GalleryOperationError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.');
    let sourceImage: z.infer<typeof imageSchema> | undefined;
    if ('imageKey' in input) {
      sourceImage = await repository.getImage(input.imageKey) ?? undefined;
      if (!sourceImage || sourceImage.scopeKey !== input.scopeKey || !await repository.canAccessImage(input.scopeKey, sourceImage.key, membership.key)) throw new GalleryOperationError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
    }
    const toolInput = searchSchema.parse(rawInput);
    const resolvedImages = new Map<string, z.infer<typeof imageSchema>>();
    if (sourceImage) resolvedImages.set(sourceImage.key, sourceImage);
    const output = await imageSearchTool.execute(toolInput, {
      context: { organizationKey: input.organizationKey, runtimeScopeKey: input.scopeKey, principal: { kind: 'member', user: { key: membership.userId }, userOrganization: membership, scopeMember: null } as never },
      searchImages: async (searchInput) => {
        const results = await repository.searchAccessibleImages(searchInput);
        for (const result of results) resolvedImages.set(result.image.key, result.image);
        return results;
      },
      getImage: async (key) => resolvedImages.get(key) ?? repository.getImage(key),
      canAccessImage: async () => true,
      canAccessCollection: async () => true,
      getCollection: async () => collection ?? null,
      findDuplicateImages: async (scopeKey, collectionKey) => {
        const images = await repository.listRedundantCollectionImages(scopeKey, collectionKey);
        for (const image of images) resolvedImages.set(image.key, image);
        return images;
      },
    });
    let matches: Array<{ image: z.infer<typeof imageSchema>; score?: number }> = await Promise.all(output.images.map(async ({ key, score }) => {
      const image = resolvedImages.get(key) ?? await repository.getImage(key);
      if (!image) throw new GalleryOperationError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
      return { image, score };
    }));
    if ('query' in input) {
      const namedIdentities = await repository.listMatchingIdentityNames(input.scopeKey, input.query);
      await Promise.all(namedIdentities.map((identity) => reconcileVisualIdentity(identity, input.organizationKey, membership.key)));
      const named = await repository.listImagesForMatchingIdentityNames(input.scopeKey, input.query, input.collectionKey);
      const unique = new Map<string, { image: z.infer<typeof imageSchema>; score?: number }>(named.map((match) => [match.image.key, match]));
      for (const match of matches) if (!unique.has(match.image.key)) unique.set(match.image.key, match);
      matches = [...unique.values()].slice(0, input.limit);
    }
    const images = await Promise.all(matches.map(({ image, score }) => safeImage(image, score)));
    if ('query' in input && input.recordHistory) await (context.recordUserSearch ?? getDefaultUserSearchService().record)(membership.userId, input.query);
    return { images };
}

async function setFavorite(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...favoriteSchema.parse(rawInput), ...context };
    await authorize(context);
    const image = await repository.setImageFavorite(input.scopeKey, input.imageKey, input.isFavorite, new Date().toISOString());
    if (!image) throw new GalleryOperationError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
    return { image: await safeImage(image) };
}

async function deleteImages(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...deleteImagesSchema.parse(rawInput), ...context };
    await authorize(context);
    const deletion = await repository.deleteImages(input.scopeKey, input.imageKeys, new Date().toISOString());
    if (!deletion) throw new GalleryOperationError(404, 'GALLERY_IMAGE_NOT_FOUND', 'One or more images were not found.');
    return deletion;
}

async function findDuplicates(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...duplicatesSchema.parse(rawInput), ...context };
    return search({ duplicates: true, collectionKey: input.collectionKey }, context);
}

async function deleteDuplicates(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...deleteDuplicatesSchema.parse(rawInput), ...context };
    await authorize(context);
    if (!await repository.getCollection(input.scopeKey, input.collectionKey)) throw new GalleryOperationError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.');
    const now = new Date().toISOString();
    const deletion = await repository.deleteDuplicateImages(input.scopeKey, input.collectionKey, input.imageKeys, now);
    if (!deletion) throw new GalleryOperationError(409, 'GALLERY_DUPLICATES_CHANGED', 'The duplicate set changed. Find duplicates again before deleting.');
    return deletion;
}

async function transferCollectionImages(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...collectionTransferSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const now = new Date().toISOString();
    const transfer = await repository.transferCollectionImages({ scopeKey: input.scopeKey, actorKey: membership.key, sourceCollectionKey: input.sourceCollectionKey, destinationCollectionKeys: input.destinationCollectionKeys, imageKeys: input.imageKeys, mode: input.mode, now });
    if (transfer.status === 'selection-changed') throw new GalleryOperationError(409, 'GALLERY_SELECTION_CHANGED', 'One or more selected images are no longer in the source collection.');
    if (transfer.status === 'destination-forbidden') throw new GalleryOperationError(403, 'GALLERY_DESTINATION_FORBIDDEN', 'Destination collection membership is required.');
    if (transfer.status !== 'ok') throw new GalleryOperationError(500, 'GALLERY_FAILED', 'Gallery request failed.');
    return { mode: input.mode, imageKeys: input.imageKeys, destinationCollectionKeys: input.destinationCollectionKeys, createdRelationCount: transfer.createdRelationCount };
}

async function listSubjects(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...subjectListSchema.parse(rawInput), ...context };
    await authorize(context);
    const rows = await repository.listSubjects(input.scopeKey, input.includeDeleted);
    return { subjects: await Promise.all(rows.map((row) => safeSubject(row))) };
}

async function createSubject(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...subjectCreateSchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const references = await Promise.all(input.imageKeys.map(async (key) => {
      const image = await repository.getImage(key);
      if (!image || image.scopeKey !== input.scopeKey || image.deletedAt) throw new GalleryOperationError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Reference image not found.');
      return image;
    }));
    const profile = await imageCreateVisualIdentityTool.execute({ imageUrls: await Promise.all(references.map(({ storageKey }) => imageUrl(storageKey))) }, { organizationKey: input.organizationKey, signal: context.signal });
    const now = new Date().toISOString();
    const embedding = currentEmbeddingSchema.parse(await embedText({ text: `${input.name}\n\n${profile.description}` }));
    const identity = visualIdentitySchema.parse({ key: newId(), scopeKey: input.scopeKey, name: input.name, description: profile.description, referenceImageKey: references[0]!.key, embedding, deletedAt: null, createdAt: now, updatedAt: now });
    const matches = await repository.searchAccessibleImages({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, embedding, threshold: 0.82, limit: 50 });
    const confidence = new Map(matches.map(({ image, score }) => [image.key, score]));
    for (const reference of references) confidence.set(reference.key, 1);
    const referenceKeys = new Set(references.map(({ key }) => key));
    const relations = [...confidence].map(([imageKey, score]) => imageIdentitySchema.parse({ key: newId(), scopeKey: input.scopeKey, imageKey, identityKey: identity.key, confidence: score, isReference: referenceKeys.has(imageKey), createdAt: now }));
    if (!await repository.createSubject(identity, relations, input.imageKeys)) throw new GalleryOperationError(409, 'GALLERY_REFERENCES_CHANGED', 'A reference image changed before the Subject was created.');
    const row = await repository.getSubject(input.scopeKey, identity.key, false);
    if (!row) throw new GalleryOperationError(500, 'GALLERY_SUBJECT_FAILED', 'Subject could not be read after creation.');
    return { subject: await safeSubject(row) };
}

async function listSubjectImages(rawInput: unknown, context: GalleryOperationContext) {
    const input = { ...subjectKeySchema.parse(rawInput), ...context };
    const membership = await authorize(context);
    const row = await repository.getSubject(input.scopeKey, input.identityKey, false);
    if (!row) throw new GalleryOperationError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject not found.');
    await reconcileVisualIdentity(row.identity, input.organizationKey, membership.key);
    const rows = await repository.listSubjectImages(input.scopeKey, input.identityKey);
    return { images: await Promise.all(rows.map(({ image, confidence }) => safeImage(image, confidence))) };
}

async function setSubjectDeleted(rawInput: unknown, context: GalleryOperationContext, deleted: boolean) {
    const input = { ...subjectKeySchema.parse(rawInput), ...context };
    await authorize(context);
    const now = new Date().toISOString();
    const value = await repository.setSubjectDeleted(input.scopeKey, input.identityKey, deleted, now);
    if (!value) throw new GalleryOperationError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject not found.');
    const row = await repository.getSubject(input.scopeKey, input.identityKey, true);
    if (!row) throw new GalleryOperationError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject reference image is unavailable.');
    return { subject: await safeSubject(row) };
}

const deleteSubject = (input: unknown, context: GalleryOperationContext) => setSubjectDeleted(input, context, true);
const restoreSubject = (input: unknown, context: GalleryOperationContext) => setSubjectDeleted(input, context, false);

export const galleryOperationInputSchemas = {
  overview: overviewSchema,
  createCollection: collectionCreateSchema,
  reserveUploads: presignSchema,
  completeUploads: completeSchema,
  uploadStatus: statusSchema,
  search: searchSchema,
  setFavorite: favoriteSchema,
  deleteImages: deleteImagesSchema,
  findDuplicates: duplicatesSchema,
  deleteDuplicates: deleteDuplicatesSchema,
  transferCollectionImages: collectionTransferSchema,
  listSubjects: subjectListSchema,
  createSubject: subjectCreateSchema,
  listSubjectImages: subjectKeySchema,
  deleteSubject: subjectKeySchema,
  restoreSubject: subjectKeySchema,
} as const;

export const galleryOperations = {
  overview,
  createCollection,
  reserveUploads,
  completeUploads,
  uploadStatus,
  search,
  setFavorite,
  deleteImages,
  findDuplicates,
  deleteDuplicates,
  transferCollectionImages,
  listSubjects,
  createSubject,
  listSubjectImages,
  deleteSubject,
  restoreSubject,
} as const;

export type GalleryOperationName = keyof typeof galleryOperations;
