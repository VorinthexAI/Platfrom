import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book hard deletion', () => {
  test('removes only canonical Ascend records and enqueues canonical media', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const queries: string[] = []; let writes: string[] = [];
    const database: BookDatabase = { async query(query, bind = {}) {
      queries.push(query);
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (query.includes('RETURN { book, chapters }')) return { all: async () => [{ book: { coverStorageKey: 'books/cover.png', archiveFolderKey: newId() }, chapters: [{ _key: chapterKey, archiveDocumentKey: newId(), audioStorageKey: 'books/chapter.mp3', imageStorageKey: 'books/chapter.png' }] }] };
      return { all: async () => [] };
    } };
    const transact = async <T>(collections: { write: string[] }, run: (executor: BookDatabase) => Promise<T>) => { writes = collections.write; return run(database); };
    await expect(createBookRepository(database, transact).deleteBook({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, '2026-08-25T12:00:00.000Z')).resolves.toEqual({ deleted: true, bookKey });
    expect(queries.filter((query) => query.includes('IN storageDeletionJobs'))).toHaveLength(3);
    expect(queries.some((query) => query.includes('REMOVE @bookKey IN books'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE item IN bookChapters'))).toBe(true);
    expect(queries.some((query) => query.includes('REMOVE') && (query.includes(' IN documents') || query.includes(' IN folders') || query.includes(' IN images')))).toBe(false);
    for (const collection of ['books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'storageDeletionJobs']) expect(writes).toContain(collection);
    for (const independent of ['folders', 'documents', 'images', 'collections']) expect(writes).not.toContain(independent);
  });
});
