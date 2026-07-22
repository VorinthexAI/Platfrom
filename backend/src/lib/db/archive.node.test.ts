import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { documentExtensionSchema, documentSchema, documentsEmbeddingFields } from './documents.node';
import { documentShareSchema, documentSharesEmbeddingFields } from './document-shares.node';
import { folderSchema, foldersEmbeddingFields } from './folders.node';
import { documentVersionSchema, documentVersionsEmbeddingFields } from './document-versions.node';

describe('Archive node contracts', () => {
  test('accepts only supported document extensions', () => {
    for (const extension of ['txt', 'md', 'doc', 'docx', 'pdf'] as const) expect(documentExtensionSchema.parse(extension)).toBe(extension);
    expect(() => documentExtensionSchema.parse('rtf')).toThrow();
  });

  test('uses only semantic Archive fields to build embeddings', () => {
    expect(foldersEmbeddingFields).toEqual(['name', 'description']);
    expect(documentsEmbeddingFields).toEqual(['name', 'content']);
    expect(documentVersionsEmbeddingFields).toEqual(['content']);
    expect(documentSharesEmbeddingFields).toEqual([]);
    expect(buildEmbeddingText(documentsEmbeddingFields, { name: 'Roadmap', content: 'Ship Archive V1', html: '<p>Ship Archive V1</p>', json: { type: 'doc' } })).toBe('Roadmap\n\nShip Archive V1');
    expect(buildEmbeddingText(documentSharesEmbeddingFields, { token: 'not-embedded' })).toBeNull();
  });

  test('defaults Archive resources to active and validates archive timestamps', () => {
    for (const schema of [folderSchema, documentSchema, documentVersionSchema, documentShareSchema]) {
      expect(schema.shape.deletedAt.parse(undefined)).toBeNull();
      expect(schema.shape.deletedAt.parse('2026-07-22T00:00:00.000Z')).toBe('2026-07-22T00:00:00.000Z');
      expect(() => schema.shape.deletedAt.parse('yesterday')).toThrow();
    }
  });
});
