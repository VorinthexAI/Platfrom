import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { tagSchema } from './tags.node';
import { sourceTypeSchema } from './tag-assignments.node';

describe('scope tag persistence schemas', () => {
  test('requires private ownership and bounded normalized text', () => {
    const key = newId(), embedding = Array(EMBEDDING_DIMENSIONS).fill(0), now = '2026-09-04T12:00:00.000Z';
    expect(tagSchema.parse({ key, scopeKey: newId(), userKey: newId(), name: 'Tag', normalizedName: 'tag', description: 'Detail', embedding, createdAt: now, updatedAt: now })).toMatchObject({ key, normalizedName: 'tag' });
    expect(tagSchema.safeParse({ key, scopeKey: newId(), name: 'Tag', normalizedName: 'tag', embedding, createdAt: now, updatedAt: now }).success).toBe(false);
    expect(tagSchema.safeParse({ key, scopeKey: newId(), userKey: newId(), name: 'x'.repeat(121), normalizedName: 'x', embedding, createdAt: now, updatedAt: now }).success).toBe(false);
  });
  test('accepts only canonical target types', () => {
    expect(sourceTypeSchema.options).toEqual(['folder', 'document', 'image-collection', 'image', 'image-highlight', 'image-memory', 'place', 'trip', 'email-inbox', 'email-tone', 'email-thread', 'email-message', 'email-draft', 'book']);
    for (const alias of ['file', 'collection', 'email']) expect(sourceTypeSchema.safeParse(alias).success).toBe(false);
  });
});
