import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { createBookRepository } from './repository';

describe('book extension repository', () => {
  test('atomically fences readiness, title uniqueness, receipt insertion, and activation', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); const extensionKey = newId(); const timestamp = '2026-08-28T12:00:00.000Z'; const queries: Array<{ query: string; bind: Record<string, any> }> = []; let collections: unknown;
    const updatedBook = { _key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Knowledge', language: 'English', generationStage: 'outline', generationCompletedUnits: 0, generationTotalUnits: 5, generationAttempt: 0, estimatedMinutes: 10, chapterCount: 11, status: 'queued', activeExtensionKey: extensionKey, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    const database: any = { query: async (query: string, bind: Record<string, any> = {}) => { queries.push({ query, bind }); return { all: async () => query.includes('userOrganizations') ? [1] : query.includes('FOR item IN bookExtensions') ? [] : query.includes('INSERT @extension INTO bookExtensions') ? [updatedBook] : [] }; } };
    const repository = createBookRepository(database, async (target, operation) => { collections = target; return operation(database); });
    const extension = { key: extensionKey, scopeKey, bookKey, userKey, requestKey: 'request-1', requestFingerprint: 'a'.repeat(64), titles: ['Continuation'], baseChapterCount: 10, targetChapterCount: 11, status: 'pending' as const, createdAt: timestamp, updatedAt: timestamp };
    await expect(repository.acceptExtension({ organizationKey: 'organization', scopeKey, userKey }, extension, timestamp)).resolves.toMatchObject({ replayed: false, extension, book: { key: bookKey, status: 'queued', chapterCount: 11 } });
    expect(collections).toMatchObject({ write: expect.arrayContaining(['books', 'bookExtensions']) });
    const replay = queries.find(({ query }) => query.includes('FOR item IN bookExtensions'))!;
    expect(Object.keys(replay.bind).sort()).toEqual(['bookKey', 'requestKey', 'scopeKey']);
    const acceptance = queries.find(({ query }) => query.includes('INSERT @extension INTO bookExtensions'))!;
    expect(acceptance.query).toContain('book.status == "ready"'); expect(acceptance.query).toContain('chapter.status != "audio-ready"'); expect(acceptance.query).toContain('UNIQUE(APPEND(normalizedExisting, normalizedNew))'); expect(acceptance.query).toContain('activeExtensionKey');
    expect(Object.keys(acceptance.bind).sort()).toEqual(['baseChapterCount', 'bookKey', 'extension', 'extensionKey', 'generationTotalUnits', 'now', 'scopeKey', 'targetChapterCount', 'titles']);
  });

  test('appends one contiguous chapter only while the book lease is owned', async () => {
    const queries: string[] = []; const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const timestamp = '2026-08-28T12:00:00.000Z';
    const database: any = { query: async (query: string) => { queries.push(query); return { all: async () => query.includes('userOrganizations') || query.includes('INSERT @chapter INTO bookChapters') ? [1] : [] }; } };
    const repository = createBookRepository(database, async (_target, operation) => operation(database)); const chapter: any = { key: chapterKey, scopeKey, bookKey, title: 'Next', description: 'Next', objective: 'Continue', evidenceKeyPoints: ['Prior context'], topics: ['Next'], priorTransition: 'Prior', nextTransition: 'Next', repetitionBoundaries: ['No repeats'], targetWordMin: 400, targetWordMax: 450, status: 'planned', position: 11, estimatedMinutes: 0, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp }; const chapterContext: any = { key: newId(), scopeKey, chapterKey, previousContext: 'Prior', objectiveContext: 'Continue', sourceContext: 'Context', personalizationContext: 'Reader', noveltyContext: 'No repeats', nextContext: 'Next', generationBrief: 'Continue', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    await repository.appendChapter({ organizationKey: 'organization', scopeKey, userKey: newId(), generationLeaseToken: 'lease' }, bookKey, chapter, chapterContext);
    const append = queries.find((query) => query.includes('INSERT @chapter INTO bookChapters'))!; expect(append).toContain('book.generationLeaseToken == @generationLeaseToken'); expect(append).toContain('existing.position == @position');
  });
});
