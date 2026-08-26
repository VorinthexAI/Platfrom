import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRepository, type BookDatabase } from './repository';

describe('book hard deletion', () => {
  test('atomically removes Archive dependents and enqueues every storage object', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const documentKey = newId(); const folderKey = newId(); const tripKey = newId();
    const remaining = new Set(['book', 'chapterContext', 'bookContext', 'chapter', 'progress', 'version', 'summary', 'summaryAudio', 'audioVersion', 'legacyShare', 'share', 'tag', 'documentHidden', 'folderHidden', 'attachment', 'binding', 'document', 'folder']);
    const outbox = new Set<string>(); let tripTouched = false; let transactionWrites: string[] = [];
    const database: BookDatabase = { async query(query, bind = {}) {
      let values: unknown[] = [];
      if (query.includes('COLLECTIONS()')) values = [true];
      else if (query.includes('RETURN membership._key')) values = ['membership'];
      else if (query.includes('RETURN { book, chapters }')) values = [{ book: { coverStorageKey: 'cover', archiveFolderKey: folderKey }, chapters: [{ _key: chapterKey, archiveDocumentKey: documentKey, audioStorageKey: 'audio', imageStorageKey: 'image' }] }];
      else if (query.includes('LET versions =')) values = [['version-storage']];
      else if (query.includes('UPSERT { storageKey:')) outbox.add(String(bind.storageKey));
      else if (query.includes('REMOVE item IN chapterContexts')) remaining.delete('chapterContext');
      else if (query.includes('REMOVE item IN bookContexts')) remaining.delete('bookContext');
      else if (query.includes('REMOVE item IN bookChapters')) remaining.delete('chapter');
      else if (query.includes('REMOVE item IN bookProgress')) remaining.delete('progress');
      else if (query.includes('REMOVE item IN documentVersions')) remaining.delete('version');
      else if (query.includes('REMOVE item IN documentSummaries')) remaining.delete('summary');
      else if (query.includes('REMOVE item IN documentSummaryAudio')) remaining.delete('summaryAudio');
      else if (query.includes('REMOVE item IN documentAudioVersions')) remaining.delete('audioVersion');
      else if (query.includes('REMOVE share IN documentShares')) remaining.delete('legacyShare');
      else if (query.includes('REMOVE share IN shares')) remaining.delete('share');
      else if (query.includes('REMOVE assignment IN tagAssignments')) remaining.delete('tag');
      else if (query.includes('REMOVE hidden IN userHiddens')) { remaining.delete('documentHidden'); remaining.delete('folderHidden'); }
      else if (query.includes('REMOVE attachment IN tripAttachments')) { remaining.delete('attachment'); values = [tripKey]; }
      else if (query.includes('UPDATE trip WITH')) tripTouched = true;
      else if (query.includes('REMOVE binding IN generatedDocumentBindings')) remaining.delete('binding');
      else if (query.includes('REMOVE document IN documents')) remaining.delete('document');
      else if (query.includes('REMOVE folder IN folders')) remaining.delete('folder');
      else if (query.includes('REMOVE @bookKey IN books')) remaining.delete('book');
      return { all: async () => values };
    } };
    const transact = async <T>(collections: { write: string[] }, operation: (executor: BookDatabase) => Promise<T>) => { transactionWrites = collections.write; return operation(database); };
    const result = await createBookRepository(database, transact).deleteBook({ organizationKey: 'org', scopeKey, userKey: newId() }, bookKey, '2026-08-25T12:00:00.000Z');
    expect(result).toEqual({ deleted: true, bookKey }); expect(remaining).toEqual(new Set()); expect(outbox).toEqual(new Set(['cover', 'audio', 'image', 'version-storage'])); expect(tripTouched).toBe(true);
    for (const collection of ['documentShares', 'shares', 'tagAssignments', 'userHiddens', 'tripAttachments', 'trips', 'storageDeletionJobs']) expect(transactionWrites).toContain(collection);
  });
});
