import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { db } from './client';
import { withTransaction } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { findReusableImageCaption, imageCaptionRecordSchema, type ImageCaptionRecord } from './image-captions.node';

export const IMAGES_COLLECTION = 'images';
export const imageSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), filename: z.string().trim().min(1), caption: z.string().trim().min(1),
  storageKey: z.string().trim().min(1), mimeType: z.string().trim().min(1), sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(), height: z.number().int().positive(), embedding: currentEmbeddingSchema,
  imageCaptionKey: z.string().cuid().nullable().optional(),
  isFavorite: z.boolean().default(false), deletedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Image = z.infer<typeof imageSchema>;
export const imagesEmbeddingFields = ['filename', 'caption'] as const;
const helpers = createNodeHelpers(IMAGES_COLLECTION, imageSchema, imagesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertImage = helpers.insert;
export const getImageById = helpers.getById;
export const updateImage = helpers.updateById;
export const upsertImageByKey = helpers.upsertByKey;
export const getAllImagesChunked = helpers.getAllChunked;
export const listImagesPage = helpers.listPage;

export async function getImageInScope(scopeKey: string, imageKey: string, includeDeleted = false): Promise<Image | null> {
  const cursor = await db.query(aql`FOR image IN ${db.collection(IMAGES_COLLECTION)} FILTER image._key == ${imageKey} && image.scopeKey == ${scopeKey} FILTER ${includeDeleted} || image.deletedAt == null LIMIT 1 RETURN image`);
  const image = await cursor.next();
  return image ? imageSchema.parse(withArangoKey(image)) : null;
}

export async function listImagesByScope(scopeKey: string, includeDeleted = false): Promise<Image[]> {
  const cursor = await db.query(aql`FOR image IN ${db.collection(IMAGES_COLLECTION)} FILTER image.scopeKey == ${scopeKey} FILTER ${includeDeleted} || image.deletedAt == null SORT image.createdAt DESC, image._key ASC RETURN image`);
  return (await cursor.all()).map((image) => imageSchema.parse(withArangoKey(image)));
}

export async function insertPreparedImage(input: Image): Promise<Image> {
  const image = imageSchema.parse(input);
  const result = await db.collection(IMAGES_COLLECTION).save(toArangoDoc(image), { returnNew: true });
  return imageSchema.parse(withArangoKey(result.new as Record<string, unknown>));
}

export async function insertPreparedImageWithCaption(input: {
  image: Image;
  caption?: ImageCaptionRecord;
  actorKey: string;
}): Promise<Image> {
  let image = imageSchema.parse(input.image);
  let caption = input.caption ? imageCaptionRecordSchema.parse(input.caption) : undefined;
  if (!image.imageCaptionKey) throw new Error('Prepared images require an image caption reference.');
  if (caption && (caption.key !== image.imageCaptionKey || caption.scopeKey !== image.scopeKey || caption.caption !== image.caption)) {
    throw new Error('Image caption relation does not match the prepared image.');
  }
  return withTransaction({
    read: ['userOrganizations', 'scopes', 'scopeMembers', 'collectionImages', 'collections', 'collectionMembers'],
    write: ['images', 'imageCaptions'],
  }, async (transaction) => {
    if (caption) {
      const reusable = caption.perceptualHash
        ? await findReusableImageCaption(image.scopeKey, caption.perceptualHash, input.actorKey, transaction)
        : null;
      if (reusable) {
        image = imageSchema.parse({ ...image, caption: reusable.caption, embedding: reusable.embedding, imageCaptionKey: reusable.key });
        caption = undefined;
      } else {
        await transaction.query('INSERT @caption INTO imageCaptions', { caption: toArangoDoc(caption) });
      }
    } else {
      const existing = await transaction.query('RETURN DOCUMENT(imageCaptions, @captionKey)', { captionKey: image.imageCaptionKey });
      const record = await existing.next();
      const parsed = record ? imageCaptionRecordSchema.parse(withArangoKey(record as Record<string, unknown>)) : null;
      if (!parsed || parsed.scopeKey !== image.scopeKey || parsed.caption !== image.caption) throw new Error('Reusable image caption is unavailable.');
    }
    const cursor = await transaction.query('INSERT @image INTO images RETURN NEW', { image: toArangoDoc(image) });
    const inserted = await cursor.next();
    return imageSchema.parse(withArangoKey(inserted as Record<string, unknown>));
  });
}
