import { z } from 'zod';
import { createNodeHelpers } from './base';

export const IMAGE_COLLECTION_MEMORIES_COLLECTION = 'imageCollectionMemories';
export const imageCollectionMemorySchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  imageKey: z.string().cuid(),
  text: z.string().trim().min(1).max(4_000),
  createdByKey: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ImageCollectionMemory = z.infer<typeof imageCollectionMemorySchema>;

const helpers = createNodeHelpers(IMAGE_COLLECTION_MEMORIES_COLLECTION, imageCollectionMemorySchema, [], { requireEmbedding: false });
export const insertImageCollectionMemory = helpers.insert;
export const getImageCollectionMemoryById = helpers.getById;
export const updateImageCollectionMemory = helpers.updateById;
export const getAllImageCollectionMemoriesChunked = helpers.getAllChunked;
export const listImageCollectionMemoriesPage = helpers.listPage;
