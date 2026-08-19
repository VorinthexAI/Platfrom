import { z } from 'zod';
import { createNodeHelpers } from './base';

// The persisted collection name is an externally required legacy spelling.
export const IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION = 'imageCollecitionHightlights';
export const imageCollectionHighlightSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  collectionKey: z.string().cuid(),
  imageKeys: z.array(z.string().cuid()).max(10),
  createdByKey: z.string().cuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ImageCollectionHighlight = z.infer<typeof imageCollectionHighlightSchema>;

const helpers = createNodeHelpers(IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION, imageCollectionHighlightSchema, [], { requireEmbedding: false });
export const insertImageCollectionHighlight = helpers.insert;
export const getImageCollectionHighlightById = helpers.getById;
export const updateImageCollectionHighlight = helpers.updateById;
export const getAllImageCollectionHighlightsChunked = helpers.getAllChunked;
export const listImageCollectionHighlightsPage = helpers.listPage;
