import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { documentExtensionSchema, documentSchema, documentsEmbeddingFields } from './documents.node';
import { documentShareSchema, documentSharesEmbeddingFields } from './document-shares.node';
import { folderSchema, foldersEmbeddingFields } from './folders.node';
import { documentVersionSchema, documentVersionsEmbeddingFields } from './document-versions.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';

const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('Content node contracts', () => {
  test('accepts only supported document extensions', () => {
    for (const extension of ['txt', 'md', 'doc', 'docx', 'pdf'] as const) expect(documentExtensionSchema.parse(extension)).toBe(extension);
    expect(() => documentExtensionSchema.parse('rtf')).toThrow();
  });

  test('uses only semantic Content fields to build embeddings', () => {
    expect(foldersEmbeddingFields).toEqual(['name', 'description']);
    expect(documentsEmbeddingFields).toEqual(['name', 'content']);
    expect(documentVersionsEmbeddingFields).toEqual(['content']);
    expect(documentSharesEmbeddingFields).toEqual([]);
    expect(buildEmbeddingText(documentsEmbeddingFields, { name: 'Roadmap', content: 'Ship Content V1', html: '<p>Ship Content V1</p>' })).toBe('Roadmap\n\nShip Content V1');
    expect(buildEmbeddingText(documentSharesEmbeddingFields, { token: 'not-embedded' })).toBeNull();
  });

  test('defaults Content resources to active and validates lifecycle timestamps', () => {
    for (const schema of [folderSchema, documentSchema, documentVersionSchema, documentShareSchema]) {
      expect(schema.shape.deletedAt.parse(undefined)).toBeNull();
      expect(schema.shape.deletedAt.parse('2026-07-22T00:00:00.000Z')).toBe('2026-07-22T00:00:00.000Z');
      expect(() => schema.shape.deletedAt.parse('yesterday')).toThrow();
    }
    expect(folderSchema.shape.isFavorite.parse(undefined)).toBe(false);
    expect(documentSchema.shape.isFavorite.parse(undefined)).toBe(false);
    expect(() => folderSchema.shape.isFavorite.parse('yes')).toThrow();
    expect(() => documentSchema.shape.isFavorite.parse(1)).toThrow();
  });

  test('versions contain complete immutable HTML snapshots', () => {
    const snapshot = documentVersionSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 2, label: 'Before launch', html: '<p>Launch</p>',
      content: 'Launch', embedding, createdAt: '2026-07-22T10:00:00.000Z',
    });
    expect(snapshot).toMatchObject({ version: 2, label: 'Before launch', content: 'Launch' });
    expect(snapshot.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(snapshot).not.toHaveProperty('storageKey');
    expect(snapshot).not.toHaveProperty('sizeBytes');
    expect(() => documentVersionSchema.parse({ ...snapshot, html: '   ' })).toThrow();
    expect(() => documentVersionSchema.parse({ ...snapshot, content: '   ' })).toThrow();
  });

  test('shares persist hashes and strip plaintext tokens', () => {
    const share = documentShareSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      permission: 'read', tokenHash: 'a'.repeat(64), token: 'plaintext-secret', embedding: [],
      createdAt: '2026-07-22T10:00:00.000Z', updatedAt: '2026-07-22T10:00:00.000Z',
    });
    expect(share.tokenHash).toBe('a'.repeat(64));
    expect(share).not.toHaveProperty('token');
    expect(share).not.toHaveProperty('embedding');
    expect(documentShareSchema.parse({ ...share, permission: 'comment' }).permission).toBe('comment');
    expect(() => documentShareSchema.parse({ ...share, permission: 'view' })).toThrow();
    expect(() => documentShareSchema.parse({ ...share, permission: 'edit' })).toThrow();
    expect(documentShareSchema.parse({ ...share, embedding: [1] })).not.toHaveProperty('embedding');
  });

  test('requires nonempty finite embeddings for persisted document snapshots', () => {
    const snapshot = {
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 1, html: '<p>Text</p>', content: 'Text', createdAt: '2026-07-22T10:00:00.000Z',
    };
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [] })).toThrow();
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [Number.NaN] })).toThrow();
  });

  test('search and active-share queries allow roots and guard folder ownership', async () => {
    const searchSource = await Bun.file(new URL('./documents.node.ts', import.meta.url)).text();
    const shareSource = await Bun.file(new URL('./document-shares.node.ts', import.meta.url)).text();
    expect(searchSource).toContain("const folderKeys = input.folderKeys?.length ? input.folderKeys : null");
    expect(searchSource.match(/folder == null \|\| folder.scopeKey == document.scopeKey/g)).toHaveLength(2);
    expect(searchSource).not.toContain('version.updatedAt');
    expect(shareSource).toContain('document != null && document.scopeKey == share.scopeKey');
    expect(shareSource).toContain('folder == null || folder.scopeKey == share.scopeKey');
  });
});
