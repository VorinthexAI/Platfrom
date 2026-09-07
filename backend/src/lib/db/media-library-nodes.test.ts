import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, currentEmbeddingSchema } from '@/lib/embeddings';
import { imageSchema, imagesEmbeddingFields, IMAGES_COLLECTION } from './images.node';
import { collectionSchema, collectionsEmbeddingFields, COLLECTIONS_COLLECTION } from './collections.node';
import { COLLECTION_IMAGES_COLLECTION } from './collection-images.node';
import { tagSchema, tagsEmbeddingFields, TAGS_COLLECTION } from './tags.node';
import { sourceTypeSchema, TAG_ASSIGNMENTS_COLLECTION } from './tag-assignments.node';
import { imageCaptionRecordSchema, IMAGE_CAPTIONS_COLLECTION } from './image-captions.node';

const key = 'cmrnlzf650002qc7k4p5zem5w'; const scopeKey = 'cmrnlzf640001qc7kazsr96k5'; const now = '2026-08-07T12:00:00.000Z'; const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);
describe('MediaLibrary node contracts', () => {
  test('declares the Gallery physical collections and keeps secrets private', () => {
    expect([IMAGES_COLLECTION, IMAGE_CAPTIONS_COLLECTION, COLLECTIONS_COLLECTION, COLLECTION_IMAGES_COLLECTION, TAGS_COLLECTION, TAG_ASSIGNMENTS_COLLECTION]).toEqual(['images', 'imageCaptions', 'collections', 'collectionImages', 'tags', 'tagAssignments']);
  });
  test('uses the global current embedding contract', () => {
    expect(EMBEDDING_DIMENSIONS).toBe(1_536);
    expect(currentEmbeddingSchema.safeParse(embedding).success).toBe(true); expect(currentEmbeddingSchema.safeParse(embedding.slice(1)).success).toBe(false);
    expect(imagesEmbeddingFields).toEqual(['filename', 'caption', 'placeName', 'placeSummary', 'country', 'countryCode']); expect(collectionsEmbeddingFields).toEqual(['name', 'description']); expect(tagsEmbeddingFields).toEqual(['normalizedName', 'description']);
  });
  test('strips Arango internals and unknown persisted fields by default', () => {
    const parsed = collectionSchema.parse({ _key: key, key, scopeKey, name: 'Launch', embedding, createdAt: now, updatedAt: now, unexpected: true });
    expect(parsed).not.toHaveProperty('_key'); expect(parsed).not.toHaveProperty('unexpected');
    expect(imageSchema.safeParse({ key, scopeKey, filename: 'x.png', caption: ' ', storageKey: 'x', mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, embedding, createdAt: now, updatedAt: now }).success).toBe(false);
    expect(tagSchema.safeParse({ key, scopeKey, userKey: key, name: 'Tag', normalizedName: 'tag', embedding, createdAt: now, updatedAt: now }).success).toBe(true);
    expect(imageCaptionRecordSchema.safeParse({ key, scopeKey, sourceImageKey: key, caption: 'A caption.', embedding, perceptualHash: '0123456789abcdef', hashAlgorithm: 'phash-64-dct-v1', hashSegment0: '0123', hashSegment1: '4567', hashSegment2: '89ab', hashSegment3: 'cdef', createdAt: now, updatedAt: now }).success).toBe(true);
    expect(imageCaptionRecordSchema.safeParse({ key, scopeKey, sourceImageKey: key, caption: ' ', embedding, perceptualHash: null, hashAlgorithm: null, hashSegment0: null, hashSegment1: null, hashSegment2: null, hashSegment3: null, createdAt: now, updatedAt: now }).success).toBe(false);
  });
  test('keeps supported tag-assignment source types strict', () => {
    expect(sourceTypeSchema.safeParse('place').success).toBe(true); expect(sourceTypeSchema.safeParse('trip').success).toBe(true); expect(sourceTypeSchema.safeParse('file').success).toBe(false);
  });
});
