import type { Context } from 'hono';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z, ZodError } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { collectionSchema } from '@/lib/db/collections.node';
import { collectionMemberSchema } from '@/lib/db/collection-members.node';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { galleryUploadSchema, getGalleryUploadById, insertGalleryUpload, updateGalleryUpload, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { getImageById, imageSchema } from '@/lib/db/images.node';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import { createMediaLibraryRepository, searchAccessibleImages } from '@/lib/media-library';
import { processImage } from '@/lib/ai/image-processing';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { imageSearchTool } from '@/lib/ai/tools/image-search';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { getAuthIdentity } from './security';
import { strictObject } from './validation';

const contextSchema = { organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid() };
const overviewSchema = strictObject({ ...contextSchema, collectionKey: z.string().cuid().optional() });
const collectionCreateSchema = strictObject({ ...contextSchema, name: z.string().trim().min(1).max(120), description: z.string().trim().min(1).max(1_000).optional() });
const uploadFileSchema = strictObject({ clientKey: z.string().min(1).max(120), filename: z.string().trim().regex(/^[^/\\]+\.jpe?g$/i), sizeBytes: z.number().int().positive().max(20 * 1024 * 1024) });
const presignSchema = strictObject({ ...contextSchema, collectionKey: z.string().cuid().nullable().optional(), files: z.array(uploadFileSchema).min(1).max(20) });
const completeSchema = strictObject({ ...contextSchema, uploadKeys: z.array(z.string().cuid()).min(1).max(20) });
const searchSchema = strictObject({ ...contextSchema, query: z.string().trim().min(1).max(12_000).optional(), imageKey: z.string().cuid().optional(), threshold: z.number().min(-1).max(1).optional(), limit: z.number().int().min(1).max(50).default(50) }).refine((value) => Boolean(value.query) !== Boolean(value.imageKey), 'Provide exactly one of query or imageKey');
const statusSchema = strictObject({ ...contextSchema, uploadKeys: z.array(z.string().cuid()).min(1).max(20) });

type GalleryMembership = NonNullable<Awaited<ReturnType<typeof getUserOrganizationByOrganizationAndUser>>>;
const repository = createMediaLibraryRepository();
const publicS3 = createPublicS3Client();
// Bun can retain duplicate Smithy type packages across AWS SDK clients even when
// the runtime SDK versions are aligned. Keep that package-only mismatch local.
const signUrl = getSignedUrl as unknown as (
  client: S3Client,
  command: GetObjectCommand | PutObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

async function authorize(c: Context, organizationKey: string, scopeKey: string): Promise<GalleryMembership> {
  const identity = await getAuthIdentity(c);
  if (!identity) throw new GalleryHttpError(401, 'GALLERY_UNAUTHORIZED', 'Authentication required.');
  if (identity.identityType !== 'user') throw new GalleryHttpError(403, 'GALLERY_FORBIDDEN', 'A user session is required.');
  const membership = await getUserOrganizationByOrganizationAndUser(organizationKey, identity.key);
  if (!membership || membership.status !== 'active' || !await repository.canManageScope(scopeKey, membership.key)) throw new GalleryHttpError(403, 'GALLERY_FORBIDDEN', 'Gallery scope access denied.');
  return membership;
}

class GalleryHttpError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 404 | 409 | 500, readonly code: string, message: string) { super(message); }
}

function safeError(error: unknown) {
  if (error instanceof GalleryHttpError) return error;
  if (error instanceof ZodError || error instanceof SyntaxError) return new GalleryHttpError(400, 'GALLERY_INVALID_INPUT', 'Gallery request input was invalid.');
  return new GalleryHttpError(500, 'GALLERY_FAILED', 'Gallery request failed.');
}

async function imageUrl(storageKey: string) {
  return signUrl(publicS3, new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }), { expiresIn: 15 * 60 });
}

async function safeImage(image: z.infer<typeof imageSchema>, score?: number) {
  return {
    key: image.key, filename: image.filename, caption: image.caption, imageCaptionKey: image.imageCaptionKey ?? null,
    mimeType: image.mimeType, sizeBytes: image.sizeBytes, width: image.width, height: image.height,
    isFavorite: image.isFavorite, createdAt: image.createdAt, updatedAt: image.updatedAt,
    url: await imageUrl(image.storageKey), ...(score === undefined ? {} : { score }),
  };
}

async function processReservedUpload(upload: GalleryUpload) {
  try {
    await updateGalleryUpload(upload.key, { status: 'processing', updatedAt: new Date().toISOString() });
    const stored = await documentStorage.download(upload.storageKey);
    if (stored.bytes.byteLength !== upload.sizeBytes) throw new Error('Uploaded image size changed.');
    const sourceUrl = await imageUrl(upload.storageKey);
    const image = await processImage({ scopeKey: upload.scopeKey, ownerKey: upload.actorKey, file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: upload.sizeBytes, bytes: stored.bytes } }, {
      createKey: () => upload.imageKey,
      caption: async () => (await imageCaptionTool.execute({ imageUrls: [sourceUrl] }, { organizationKey: upload.organizationKey })).captions[0]!,
    });
    if (upload.collectionKey) await repository.addImageToCollection(collectionImageSchema.parse({ key: newId(), scopeKey: upload.scopeKey, collectionKey: upload.collectionKey, imageKey: image.key, addedByKey: upload.actorKey, createdAt: new Date().toISOString() }));
    await documentStorage.delete(upload.storageKey).catch(() => undefined);
    await updateGalleryUpload(upload.key, { status: 'completed', updatedAt: new Date().toISOString(), errorCode: null });
  } catch {
    await updateGalleryUpload(upload.key, { status: 'failed', errorCode: 'IMAGE_PROCESSING_FAILED', updatedAt: new Date().toISOString() }).catch(() => undefined);
  }
}

export async function galleryOverview(c: Context) {
  try {
    const input = overviewSchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    const collectionCursor = await db.query(`FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.deletedAt == null LET imageKeys = (FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == collection._key RETURN relation.imageKey) LET cover = collection.coverImageKey == null ? (LENGTH(imageKeys) == 0 ? null : DOCUMENT(images, imageKeys[0])) : DOCUMENT(images, collection.coverImageKey) SORT collection.name ASC RETURN { collection, count: LENGTH(imageKeys), cover }`, { scopeKey: input.scopeKey });
    const collectionRows = await collectionCursor.all() as Array<{ collection: Record<string, unknown>; count: number; cover: Record<string, unknown> | null }>;
    const imageCursor = await db.query(`FOR image IN images FILTER image.scopeKey == @scopeKey && image.deletedAt == null FILTER @collectionKey == null || LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey == image._key LIMIT 1 RETURN 1) > 0 SORT image.createdAt DESC, image._key ASC LIMIT 500 RETURN image`, { scopeKey: input.scopeKey, collectionKey: input.collectionKey ?? null });
    const images = (await imageCursor.all()).map((value) => imageSchema.parse(withArangoKey(value as Record<string, unknown>)));
    return c.json({ success: true, data: {
      collections: await Promise.all(collectionRows.map(async ({ collection, count, cover }) => { const parsed = collectionSchema.parse(withArangoKey(collection)); return { key: parsed.key, name: parsed.name, description: parsed.description ?? null, count, coverUrl: cover ? await imageUrl(imageSchema.parse(withArangoKey(cover)).storageKey) : null }; })),
      images: await Promise.all(images.map((image) => safeImage(image))),
    } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function createGalleryCollection(c: Context) {
  try {
    const input = collectionCreateSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const now = new Date().toISOString();
    const collection = collectionSchema.parse({ key: newId(), scopeKey: input.scopeKey, name: input.name, ...(input.description ? { description: input.description } : {}), embedding: currentEmbeddingSchema.parse(await embedText({ text: `${input.name}\n\n${input.description ?? ''}` })), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now });
    const member = collectionMemberSchema.parse({ key: newId(), scopeKey: input.scopeKey, collectionKey: collection.key, memberKey: membership.key, role: 'owner', createdAt: now });
    await withTransaction(['collections', 'collectionMembers'], async (transaction) => { await transaction.query('INSERT @collection INTO collections', { collection: toArangoDoc(collection) }); await transaction.query('INSERT @member INTO collectionMembers', { member: toArangoDoc(member) }); });
    return c.json({ success: true, data: { key: collection.key, name: collection.name, description: collection.description ?? null, count: 0, coverUrl: null } }, 201);
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function presignGalleryUploads(c: Context) {
  try {
    const input = presignSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    if (input.collectionKey) { const collection = await repository.getCollection(input.scopeKey, input.collectionKey); if (!collection) throw new GalleryHttpError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.'); }
    const now = new Date();
    const uploads = await Promise.all(input.files.map(async (file) => {
      const key = newId(), imageKey = newId();
      const storageKey = `pending/gallery/${input.scopeKey}/${key}/original.jpg`;
      const record = galleryUploadSchema.parse({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, imageKey, collectionKey: input.collectionKey ?? null, filename: file.filename.replace(/\.jpeg$/i, '.jpg'), mimeType: 'image/jpeg', sizeBytes: file.sizeBytes, storageKey, status: 'reserved', errorCode: null, createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() });
      await insertGalleryUpload(record);
      const url = await signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: storageKey, ContentType: 'image/jpeg' }), { expiresIn: 10 * 60 });
      return { clientKey: file.clientKey, uploadKey: key, imageKey, url, headers: { 'Content-Type': 'image/jpeg' } };
    }));
    return c.json({ success: true, data: { uploads } }, 201);
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function completeGalleryUploads(c: Context) {
  try {
    const input = completeSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const uploads = await Promise.all(input.uploadKeys.map(async (key) => {
      const upload = await getGalleryUploadById(key);
      if (!upload || upload.scopeKey !== input.scopeKey || upload.organizationKey !== input.organizationKey || upload.actorKey !== membership.key) throw new GalleryHttpError(404, 'GALLERY_UPLOAD_NOT_FOUND', 'Upload reservation not found.');
      if (upload.status === 'completed' || upload.status === 'queued' || upload.status === 'processing') return upload;
      if (Date.parse(upload.expiresAt) <= Date.now()) throw new GalleryHttpError(409, 'GALLERY_UPLOAD_EXPIRED', 'Upload reservation expired.');
      const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: upload.storageKey }));
      if (head.ContentLength !== upload.sizeBytes || head.ContentType !== 'image/jpeg') throw new GalleryHttpError(409, 'GALLERY_UPLOAD_MISMATCH', 'Uploaded image does not match its reservation.');
      return updateGalleryUpload(upload.key, { status: 'queued', updatedAt: new Date().toISOString(), errorCode: null });
    }));
    for (const upload of uploads) if (upload.status === 'queued') void processReservedUpload(upload);
    return c.json({ success: true, data: { jobs: uploads.map(({ key, imageKey, status }) => ({ key, imageKey, status })) } }, 202);
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function galleryUploadStatus(c: Context) {
  try {
    const input = statusSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const uploads = await Promise.all(input.uploadKeys.map((key) => getGalleryUploadById(key)));
    if (uploads.some((upload) => !upload || upload.organizationKey !== input.organizationKey || upload.scopeKey !== input.scopeKey || upload.actorKey !== membership.key)) throw new GalleryHttpError(404, 'GALLERY_UPLOAD_NOT_FOUND', 'Upload reservation not found.');
    return c.json({ success: true, data: { jobs: uploads.map((upload) => ({ key: upload!.key, imageKey: upload!.imageKey, status: upload!.status, errorCode: upload!.errorCode })) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function searchGalleryImages(c: Context) {
  try {
    const input = searchSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    let matches: Array<{ image: z.infer<typeof imageSchema>; score: number }>;
    if (input.query) {
      const output = await imageSearchTool.execute({ query: input.query, threshold: input.threshold, limit: input.limit }, { context: { organizationKey: input.organizationKey, runtimeScopeKey: input.scopeKey, principal: { kind: 'member', user: { key: membership.userId }, userOrganization: membership, scopeMember: null } as never } });
      matches = await Promise.all(output.images.map(async ({ key, score }) => { const image = await getImageById(key); if (!image) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.'); return { image, score }; }));
    } else {
      const source = await getImageById(input.imageKey!);
      if (!source || source.scopeKey !== input.scopeKey || !await repository.canAccessImage(input.scopeKey, source.key, membership.key)) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
      matches = (await searchAccessibleImages({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, embedding: source.embedding, threshold: input.threshold, limit: input.limit + 1 })).filter(({ image }) => image.key !== source.key).slice(0, input.limit);
    }
    return c.json({ success: true, data: { images: await Promise.all(matches.map(({ image, score }) => safeImage(image, score))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}
