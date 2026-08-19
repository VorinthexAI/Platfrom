import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { IMAGE_COLLECTION_MEMORIES_COLLECTION, imageCollectionMemorySchema } from './image-collection-memories.node';

describe('image memory records', () => {
  test('uses the canonical collection and rejects tombstones and unknown fields', () => {
    const now = new Date().toISOString();
    const value = { key: newId(), scopeKey: newId(), imageKey: newId(), text: 'A warm afternoon.\nEveryone gathered.\nA moment worth keeping.', createdByKey: newId(), createdAt: now, updatedAt: now };
    expect(IMAGE_COLLECTION_MEMORIES_COLLECTION).toBe('imageCollectionMemories');
    expect(imageCollectionMemorySchema.parse(value)).toEqual(value);
    expect(imageCollectionMemorySchema.parse({ ...value, deletedAt: now })).not.toHaveProperty('deletedAt');
  });
});
