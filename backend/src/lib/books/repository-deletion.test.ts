import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRepository, type BookDatabase } from './repository';

describe('book hard deletion', () => {
  test('removes only canonical Ascend records and enqueues canonical media', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const shareTokenHash = 'a'.repeat(64); const queries: string[] = []; let writes: string[] = [];
    const database: BookDatabase = { async query(query, bind = {}) {
      queries.push(query);
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (query.includes('RETURN { book, chapters }')) return { all: async () => [{ book: { isFavorite: false, coverStorageKey: 'books/cover.png', archiveFolderKey: newId() }, chapters: [{ _key: chapterKey, archiveDocumentKey: newId(), audioStorageKey: 'books/chapter.mp3', imageStorageKey: 'books/chapter.png' }] }] };
      if (query.includes('RETURN OLD.tokenHash')) return { all: async () => [shareTokenHash] };
      return { all: async () => [] };
    } };
    const transact = async <T>(collections: { write: string[] }, run: (executor: BookDatabase) => Promise<T>) => { writes = collections.write; return run(database); };
    await expect(createBookRepository(database, transact).deleteBook({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, '2026-08-25T12:00:00.000Z')).resolves.toEqual({ deleted: true, bookKey, shareTokenHash });
    expect(queries.filter((query) => query.includes('IN storageDeletionJobs'))).toHaveLength(3);
    expect(queries.some((query) => query.includes('REMOVE @bookKey IN books'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE item IN bookChapters'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE binding IN generatedDocumentBindings'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE') && (query.includes(' IN documents') || query.includes(' IN folders') || query.includes(' IN images')))).toBe(false);
    for (const collection of ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'generatedDocumentBindings', 'storageDeletionJobs', 'shares']) expect(writes).toContain(collection);
    for (const independent of ['folders', 'documents', 'images', 'collections']) expect(writes).not.toContain(independent);
  });

  test('blocks favorite deletion before enqueuing media or removing records', async () => {
    const scopeKey = newId(); const bookKey = newId(); const queries: string[] = [];
    const database: BookDatabase = { async query(query) {
      queries.push(query);
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (query.includes('RETURN { book, chapters }')) return { all: async () => [{ book: { isFavorite: true }, chapters: [] }] };
      return { all: async () => [] };
    } };
    const repository = createBookRepository(database, async (_collections, run) => run(database));
    await expect(repository.deleteBook({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, '2026-08-25T12:00:00.000Z')).rejects.toMatchObject({ reason: 'favorite', message: 'Unfavorite the audio book before deleting it.' });
    expect(queries.some((query) => query.includes('IN storageDeletionJobs') || query.includes('REMOVE'))).toBe(false);
  });

  test('deletes legacy audio books that predate share records', async () => {
    const scopeKey = newId(); const bookKey = newId(); let removed = false;
    const database: BookDatabase = { async query(query) {
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (query.includes('RETURN { book, chapters }')) return { all: async () => [{ book: { isFavorite: false }, chapters: [] }] };
      if (query.includes('RETURN OLD.tokenHash')) return { all: async () => [] };
      if (query.includes('REMOVE @bookKey IN books')) removed = true;
      return { all: async () => [] };
    } };
    const repository = createBookRepository(database, async (_collections, run) => run(database));
    await expect(repository.deleteBook({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, '2026-08-25T12:00:00.000Z')).resolves.toEqual({ deleted: true, bookKey, shareTokenHash: null });
    expect(removed).toBe(true);
  });

  test('persists favorite state only on an authorized scoped book', async () => {
    const scopeKey = newId(); const bookKey = newId(); const calls: Array<{ query: string; bind: Record<string, unknown> }> = [];
    const persisted = { _key: bookKey, scopeKey, title: 'Decisions', description: 'Decide well', goal: 'Decide well', audience: 'Readers', outcome: 'Better decisions', language: 'English', generationStage: 'complete', generationCompletedUnits: 1, generationTotalUnits: 1, generationAttempt: 0, estimatedMinutes: 10, chapterCount: 10, isFavorite: true, status: 'ready', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: '2026-08-25T12:00:00.000Z', updatedAt: '2026-08-25T12:01:00.000Z' };
    const database: BookDatabase = { async query(query, bind = {}) {
      calls.push({ query, bind });
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (query.includes('UPDATE book WITH { isFavorite:')) return { all: async () => [persisted] };
      return { all: async () => [] };
    } };
    await expect(createBookRepository(database).setFavorite({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, true, persisted.updatedAt)).resolves.toMatchObject({ key: bookKey, isFavorite: true });
    expect(calls.find(({ query }) => query.includes('UPDATE book WITH { isFavorite:'))?.bind).toMatchObject({ bookKey, scopeKey, isFavorite: true, now: persisted.updatedAt });
  });
});
