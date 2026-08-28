import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { legacyBookChapterPatch, legacyBookPatch, legacyBookSourcePatch, migrateDurableBookGeneration } from './arango-migrate';

const now = '2026-08-08T12:00:00.000Z'; const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);

describe('canonical book persistence migration', () => {
  test('reverse-backfills managed Archive state into canonical rows idempotently', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const calls: Array<{ query: string; bind?: Record<string, unknown> }> = [];
    const book = { _key: bookKey, scopeKey, title: 'Legacy book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Understand', language: 'English', status: 'ready', chapterCount: 1, estimatedMinutes: 2, coverStorageKey: 'legacy-cover', embedding, createdAt: now, updatedAt: now };
    const chapter = { _key: chapterKey, scopeKey, bookKey, title: 'Opening', description: 'Opening brief', objective: 'Orient', content: 'Published prose', status: 'audio-ready', position: 1, audioStorageKey: 'audio', audioDurationSeconds: 60, imageStorageKey: 'legacy-art', embedding, createdAt: now, updatedAt: now };
    const target: any = {
      collection: () => ({ exists: async () => true, create: async () => {} }),
      query: async (query: string, bind?: Record<string, unknown>) => {
        calls.push({ query, bind });
        if (query === 'FOR record IN books RETURN record') return { all: async () => [book] };
        if (query === 'FOR record IN bookChapters RETURN record') return { all: async () => [chapter] };
        if (query.includes('FOR record IN documents FILTER')) return { all: async () => [] };
        if (query === 'FOR record IN bookSources RETURN record') return { all: async () => [] };
        if (query.startsWith('RETURN LENGTH(FOR book IN books')) return { all: async () => [1] };
        if (query === 'RETURN LENGTH(books)') return { all: async () => [1] };
        return { all: async () => [], next: async () => 0 };
      },
    };
    await migrateDurableBookGeneration(target); const first = calls.map(({ query, bind }) => ({ query, bind })); calls.length = 0; await migrateDurableBookGeneration(target);
    expect(calls.map(({ query, bind }) => ({ query, bind }))).toEqual(first);
    expect(first.some(({ query }) => query.includes('UPSERT { _key: folder._key }') && query.includes('IN books'))).toBe(true);
    expect(first.some(({ query }) => query.includes('UPSERT { _key: document._key }') && query.includes('IN bookChapters'))).toBe(true);
    expect(first.some(({ query }) => query.includes('document.audioChapter.readerProgress') && query.includes('IN bookProgress'))).toBe(true);
    expect(first.some(({ query }) => query.includes('audioBook: null') && query.includes('mutationPolicy: "user"'))).toBe(true);
    expect(first.some(({ query }) => query.includes('audioChapter: null') && query.includes('mutationPolicy: "user"'))).toBe(true);
    expect(first.some(({ query }) => query.includes('purpose == "audio-book-media"') && query.includes('purpose: null'))).toBe(true);
    expect(first.some(({ query, bind }) => query.includes('FOR resource IN @@collection') && bind?.['@collection'] === 'books')).toBe(true);
    expect(first.some(({ query, bind }) => query.includes('FOR resource IN @@collection') && bind?.['@collection'] === 'bookChapters')).toBe(true);
    expect(first.some(({ query }) => query.includes('INSERT') && query.includes('IN images'))).toBe(false);
    for (const { query, bind = {} } of first) {
      const declared = [...new Set([
        ...[...query.matchAll(/(?<!@)@([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => match[1]!),
        ...[...query.matchAll(/@@([A-Za-z][A-Za-z0-9_]*)/g)].map((match) => `@${match[1]}`),
      ])].sort();
      expect(Object.keys(bind).sort()).toEqual(declared);
    }
    expect(first.some(({ query }) => query.includes('REMOVE binding IN generatedDocumentBindings'))).toBe(false);
  });

  test('backfills durable legacy defaults without inventing resumable input', () => {
    expect(legacyBookPatch({ status: 'planning', chapterCount: 10 })).toMatchObject({ status: 'failed', generationStage: 'accepted', narratorVoiceKey: 'clear', narrationPace: 1 });
    expect(legacyBookChapterPatch({ title: 'Opening', description: 'Brief', objective: 'Orient' })).toMatchObject({ evidenceKeyPoints: ['Orient'], targetWordMin: 775, targetWordMax: 850 });
    expect(legacyBookSourcePatch({ content: 'snapshot', sourceType: 'document', createdAt: now })).toMatchObject({ sourceUpdatedAt: now, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  test('unpacks nested managed metadata into canonical collections before cleanup', async () => {
    const calls: string[] = [];
    const existing = new Set(['books', 'folders', 'documents', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'chapterContexts', 'bookProgress']);
    const target: any = {
      collection: (name: string) => ({ exists: async () => existing.has(name) }),
      query: async (query: string) => {
        calls.push(query);
        return { all: async () => [], next: async () => 0 };
      },
      beginTransaction: async () => ({ step: async (run: () => Promise<void>) => run(), commit: async () => {}, abort: async () => {} }),
    };
    await migrateDurableBookGeneration(target);
    expect(calls.some((query) => query.includes("['bookContext', 'bookContexts']"))).toBe(false);
    expect(calls.some((query) => query.includes('IN @@collection'))).toBe(true);
    expect(calls.some((query) => query.includes('document.audioChapter.chapterContext'))).toBe(true);
    expect(calls.some((query) => query.includes('document.audioChapter.readerProgress'))).toBe(true);
    expect(calls.some((query) => query.includes('audioBook: null'))).toBe(true);
    expect(calls.some((query) => query.includes('audioChapter: null'))).toBe(true);
    expect(calls.filter((query) => query.includes('attributable'))).toHaveLength(0);
  });
});
