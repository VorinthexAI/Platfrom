import { describe, expect, test } from 'bun:test';
import { buildEmbeddingText } from './base';
import { documentExtensionSchema, documentSchema, documentsEmbeddingFields } from './documents.node';
import { documentShareSchema, documentSharesEmbeddingFields } from './document-shares.node';
import { folderSchema, foldersEmbeddingFields } from './folders.node';
import { documentVersionSchema, documentVersionsEmbeddingFields } from './document-versions.node';
import { documentAudioVersionSchema } from './document-audio-versions.node';
import { documentSummarySchema } from './document-summaries.node';
import { EMBEDDING_DIMENSIONS } from '../embeddings';
import { chunkDocumentContent } from '../ai/document-processing/chunking';

const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.1);

describe('Content node contracts', () => {
  test('accepts only supported document extensions', () => {
    for (const extension of ['txt', 'md', 'doc', 'docx', 'pdf'] as const) expect(documentExtensionSchema.parse(extension)).toBe(extension);
    expect(() => documentExtensionSchema.parse('rtf')).toThrow();
  });

  test('uses only semantic Content fields to build embeddings', () => {
    expect(foldersEmbeddingFields).toEqual(['name', 'description']);
    expect(documentsEmbeddingFields).toEqual(['name', 'content']);
    expect(documentVersionsEmbeddingFields).toEqual(['label', 'content']);
    expect(documentSharesEmbeddingFields).toEqual([]);
    expect(buildEmbeddingText(documentsEmbeddingFields, { name: 'Roadmap', content: 'Ship Content V1' })).toBe('Roadmap\n\nShip Content V1');
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
  });

  test('versions contain complete immutable plain-text snapshots', () => {
    const snapshot = documentVersionSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 2, label: 'Before launch',
      content: ['Launch'], embedding, chunkEmbeddings: [embedding], createdAt: '2026-07-22T10:00:00.000Z',
    });
    expect(snapshot).toMatchObject({ version: 2, label: 'Before launch', content: 'Launch' });
    expect(snapshot.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(snapshot.chunkEmbeddings).toEqual([embedding]);
    expect(snapshot).not.toHaveProperty('storageKey');
    expect(snapshot).not.toHaveProperty('sizeBytes');
    expect(documentVersionSchema.parse({ ...snapshot, html: '<p>ignored</p>' })).not.toHaveProperty('html');
    expect(() => documentVersionSchema.parse({ ...snapshot, content: '   ' })).toThrow();
  });

  test('audio versions are independent immutable document representations', () => {
    const audio = documentAudioVersionSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 3, sourceContentHash: 'a'.repeat(64), sourceTitle: 'Document', sourceDocumentUpdatedAt: '2026-07-22T09:00:00.000Z',
      storageKey: 'content/document/audio/version.mp3', mimeType: 'audio/mpeg', sizeBytes: 128, durationMs: 1_200,
      includeTitle: false, includeCode: false, createdByKey: 'cm00000000000000000000004', createdAt: '2026-07-22T10:00:00.000Z',
    });
    expect(audio).toMatchObject({ version: 3, documentKey: 'cm00000000000000000000003', isCurrent: false, playbackPositionMs: 0 });
    expect(audio).not.toHaveProperty('documentVersionKey');
    expect(() => documentAudioVersionSchema.parse({ ...audio, durationMs: 0 })).toThrow();
    expect(() => documentAudioVersionSchema.parse({ ...audio, playbackPositionMs: -1 })).toThrow();
  });

  test('summaries are immutable child records and strip Arango private fields', () => {
    const summary = documentSummarySchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 1, summary: 'Concise summary.', topic: 'Launch', style: 'brief', sourceContentHash: 'a'.repeat(64), sourceTitle: 'Document',
      sourceDocumentUpdatedAt: '2026-07-22T09:00:00.000Z', createdByKey: 'cm00000000000000000000004', createdAt: '2026-07-22T10:00:00.000Z',
      _id: 'documentSummaries/private', _rev: 'private',
    });
    expect(summary).not.toHaveProperty('_id');
    expect(summary).not.toHaveProperty('_rev');
    expect(() => documentSummarySchema.parse({ ...summary, version: 0 })).toThrow();
  });

  test('version content arrays reconstruct canonical text exactly', () => {
    const content = `${Array.from({ length: 1_050 }, (_, index) => `word${index}`).join(' ')}\n\nFinal paragraph.`;
    const chunks = chunkDocumentContent(content);
    const snapshot = documentVersionSchema.parse({
      key: 'cm00000000000000000000001', scopeKey: 'cm00000000000000000000002', documentKey: 'cm00000000000000000000003',
      version: 1, content: chunks, embedding, chunkEmbeddings: chunks.map(() => embedding), createdAt: '2026-07-22T10:00:00.000Z',
    });
    expect(snapshot.content).toBe(content);
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
      version: 1, content: 'Text', createdAt: '2026-07-22T10:00:00.000Z',
    };
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [] })).toThrow();
    expect(() => documentVersionSchema.parse({ ...snapshot, embedding: [Number.NaN] })).toThrow();
  });

  test('search and active-share queries allow roots and guard folder ownership', async () => {
    const searchSource = await Bun.file(new URL('./documents.node.ts', import.meta.url)).text();
    const shareSource = await Bun.file(new URL('./document-shares.node.ts', import.meta.url)).text();
    expect(searchSource).toContain("const folderKeys = input.folderKeys?.length ? input.folderKeys : null");
    expect(searchSource.match(/folder == null \|\| folder.scopeKey == document.scopeKey/g)).toHaveLength(2);
    expect(searchSource).toContain('document.chunkEmbeddings');
    expect(searchSource).toContain('version.chunkEmbeddings');
    expect(searchSource).toContain('LET score = MAX(scores)');
    expect(searchSource.match(/input\.minScore \?\? -1/g)).toHaveLength(2);
    expect(searchSource).not.toContain('version.updatedAt');
    expect(shareSource).toContain('document != null && document.scopeKey == share.scopeKey');
    expect(shareSource).toContain('folder == null || folder.scopeKey == share.scopeKey');
  });
});
