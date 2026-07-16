import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';

describe('embeddingFields text extraction', () => {
  test('uses only the ordered declared fields', () => {
    const document = { key: 'storage-key', name: 'Backend Engineering', title: 'Backend Developer', secret: 'never include' };
    expect(buildEmbeddingText(['name', 'title'], document)).toBe('Backend Engineering\n\nBackend Developer');
    expect(buildEmbeddingText([], document)).toBeNull();
    expect(buildEmbeddingText(['name'], { ...document, name: '' })).toBeNull();
  });
});
