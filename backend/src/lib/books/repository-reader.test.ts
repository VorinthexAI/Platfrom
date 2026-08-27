import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRepository, type BookDatabase } from './repository';

const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1); const now = '2026-08-25T12:00:00.000Z';

describe('book reader persistence', () => {
  test('reads books, chapters, and progress only from canonical Ascend collections', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const userKey = newId(); const progressKey = newId();
    const book = { _key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Knowledge', language: 'English', generationStage: 'complete', generationCompletedUnits: 1, generationTotalUnits: 1, generationAttempt: 0, estimatedMinutes: 2, chapterCount: 1, status: 'ready', embedding, isFavorite: false, archiveFolderKey: bookKey, createdAt: now, updatedAt: now };
    const chapter = { _key: chapterKey, scopeKey, bookKey, title: 'Chapter', description: 'Description', objective: 'Objective', evidenceKeyPoints: ['Evidence'], priorTransition: 'Before', nextTransition: 'After', repetitionBoundaries: ['Boundary'], targetWordMin: 500, targetWordMax: 750, archiveDocumentKey: chapterKey, content: 'Canonical Archive transcript', status: 'audio-ready', position: 1, estimatedMinutes: 2, embedding, createdAt: now, updatedAt: now };
    let detailBind: Record<string, unknown> = {}; let detailQuery = '';
    const database: BookDatabase = { async query(query, bind = {}) {
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      detailBind = bind; detailQuery = query;
      return { all: async () => [{ book, chapters: [{ chapter, progress: { _key: progressKey, scopeKey, userKey, bookKey, chapterKey, progressSeconds: 12, isCompleted: false, completedAt: null, createdAt: now, updatedAt: now } }] }] };
    } };
    const detail = await createBookRepository(database).detail({ organizationKey: 'organization', scopeKey, userKey }, bookKey);
    expect(detailQuery).toContain('FOR book IN books'); expect(detailQuery).toContain('FOR chapter IN bookChapters'); expect(detailQuery).toContain('FOR item IN bookProgress'); expect(detailQuery).not.toContain('documents'); expect(detailQuery).not.toContain('folders');
    expect(detailBind).toEqual({ scopeKey, userKey, bookKey });
    expect(detail.chapters[0]?.chapter.content).toBe('Canonical Archive transcript');
    expect(detail.chapters[0]?.progress?.key).toBe(progressKey);
  });

  test('never decreases progress or clears completion on later updates', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const userKey = newId(); let current: Record<string, unknown> | undefined; let progressQuery = ''; const progressBindKeys: string[][] = [];
    const database: BookDatabase = { async query(query, bind = {}) {
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      progressQuery = query;
      progressBindKeys.push(Object.keys(bind).sort());
      const incoming = bind.progress as Record<string, unknown>;
      current = current ? { ...current, progressSeconds: Math.max(Number(current.progressSeconds), Number(incoming.progressSeconds)), isCompleted: Boolean(current.isCompleted) || Boolean(incoming.isCompleted), completedAt: current.isCompleted ? current.completedAt : incoming.isCompleted ? incoming.completedAt : current.completedAt, updatedAt: incoming.updatedAt } : incoming;
      return { all: async () => [current] };
    } };
    const repository = createBookRepository(database); const context = { organizationKey: 'organization', scopeKey, userKey };
    const first = { key: newId(), scopeKey, userKey, bookKey, chapterKey, progressSeconds: 120, isCompleted: true, completedAt: now, createdAt: now, updatedAt: now };
    await repository.upsertProgress(context, bookKey, chapterKey, first);
    const replay = await repository.upsertProgress(context, bookKey, chapterKey, { ...first, key: newId(), progressSeconds: 10, isCompleted: false, completedAt: null, updatedAt: '2026-08-25T12:01:00.000Z' });
    expect(replay).toMatchObject({ progressSeconds: 120, isCompleted: true, completedAt: now, createdAt: now });
    expect(progressQuery).toContain('IN bookProgress');
    expect(progressQuery).toContain('MAX([OLD.progressSeconds');
    expect(progressQuery).toContain('DOCUMENT(bookChapters');
    expect(progressBindKeys).toEqual([['bookKey', 'chapterKey', 'progress', 'scopeKey', 'userKey'], ['bookKey', 'chapterKey', 'progress', 'scopeKey', 'userKey']]);
  });
});
