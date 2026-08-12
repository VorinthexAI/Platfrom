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
import { visualIdentitySchema } from '@/lib/db/visual-identities.node';
import { imageIdentitySchema } from '@/lib/db/image-identities.node';
import { getUserOrganizationByOrganizationAndUser } from '@/lib/db/user-organization.node';
import { createMediaLibraryRepository, searchAccessibleImages } from '@/lib/media-library';
import { processImage } from '@/lib/ai/image-processing';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { imageSearchTool } from '@/lib/ai/tools/image-search';
import { imageCreateVisualIdentityTool } from '@/lib/ai/tools/image-create-visual-identity';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { findRedundantGalleryImageKeys } from '@/lib/gallery-duplicates';
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
const favoriteSchema = strictObject({ ...contextSchema, imageKey: z.string().cuid(), isFavorite: z.boolean() });
const duplicatesSchema = strictObject({ ...contextSchema, collectionKey: z.string().cuid() });
const deleteDuplicatesSchema = strictObject({ ...contextSchema, collectionKey: z.string().cuid(), imageKeys: z.array(z.string().cuid()).min(1).max(500) });
const subjectListSchema = strictObject({ ...contextSchema, includeDeleted: z.boolean().default(false) });
const subjectCreateSchema = strictObject({ ...contextSchema, name: z.string().trim().min(1).max(120), imageKeys: z.array(z.string().cuid()).min(1).max(8) }).refine(({ imageKeys }) => new Set(imageKeys).size === imageKeys.length, 'Reference image keys must be unique');
const subjectKeySchema = strictObject({ ...contextSchema, identityKey: z.string().cuid() });
const collectionTransferSchema = strictObject({
  ...contextSchema,
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
interface GalleryDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>; }
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

async function redundantCollectionImages(scopeKey: string, collectionKey: string, database: GalleryDatabase = db) {
  const cursor = await database.query(`
    FOR relation IN collectionImages
      FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey
      LET image = DOCUMENT(images, relation.imageKey)
      FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null
      LET caption = DOCUMENT(imageCaptions, image.imageCaptionKey)
      FILTER caption != null && caption.scopeKey == @scopeKey && caption.perceptualHash != null
      LET protected = LENGTH(FOR identityRelation IN imageIdentities FILTER identityRelation.scopeKey == @scopeKey && identityRelation.imageKey == image._key && identityRelation.isReference == true LIMIT 1 RETURN 1) > 0
      SORT image.createdAt ASC, image._key ASC
      RETURN { image, perceptualHash: caption.perceptualHash, protected }
  `, { scopeKey, collectionKey });
  const rows = await cursor.all() as Array<{ image: Record<string, unknown>; perceptualHash: string; protected: boolean }>;
  const parsed = rows.map(({ image, perceptualHash, protected: isProtected }) => ({ image: imageSchema.parse(withArangoKey(image)), perceptualHash, protected: isProtected }));
  const redundantKeys = new Set(findRedundantGalleryImageKeys(parsed.map(({ image, perceptualHash, protected: isProtected }) => ({ key: image.key, createdAt: image.createdAt, perceptualHash, protected: isProtected }))));
  return parsed.map(({ image }) => image).filter(({ key }) => redundantKeys.has(key));
}

async function persistIdentityMatches(scopeKey: string, identityKey: string, matches: Array<{ imageKey: string; confidence: number }>) {
  if (!matches.length) return;
  const now = new Date().toISOString();
  await withTransaction(['imageIdentities'], async (transaction) => {
    for (const match of matches) {
      const relation = imageIdentitySchema.parse({ key: newId(), scopeKey, imageKey: match.imageKey, identityKey, confidence: match.confidence, isReference: false, createdAt: now });
      await transaction.query('UPSERT { scopeKey: @scopeKey, identityKey: @identityKey, imageKey: @imageKey } INSERT @relation UPDATE { confidence: MAX([OLD.confidence, @confidence]) } IN imageIdentities', { scopeKey, identityKey, imageKey: match.imageKey, confidence: match.confidence, relation: toArangoDoc(relation) });
    }
  });
}

async function reconcileVisualIdentity(identity: z.infer<typeof visualIdentitySchema>, organizationKey: string, actorKey: string) {
  const matches = await searchAccessibleImages({ organizationKey, scopeKey: identity.scopeKey, actorKey, embedding: identity.embedding, threshold: 0.82, limit: 50 });
  await persistIdentityMatches(identity.scopeKey, identity.key, matches.map(({ image, score }) => ({ imageKey: image.key, confidence: score })));
}

async function classifyImageSubjects(image: z.infer<typeof imageSchema>) {
  const cursor = await db.query(`FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER IS_ARRAY(identity.embedding) && LENGTH(identity.embedding) == @dimensions LET confidence = COSINE_SIMILARITY(identity.embedding, @embedding) FILTER IS_NUMBER(confidence) && confidence >= 0.82 RETURN { identityKey: identity._key, confidence }`, { scopeKey: image.scopeKey, embedding: image.embedding, dimensions: image.embedding.length });
  const matches = await cursor.all() as Array<{ identityKey: string; confidence: number }>;
  for (const match of matches) await persistIdentityMatches(image.scopeKey, match.identityKey, [{ imageKey: image.key, confidence: match.confidence }]);
}

async function safeSubject(row: { identity: Record<string, unknown>; reference: Record<string, unknown>; imageCount: number }) {
  const identity = visualIdentitySchema.parse(withArangoKey(row.identity));
  const reference = imageSchema.parse(withArangoKey(row.reference));
  return {
    key: identity.key, name: identity.name, description: identity.description, referenceImageKey: identity.referenceImageKey,
    referenceUrl: await imageUrl(reference.storageKey), imageCount: row.imageCount, deletedAt: identity.deletedAt,
    createdAt: identity.createdAt, updatedAt: identity.updatedAt,
  };
}

async function subjectRow(scopeKey: string, identityKey: string, includeDeleted: boolean) {
  const cursor = await db.query(`FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey FILTER @includeDeleted || identity.deletedAt == null LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.deletedAt == null RETURN 1) LIMIT 1 RETURN { identity, reference, imageCount }`, { scopeKey, identityKey, includeDeleted });
  return (await cursor.all())[0] as { identity: Record<string, unknown>; reference: Record<string, unknown>; imageCount: number } | undefined;
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
    // Subject reads reconcile again, so a transient classification failure does not fail an otherwise valid upload.
    await classifyImageSubjects(image).catch(() => undefined);
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
      const identityCursor = await db.query('FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER CONTAINS(LOWER(@query), LOWER(identity.name)) RETURN identity', { scopeKey: input.scopeKey, query: input.query });
      const namedIdentities = (await identityCursor.all()).map((value) => visualIdentitySchema.parse(withArangoKey(value as Record<string, unknown>)));
      await Promise.all(namedIdentities.map((identity) => reconcileVisualIdentity(identity, input.organizationKey, membership.key)));
      const namedCursor = await db.query(`FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey && identity.deletedAt == null FILTER CONTAINS(LOWER(@query), LOWER(identity.name)) FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null SORT relation.confidence DESC, image.createdAt DESC RETURN { image, score: relation.confidence }`, { scopeKey: input.scopeKey, query: input.query });
      const named = (await namedCursor.all() as Array<{ image: Record<string, unknown>; score: number }>).map(({ image, score }) => ({ image: imageSchema.parse(withArangoKey(image)), score }));
      const semantic = await Promise.all(output.images.map(async ({ key, score }) => { const image = await getImageById(key); if (!image) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.'); return { image, score }; }));
      const unique = new Map(named.map((match) => [match.image.key, match]));
      for (const match of semantic) if (!unique.has(match.image.key)) unique.set(match.image.key, match);
      matches = [...unique.values()].slice(0, input.limit);
    } else {
      const source = await getImageById(input.imageKey!);
      if (!source || source.scopeKey !== input.scopeKey || !await repository.canAccessImage(input.scopeKey, source.key, membership.key)) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
      matches = (await searchAccessibleImages({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, embedding: source.embedding, threshold: input.threshold, limit: input.limit + 1 })).filter(({ image }) => image.key !== source.key).slice(0, input.limit);
    }
    return c.json({ success: true, data: { images: await Promise.all(matches.map(({ image, score }) => safeImage(image, score))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function setGalleryImageFavorite(c: Context) {
  try {
    const input = favoriteSchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    const cursor = await db.query('FOR image IN images FILTER image._key == @imageKey && image.scopeKey == @scopeKey && image.deletedAt == null LIMIT 1 UPDATE image WITH { isFavorite: @isFavorite, updatedAt: @now } IN images RETURN NEW', {
      imageKey: input.imageKey, scopeKey: input.scopeKey, isFavorite: input.isFavorite, now: new Date().toISOString(),
    });
    const value = (await cursor.all())[0];
    if (!value) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Image not found.');
    return c.json({ success: true, data: { image: await safeImage(imageSchema.parse(withArangoKey(value as Record<string, unknown>))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function findGalleryCollectionDuplicates(c: Context) {
  try {
    const input = duplicatesSchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    if (!await repository.getCollection(input.scopeKey, input.collectionKey)) throw new GalleryHttpError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.');
    const images = await redundantCollectionImages(input.scopeKey, input.collectionKey);
    return c.json({ success: true, data: { images: await Promise.all(images.map((image) => safeImage(image))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function deleteGalleryCollectionDuplicates(c: Context) {
  try {
    const input = deleteDuplicatesSchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    if (!await repository.getCollection(input.scopeKey, input.collectionKey)) throw new GalleryHttpError(404, 'GALLERY_COLLECTION_NOT_FOUND', 'Collection not found.');
    const now = new Date().toISOString();
    const deletion = await withTransaction({ read: ['imageCaptions', 'visualIdentities'], write: ['images', 'collectionImages', 'collections', 'imageIdentities'] }, async (transaction) => {
      const allowed = new Set((await redundantCollectionImages(input.scopeKey, input.collectionKey, transaction)).map(({ key }) => key));
      if (input.imageKeys.some((key) => !allowed.has(key))) throw new GalleryHttpError(409, 'GALLERY_DUPLICATES_CHANGED', 'The duplicate set changed. Find duplicates again before deleting.');
      await transaction.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @collectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', { imageKeys: input.imageKeys, scopeKey: input.scopeKey, collectionKey: input.collectionKey });
      await transaction.query('FOR collection IN collections FILTER collection._key == @collectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections', { imageKeys: input.imageKeys, scopeKey: input.scopeKey, collectionKey: input.collectionKey, now });
      const deletedCursor = await transaction.query(`FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey && image.deletedAt == null LET collectionCount = LENGTH(FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LIMIT 1 RETURN 1) LET subjectCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.imageKey == image._key LET identity = DOCUMENT(visualIdentities, relation.identityKey) FILTER identity != null && identity.deletedAt == null LIMIT 1 RETURN 1) FILTER collectionCount == 0 && subjectCount == 0 UPDATE image WITH { deletedAt: @now, updatedAt: @now } IN images RETURN OLD._key`, { imageKeys: input.imageKeys, scopeKey: input.scopeKey, now });
      return { removedImageKeys: input.imageKeys, deletedImageKeys: await deletedCursor.all() as string[] };
    });
    return c.json({ success: true, data: deletion });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function transferGalleryCollectionImages(c: Context) {
  try {
    const input = collectionTransferSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const now = new Date().toISOString();
    const transfer = await withTransaction({ read: ['images', 'collectionMembers'], write: ['collections', 'collectionImages'] }, async (transaction) => {
      const sourceCursor = await transaction.query('FOR imageKey IN @imageKeys LET image = DOCUMENT(images, imageKey) LET relation = FIRST(FOR candidate IN collectionImages FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == @sourceCollectionKey && candidate.imageKey == imageKey LIMIT 1 RETURN candidate) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null && relation != null RETURN imageKey', { imageKeys: input.imageKeys, scopeKey: input.scopeKey, sourceCollectionKey: input.sourceCollectionKey });
      if ((await sourceCursor.all()).length !== input.imageKeys.length) throw new GalleryHttpError(409, 'GALLERY_SELECTION_CHANGED', 'One or more selected images are no longer in the source collection.');
      const destinationCursor = await transaction.query('FOR collectionKey IN @collectionKeys LET collection = DOCUMENT(collections, collectionKey) LET member = FIRST(FOR candidate IN collectionMembers FILTER candidate.scopeKey == @scopeKey && candidate.collectionKey == collectionKey && candidate.memberKey == @actorKey LIMIT 1 RETURN candidate) FILTER collection != null && collection.scopeKey == @scopeKey && collection.deletedAt == null && member != null RETURN collectionKey', { collectionKeys: input.destinationCollectionKeys, scopeKey: input.scopeKey, actorKey: membership.key });
      if ((await destinationCursor.all()).length !== input.destinationCollectionKeys.length) throw new GalleryHttpError(403, 'GALLERY_DESTINATION_FORBIDDEN', 'Destination collection membership is required.');
      let createdRelationCount = 0;
      for (const collectionKey of input.destinationCollectionKeys) for (const imageKey of input.imageKeys) {
        const relation = collectionImageSchema.parse({ key: newId(), scopeKey: input.scopeKey, collectionKey, imageKey, addedByKey: membership.key, createdAt: now });
        const cursor = await transaction.query('UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT @relation UPDATE {} IN collectionImages RETURN OLD == null', { scopeKey: input.scopeKey, collectionKey, imageKey, relation: toArangoDoc(relation) });
        if ((await cursor.all())[0] === true) createdRelationCount += 1;
      }
      if (input.mode === 'move') {
        await transaction.query('FOR relation IN collectionImages FILTER relation.scopeKey == @scopeKey && relation.collectionKey == @sourceCollectionKey && relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', { scopeKey: input.scopeKey, sourceCollectionKey: input.sourceCollectionKey, imageKeys: input.imageKeys });
        await transaction.query('FOR collection IN collections FILTER collection._key == @sourceCollectionKey && collection.scopeKey == @scopeKey && collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections', { sourceCollectionKey: input.sourceCollectionKey, scopeKey: input.scopeKey, imageKeys: input.imageKeys, now });
      }
      return { createdRelationCount };
    });
    return c.json({ success: true, data: { mode: input.mode, imageKeys: input.imageKeys, destinationCollectionKeys: input.destinationCollectionKeys, createdRelationCount: transfer.createdRelationCount } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function listGallerySubjects(c: Context) {
  try {
    const input = subjectListSchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    const cursor = await db.query(`FOR identity IN visualIdentities FILTER identity.scopeKey == @scopeKey FILTER @includeDeleted || identity.deletedAt == null LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null LET imageCount = LENGTH(FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == identity._key LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.deletedAt == null RETURN 1) SORT identity.deletedAt == null DESC, identity.name ASC, identity._key ASC RETURN { identity, reference, imageCount }`, { scopeKey: input.scopeKey, includeDeleted: input.includeDeleted });
    const rows = await cursor.all() as Array<{ identity: Record<string, unknown>; reference: Record<string, unknown>; imageCount: number }>;
    return c.json({ success: true, data: { subjects: await Promise.all(rows.map((row) => safeSubject(row))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function createGallerySubject(c: Context) {
  try {
    const input = subjectCreateSchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const references = await Promise.all(input.imageKeys.map(async (key) => {
      const image = await getImageById(key);
      if (!image || image.scopeKey !== input.scopeKey || image.deletedAt) throw new GalleryHttpError(404, 'GALLERY_IMAGE_NOT_FOUND', 'Reference image not found.');
      return image;
    }));
    const profile = await imageCreateVisualIdentityTool.execute({ imageUrls: await Promise.all(references.map(({ storageKey }) => imageUrl(storageKey))) }, { organizationKey: input.organizationKey, signal: c.req.raw.signal });
    const now = new Date().toISOString();
    const embedding = currentEmbeddingSchema.parse(await embedText({ text: `${input.name}\n\n${profile.description}` }));
    const identity = visualIdentitySchema.parse({ key: newId(), scopeKey: input.scopeKey, name: input.name, description: profile.description, referenceImageKey: references[0]!.key, embedding, deletedAt: null, createdAt: now, updatedAt: now });
    const matches = await searchAccessibleImages({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, actorKey: membership.key, embedding, threshold: 0.82, limit: 50 });
    const confidence = new Map(matches.map(({ image, score }) => [image.key, score]));
    for (const reference of references) confidence.set(reference.key, 1);
    const referenceKeys = new Set(references.map(({ key }) => key));
    const relations = [...confidence].map(([imageKey, score]) => imageIdentitySchema.parse({ key: newId(), scopeKey: input.scopeKey, imageKey, identityKey: identity.key, confidence: score, isReference: referenceKeys.has(imageKey), createdAt: now }));
    await withTransaction({ read: ['images'], write: ['visualIdentities', 'imageIdentities'] }, async (transaction) => {
      const referenceCursor = await transaction.query('FOR image IN images FILTER image._key IN @imageKeys && image.scopeKey == @scopeKey && image.deletedAt == null RETURN image._key', { imageKeys: input.imageKeys, scopeKey: input.scopeKey });
      if ((await referenceCursor.all()).length !== input.imageKeys.length) throw new GalleryHttpError(409, 'GALLERY_REFERENCES_CHANGED', 'A reference image changed before the Subject was created.');
      await transaction.query('INSERT @identity INTO visualIdentities', { identity: toArangoDoc(identity) });
      for (const relation of relations) await transaction.query('INSERT @relation INTO imageIdentities', { relation: toArangoDoc(relation) });
    });
    const row = await subjectRow(input.scopeKey, identity.key, false);
    if (!row) throw new GalleryHttpError(500, 'GALLERY_SUBJECT_FAILED', 'Subject could not be read after creation.');
    return c.json({ success: true, data: { subject: await safeSubject(row) } }, 201);
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export async function listGallerySubjectImages(c: Context) {
  try {
    const input = subjectKeySchema.parse(await c.req.json());
    const membership = await authorize(c, input.organizationKey, input.scopeKey);
    const row = await subjectRow(input.scopeKey, input.identityKey, false);
    if (!row) throw new GalleryHttpError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject not found.');
    await reconcileVisualIdentity(visualIdentitySchema.parse(withArangoKey(row.identity)), input.organizationKey, membership.key);
    const cursor = await db.query('FOR relation IN imageIdentities FILTER relation.scopeKey == @scopeKey && relation.identityKey == @identityKey LET image = DOCUMENT(images, relation.imageKey) FILTER image != null && image.scopeKey == @scopeKey && image.deletedAt == null SORT relation.confidence DESC, image.createdAt DESC RETURN { image, confidence: relation.confidence }', { scopeKey: input.scopeKey, identityKey: input.identityKey });
    const rows = await cursor.all() as Array<{ image: Record<string, unknown>; confidence: number }>;
    return c.json({ success: true, data: { images: await Promise.all(rows.map(({ image, confidence }) => safeImage(imageSchema.parse(withArangoKey(image)), confidence))) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

async function setGallerySubjectDeleted(c: Context, deleted: boolean) {
  try {
    const input = subjectKeySchema.parse(await c.req.json());
    await authorize(c, input.organizationKey, input.scopeKey);
    const now = new Date().toISOString();
    const value = await withTransaction({ read: ['images'], write: ['visualIdentities'] }, async (transaction) => {
      const cursor = await transaction.query('FOR identity IN visualIdentities FILTER identity._key == @identityKey && identity.scopeKey == @scopeKey LET reference = DOCUMENT(images, identity.referenceImageKey) FILTER @deleted || (reference != null && reference.scopeKey == @scopeKey && reference.deletedAt == null) LIMIT 1 UPDATE identity WITH { deletedAt: @deletedAt, updatedAt: @now } IN visualIdentities RETURN NEW', { identityKey: input.identityKey, scopeKey: input.scopeKey, deleted, deletedAt: deleted ? now : null, now });
      return (await cursor.all())[0];
    });
    if (!value) throw new GalleryHttpError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject not found.');
    const row = await subjectRow(input.scopeKey, input.identityKey, true);
    if (!row) throw new GalleryHttpError(404, 'GALLERY_SUBJECT_NOT_FOUND', 'Subject reference image is unavailable.');
    return c.json({ success: true, data: { subject: await safeSubject(row) } });
  } catch (error) { const normalized = safeError(error); return c.json({ success: false, error: { code: normalized.code, message: normalized.message } }, normalized.status); }
}

export const deleteGallerySubject = (c: Context) => setGallerySubjectDeleted(c, true);
export const restoreGallerySubject = (c: Context) => setGallerySubjectDeleted(c, false);
