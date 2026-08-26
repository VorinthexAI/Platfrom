import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { bookSchema } from '@/lib/db/books.node';
import { bookChapterSchema } from '@/lib/db/book-chapters.node';
import { bookSourceSchema } from '@/lib/db/book-sources.node';
import { legacyBookPatch, legacyReadyBookPatch, migrateDurableBookGeneration } from './arango-migrate';
import { newId } from '@/lib/ids';

const key = 'cmrnlzf650002qc7k4p5zem5w'; const scopeKey = 'cmrnlzf640001qc7kazsr96k5'; const now = '2026-08-08T12:00:00.000Z'; const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);

describe('durable book generation migration', () => {
  test('backfills legacy books, chapters, and source snapshots into parseable records', async () => {
    const records: Record<string, Record<string, unknown>[]> = {
      books: [{ _key: key, scopeKey, title: 'Legacy book', description: 'Old description', goal: 'Learn', audience: 'Reader', outcome: 'Understand', language: 'English', status: 'generating', chapterCount: 3, estimatedMinutes: 10, embedding, createdAt: now, updatedAt: now }],
      bookChapters: [{ _key: key, scopeKey, bookKey: key, title: 'Opening', description: 'Legacy opening', objective: 'Orient the listener', content: 'Legacy prose', status: 'written', position: 1, embedding, createdAt: now, updatedAt: now }],
      bookSources: [{ _key: key, scopeKey, bookKey: key, sourceType: 'document', sourceKey: scopeKey, title: 'Notes', content: 'Stable source snapshot', relevance: 'Selected evidence', embedding, createdAt: now }],
      documents: [],
    };
    const target: any = {
      collection: () => ({ exists: async () => true }),
      query: async (query: string, bind?: Record<string, unknown>) => {
        const read = query.match(/^FOR record IN (\w+)/); if (read) return { all: async () => records[read[1]!] ?? [] };
        const update = query.match(/ IN (\w+)$/); if (update) { const row = records[update[1]!]!.find((item) => item._key === bind?.key)!; Object.assign(row, bind?.patch); }
        return { all: async () => [] };
      },
    };
    await migrateDurableBookGeneration(target);
    const once = JSON.stringify(records);
    await migrateDurableBookGeneration(target);
    expect(JSON.stringify(records)).toBe(once);
    const migratedBook = bookSchema.parse({ ...records.books[0], key, _key: undefined });
    expect(migratedBook).toMatchObject({ status: 'failed', generationStage: 'draft', generationAttempt: 0, narrationPace: 1, narratorVoiceKey: 'clear' });
    expect(migratedBook.generationError).toContain('no resumable input'); expect(migratedBook.generationBriefFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(bookChapterSchema.parse({ ...records.bookChapters[0], key, _key: undefined })).toMatchObject({ evidenceKeyPoints: ['Orient the listener'], targetWordMin: 500, targetWordMax: 750 });
    expect(bookSourceSchema.parse({ ...records.bookSources[0], key, _key: undefined })).toMatchObject({ sourceUpdatedAt: now });
    expect(records.bookSources[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('fails interrupted records without resumable input but preserves recoverable durable work', () => {
    expect(legacyBookPatch({ status: 'planning', chapterCount: 10 }).status).toBe('failed');
    expect(legacyBookPatch({ status: 'planning', chapterCount: 10 }).generationError).toContain('no resumable input');
    const generationInput = { topic: 'Decisions', goal: 'Decide well', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1, chapterImages: false };
    expect(legacyBookPatch({ status: 'planning', chapterCount: 10, generationInput, generationOwnerKey: key }).status).toBe('planning');
  });

  test('moves legacy ready books without playable audio to retryable or non-retryable failure', () => {
    const generationInput = { topic: 'Decisions', goal: 'Decide well', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1, chapterImages: false };
    const chapters = Array.from({ length: 10 }, (_, index) => ({ archiveDocumentKey: `${key.slice(0, -1)}${index}`, content: 'Transcript', audioStorageKey: index === 0 ? undefined : `audio-${index}`, audioDurationSeconds: index === 0 ? undefined : 60 }));
    const resumable = legacyReadyBookPatch({ status: 'ready', scopeKey, chapterCount: 10, coverStorageKey: 'cover', generationInput, generationOwnerKey: key }, chapters, new Set());
    expect(resumable).toMatchObject({ status: 'failed', generationStage: 'audio', generationError: expect.stringContaining('Retry the book') });
    const nonResumable = legacyReadyBookPatch({ status: 'ready', scopeKey, chapterCount: 10 }, chapters, new Set());
    expect(nonResumable).toMatchObject({ status: 'failed', generationError: expect.stringContaining('no resumable input') });
    expect(legacyReadyBookPatch({ ...resumable, scopeKey, chapterCount: 10 }, chapters, new Set())).toEqual({});
  });

  test('preserves a ready book only when audio and canonical Archive publication are valid', () => {
    const archiveFolderKey = key;
    const bookKey = newId(); const chapters = Array.from({ length: 10 }, (_, index) => ({ _key: newId(), archiveDocumentKey: `document-${index}`, audioStorageKey: `audio-${index}`, audioDurationSeconds: 60 }));
    const publications = new Set(chapters.map((chapter) => `${scopeKey}:${bookKey}:${archiveFolderKey}:${chapter.archiveDocumentKey}:${chapter._key}`));
    const book = { _key: bookKey, status: 'ready', scopeKey, chapterCount: 10, coverStorageKey: 'cover', archiveFolderKey };
    expect(legacyReadyBookPatch(book, chapters, publications)).toEqual({});
    expect(legacyReadyBookPatch(book, chapters, new Set())).toMatchObject({ status: 'failed', generationStage: 'draft' });
  });

  test('applies ready-book recovery through the idempotent database migration', async () => {
    const invalidKey = newId(); const validKey = newId(); const folderKey = newId(); const generationOwnerKey = newId();
    const generationInput = { topic: 'Decisions', goal: 'Decide well', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1, chapterImages: false };
    const books = [
      { _key: invalidKey, scopeKey, status: 'ready', chapterCount: 10, coverStorageKey: 'cover', generationInput, generationOwnerKey },
      { _key: validKey, scopeKey, status: 'ready', chapterCount: 10, coverStorageKey: 'cover', archiveFolderKey: folderKey },
    ];
    const bookChapters = [...Array.from({ length: 10 }, (_, index) => ({ _key: newId(), scopeKey, bookKey: invalidKey, title: `Invalid ${index}`, description: 'Description', objective: 'Objective', content: 'Transcript', audioStorageKey: index ? `invalid-audio-${index}` : undefined, audioDurationSeconds: index ? 60 : undefined })), ...Array.from({ length: 10 }, (_, index) => { const chapterKey = newId(); return { _key: chapterKey, scopeKey, bookKey: validKey, title: `Valid ${index}`, description: 'Description', objective: 'Objective', archiveDocumentKey: chapterKey, audioStorageKey: `valid-audio-${index}`, audioDurationSeconds: 60 }; })];
    const documents = bookChapters.flatMap((chapter) => chapter.bookKey === validKey && 'archiveDocumentKey' in chapter ? [{ _key: chapter.archiveDocumentKey, scopeKey, folderKey, managedPurpose: 'audio-chapter' }] : []);
    const folders = [{ _key: folderKey, scopeKey, managedPurpose: 'audio-book', managedOwnerKey: validKey }];
    const generatedDocumentBindings = bookChapters.flatMap((chapter) => chapter.bookKey === validKey && 'archiveDocumentKey' in chapter ? [{ _key: newId(), scopeKey, documentKey: chapter.archiveDocumentKey, subjectType: 'chapter', subjectKey: chapter._key, kind: 'chapter' }] : []);
    const records: Record<string, Record<string, unknown>[]> = { books, bookChapters, bookSources: [], documents, folders, generatedDocumentBindings };
    const target: any = { collection: () => ({ exists: async () => true }), query: async (query: string, bind?: Record<string, unknown>) => { const read = query.match(/^FOR record IN (\w+)/); if (read) return { all: async () => records[read[1]!] ?? [] }; const update = query.match(/ IN (\w+)$/); if (update) Object.assign(records[update[1]!]!.find((item) => item._key === bind?.key)!, bind?.patch); return { all: async () => [] }; } };
    await migrateDurableBookGeneration(target);
    expect(books[0]).toMatchObject({ status: 'failed', generationStage: 'audio', generationError: expect.stringContaining('Retry the book') });
    expect(books[1]).toMatchObject({ status: 'ready' });
    const once = JSON.stringify(records); await migrateDurableBookGeneration(target); expect(JSON.stringify(records)).toBe(once);
  });
});
