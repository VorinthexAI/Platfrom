import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { imageIdentitySchema } from './image-identities.node';
import { visualIdentitySchema } from './visual-identities.node';

const now = '2026-08-11T12:00:00.000Z';

describe('visual identity records', () => {
  test('validates an active identity and an image confidence relation', () => {
    const scopeKey = newId();
    const identityKey = newId();
    const imageKey = newId();
    expect(visualIdentitySchema.parse({ key: identityKey, scopeKey, name: 'Viggo', description: 'A black dog with a white chest blaze.', referenceImageKey: imageKey, embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), deletedAt: null, createdAt: now, updatedAt: now })).toMatchObject({ name: 'Viggo', deletedAt: null });
    expect(imageIdentitySchema.parse({ key: newId(), scopeKey, imageKey, identityKey, confidence: 1, isReference: true, createdAt: now })).toMatchObject({ imageKey, confidence: 1, isReference: true });
  });

  test('rejects confidence outside cosine similarity bounds', () => {
    expect(() => imageIdentitySchema.parse({ key: newId(), scopeKey: newId(), imageKey: newId(), identityKey: newId(), confidence: 1.1, createdAt: now })).toThrow();
  });
});
