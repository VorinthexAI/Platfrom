import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookService } from './service';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const chapterKey = newId(); const now = '2026-08-12T12:00:00.000Z';
const book = { key: bookKey, scopeKey, title: 'Clear Thinking', description: 'A guide', goal: 'Decide well', audience: 'Leaders', outcome: 'Better decisions', language: 'en', estimatedMinutes: 10, chapterCount: 1, isFavorite: false, status: 'ready' as const, embedding: Array(4096).fill(0), deletedAt: null, createdAt: now, updatedAt: now };
const chapter = { key: chapterKey, scopeKey, bookKey, title: 'Signals', description: 'Notice signals', objective: 'Observe', topics: ['attention'], content: 'Chapter prose', status: 'written' as const, position: 1, estimatedMinutes: 10, embedding: Array(4096).fill(0), createdAt: now, updatedAt: now };

describe('book service', () => {
  test('returns safe user-specific detail and persists progress with userKey', async () => {
    let progress: any = null;
    const repository: any = { authorize: async () => {}, list: async () => [{ book, chapters: [{ chapter, progress }] }], detail: async () => ({ book, chapters: [{ chapter, progress }] }), findByGenerationRequest: async () => null, upsertProgress: async (_context: unknown, _book: string, _chapter: string, value: unknown) => { progress = value; return value; } };
    const service = createBookService({ repository, signUrl: async () => 'https://example.com/signed', id: () => newId(), now: () => now });
    const result = await service.progress(bookKey, chapterKey, { organizationKey, scopeKey, progressSeconds: 30, isCompleted: true }, userKey);
    expect(progress).toMatchObject({ userKey, bookKey, chapterKey, progressSeconds: 30, isCompleted: true });
    expect(result.book).not.toHaveProperty('embedding'); expect(result.chapter).not.toHaveProperty('audioStorageKey');
    expect(result.book).toMatchObject({ progressPercent: 100 }); expect(result.book).not.toHaveProperty('currentChapterKey');
  });

  test('rejects unknown create fields before generation', async () => {
    const service = createBookService({ repository: {} as never, generator: {} as never });
    await expect(service.create({ organizationKey, scopeKey, generationRequestKey: 'request-1', topic: 'Thinking', goal: 'Improve', audience: 'Leaders', tone: 'clear', length: 'short', language: 'en', unknown: true }, userKey)).rejects.toBeDefined();
  });

  test('clears a stale completion timestamp when listening resumes', async () => {
    let progress: any;
    const existing = { key: newId(), scopeKey, userKey, bookKey, chapterKey, progressSeconds: 600, isCompleted: true, completedAt: now, createdAt: now, updatedAt: now };
    const repository: any = { detail: async () => ({ book, chapters: [{ chapter, progress: progress ?? existing }] }), upsertProgress: async (_context: unknown, _book: string, _chapter: string, value: unknown) => { progress = value; return value; } };
    const service = createBookService({ repository, signUrl: async () => 'https://example.com/signed', id: () => newId(), now: () => now });
    await service.progress(bookKey, chapterKey, { organizationKey, scopeKey, progressSeconds: 10, isCompleted: false }, userKey);
    expect(progress).toMatchObject({ progressSeconds: 10, isCompleted: false, completedAt: null });
  });
});
