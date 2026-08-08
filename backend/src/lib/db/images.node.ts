import { aql } from 'arangojs';
import { z } from 'zod';
import { createNodeHelpers, toArangoDoc, withArangoKey } from './base';
import { db } from './client';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const IMAGES_COLLECTION = 'images';
export const imageSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), ownerKey: z.string().cuid().optional(), filename: z.string().trim().min(1), caption: z.string().trim().min(1),
  storageKey: z.string().trim().min(1), mimeType: z.string().trim().min(1), sizeBytes: z.number().int().positive(),
  width: z.number().int().positive(), height: z.number().int().positive(), embedding: currentEmbeddingSchema,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
  embeddingProvider: z.string().trim().min(1).optional(), embeddingModel: z.string().trim().min(1).optional(), embeddingDimensions: z.number().int().positive().optional(),
  isFavorite: z.boolean().default(false), deletedAt: z.string().datetime().nullable().default(null), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Image = z.infer<typeof imageSchema>;
export const imagesEmbeddingFields = ['filename', 'caption'] as const;
const helpers = createNodeHelpers(IMAGES_COLLECTION, imageSchema, imagesEmbeddingFields);
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
