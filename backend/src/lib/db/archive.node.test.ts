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

  test('supports archival timestamps on mutable folders and documents', () => {
    const timestamps = { createdAt: '2026-07-22T10:00:00.000Z', updatedAt: '2026-07-22T10:00:00.000Z', archivedAt: '2026-07-22T11:00:00.000Z' };
    expect(folderSchema.parse({ key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', name: 'Old', embedding: [], ...timestamps }).archivedAt).toBe(timestamps.archivedAt);
    expect(documentSchema.shape.archivedAt).toBeDefined();
  });

  test('versions contain complete immutable editor snapshots', () => {
    const snapshot = documentVersionSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 2, label: 'Before launch', html: '<p>Launch</p>', json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch' }] }] },
      content: 'Launch', embedding: [0.1, 0.2], createdAt: '2026-07-22T10:00:00.000Z',
    });
    expect(snapshot).toMatchObject({ version: 2, label: 'Before launch', content: 'Launch', embedding: [0.1, 0.2] });
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
    expect(share.embedding).toEqual([]);
    expect(documentShareSchema.parse({ ...share, permission: 'comment' }).permission).toBe('comment');
    expect(() => documentShareSchema.parse({ ...share, permission: 'view' })).toThrow();
    expect(() => documentShareSchema.parse({ ...share, permission: 'edit' })).toThrow();
    expect(() => documentShareSchema.parse({ ...share, embedding: [1] })).toThrow();
  });

  test('requires nonempty finite embeddings for persisted document snapshots', () => {
    const snapshot = {
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 1, html: '<p>Text</p>', json: { type: 'doc' as const }, content: 'Text', createdAt: '2026-07-22T10:00:00.000Z',
    };
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [] })).toThrow();
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [Number.NaN] })).toThrow();
  });

  test('search and active-share queries require live folder ownership', async () => {
    const searchSource = await Bun.file(new URL('./documents.node.ts', import.meta.url)).text();
    const shareSource = await Bun.file(new URL('./document-shares.node.ts', import.meta.url)).text();
    expect(searchSource).toContain("const folderKeys = input.folderKeys?.length ? input.folderKeys : null");
    expect(searchSource.match(/folder != null && folder.scopeKey == document.scopeKey/g)).toHaveLength(2);
    expect(searchSource).toContain('version.updatedAt != null ? version.updatedAt : version.createdAt');
    expect(shareSource).toContain('document != null && document.scopeKey == share.scopeKey');
    expect(shareSource).toContain('folder != null && folder.scopeKey == share.scopeKey');
  });
});
