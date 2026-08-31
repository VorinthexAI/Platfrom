import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRepository } from './repository';

const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);

describe('book Archive publication', () => {
  test('atomically converges canonical chapter documents, bindings, and source links', async () => {
    const scopeKey = newId(), userKey = newId(), bookKey = newId(), chapterKey = newId(), documentKey = newId(), timestamp = '2026-08-27T12:00:00.000Z';
    const calls: Array<{ query: string; bind: Record<string, any> }> = [];
    const database: any = { query: async (query: string, bind: Record<string, any> = {}) => { calls.push({ query, bind }); return { all: async () => query.includes('userOrganizations') ? [1] : query.includes('RETURN book') ? [{ title: 'Book', description: 'Description', embedding, createdAt: timestamp }] : query.includes('RETURN true') ? [true] : [] }; } };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    const context = { organizationKey: 'org', scopeKey, userKey, generationLeaseToken: 'owner' };
    await repository.publishArchive(context, bookKey, [{
      chapterKey,
      document: { key: documentKey, scopeKey, folderKey: `c${'a'.repeat(24)}`, name: 'Chapter', content: 'Chapter summary', embedding, contentChunks: ['Chapter summary'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'b'.repeat(64), mutationPolicy: 'user', isFavorite: false, createdAt: timestamp, updatedAt: timestamp },
      binding: { key: newId(), scopeKey, documentKey, subjectType: 'chapter', subjectKey: chapterKey, kind: 'chapter', provenance: 'generated', createdByKey: userKey, idempotencyKey: `book-chapter-export:${chapterKey}`, requestHash: 'c'.repeat(64), createdAt: timestamp, updatedAt: timestamp },
    }], timestamp).catch((error) => {
      // The folder key is deterministic and intentionally validated before any write.
      expect(error).toMatchObject({ reason: 'forbidden' });
    });
    expect(calls).toHaveLength(0);

    const folderKey = `c${createHash('sha256').update(['archive-book-export', scopeKey, bookKey].join('\0')).digest('hex').slice(0, 24)}`;
    await repository.publishArchive(context, bookKey, [{
      chapterKey,
      document: { key: documentKey, scopeKey, folderKey, name: 'Chapter', content: 'Chapter summary', embedding, contentChunks: ['Chapter summary'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'b'.repeat(64), mutationPolicy: 'user', isFavorite: false, createdAt: timestamp, updatedAt: timestamp },
      binding: { key: newId(), scopeKey, documentKey, subjectType: 'chapter', subjectKey: chapterKey, kind: 'chapter', provenance: 'generated', createdByKey: userKey, idempotencyKey: `book-chapter-export:${chapterKey}`, requestHash: 'c'.repeat(64), createdAt: timestamp, updatedAt: timestamp },
    }], timestamp);
    expect(calls.some(({ query }) => query.includes('contentChunks: @document.contentChunks'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('extension: null') && query.includes('sourceStorageKeys: null') && query.includes('keepNull: false'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('IN generatedDocumentBindings'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('archiveDocumentKey: @documentKey'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('archiveFolderKey: @folderKey'))).toBe(true);
    expect(calls.filter(({ query }) => query.includes('UPSERT { _key: @') && query.includes('IN folders'))).toHaveLength(2);
  });

  test('requires completed Archive links before canonical readiness', async () => {
    const queries: string[] = [];
    const database: any = { query: async (query: string) => { queries.push(query); return { all: async () => query.includes('userOrganizations') ? [1] : query.includes('UPDATE book WITH { status: "ready"') ? [10] : [] }; } };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    await repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString());
    const canonical = queries.find((query) => query.includes('UPDATE book WITH { status: "ready"'))!;
    expect(canonical).toContain('book.archiveFolderKey != null');
    expect(canonical).toContain('chapter.archiveDocumentKey == null');
    expect(canonical).not.toContain('imageStorageKey');
    expect(canonical).not.toContain('folders');
    expect(canonical).not.toContain('documents');
  });

  test('rejects canonical publication when an atomic prerequisite is missing', async () => {
    const database: any = { query: async (query: string) => ({ all: async () => query.includes('userOrganizations') ? [1] : [] }) };
    const repository = createBookRepository(database, async (_collections, operation) => operation(database));
    await expect(repository.publishChapters({ organizationKey: 'org', scopeKey: newId(), userKey: newId(), generationLeaseToken: 'owner' }, newId(), 10, new Date().toISOString())).rejects.toMatchObject({ reason: 'conflict' });
  });
});
