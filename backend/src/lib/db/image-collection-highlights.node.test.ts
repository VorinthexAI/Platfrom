import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION, imageCollectionHighlightSchema } from './image-collection-highlights.node';

describe('image collection highlight node', () => {
  test('preserves the required collection spelling and ordered direct image keys', () => {
    const imageKeys = [newId(), newId()];
    const now = new Date().toISOString();
    const value = imageCollectionHighlightSchema.parse({ key: newId(), scopeKey: newId(), collectionKey: newId(), imageKeys, createdByKey: newId(), createdAt: now, updatedAt: now });
    expect(IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION).toBe('imageCollecitionHightlights');
    expect(value.imageKeys).toEqual(imageKeys);
    expect(value).not.toHaveProperty('embedding');
    expect(value).not.toHaveProperty('storageKey');
  });
});
