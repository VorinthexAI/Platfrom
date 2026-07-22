import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { documentExtensionSchema, documentsEmbeddingFields } from './documents.node';
import { documentSharesEmbeddingFields } from './document-shares.node';
import { foldersEmbeddingFields } from './folders.node';
import { documentVersionsEmbeddingFields } from './document-versions.node';

describe('Archive node contracts', () => {
  test('accepts only supported document extensions', () => {
    for (const extension of ['txt', 'md', 'doc', 'docx', 'pdf'] as const) expect(documentExtensionSchema.parse(extension)).toBe(extension);
    expect(() => documentExtensionSchema.parse('rtf')).toThrow();
  });

  test('uses only semantic Archive fields to build embeddings', () => {
    expect(foldersEmbeddingFields).toEqual(['name', 'description']);
    expect(documentsEmbeddingFields).toEqual(['content']);
    expect(documentVersionsEmbeddingFields).toEqual(['content']);
    expect(documentSharesEmbeddingFields).toEqual([]);
    expect(buildEmbeddingText(documentsEmbeddingFields, { name: 'Roadmap', content: 'Ship Archive V1', html: '<p>Ship Archive V1</p>', json: { type: 'doc' } })).toBe('Ship Archive V1');
    expect(buildEmbeddingText(documentSharesEmbeddingFields, { token: 'not-embedded' })).toBeNull();
  });
});
