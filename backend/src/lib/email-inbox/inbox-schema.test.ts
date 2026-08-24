import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { inboxEmbeddingFields, inboxSchema } from './inbox-schema';

describe('inbox schema', () => {
  test('keeps the canonical one-to-one metadata and exact semantic field order', () => {
    expect(inboxEmbeddingFields).toEqual(['name', 'description']);
    const inbox = inboxSchema.parse({ key: newId(), organizationKey: 'organization', scopeKey: newId(), connectorKey: newId(), name: 'Work', description: 'Primary mail', isFavorite: false, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: '2026-08-23T00:00:00.000Z', updatedAt: '2026-08-23T00:00:00.000Z' });
    expect(inbox).toMatchObject({ name: 'Work', description: 'Primary mail', isFavorite: false });
    expect(() => inboxSchema.parse({ ...inbox, embedding: [0] })).toThrow();
  });
});
