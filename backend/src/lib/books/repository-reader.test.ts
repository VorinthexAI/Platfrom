import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRepository, type BookDatabase } from './repository';

const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1); const now = '2026-08-25T12:00:00.000Z';

describe('book reader persistence', () => {
  test('returns the canonical published Archive transcript for ready chapters', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const documentKey = newId(); const userKey = newId();
    const book = { _key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Knowledge', language: 'English', generationStage: 'complete', generationCompletedUnits: 1, generationTotalUnits: 1, generationAttempt: 0, estimatedMinutes: 2, chapterCount: 1, status: 'ready', embedding, createdAt: now, updatedAt: now };
    const chapter = { _key: chapterKey, scopeKey, bookKey, title: 'Chapter', description: 'Description', objective: 'Objective', evidenceKeyPoints: ['Evidence'], priorTransition: 'Before', nextTransition: 'After', repetitionBoundaries: ['Boundary'], targetWordMin: 500, targetWordMax: 750, archiveDocumentKey: documentKey, status: 'audio-ready', position: 1, estimatedMinutes: 2, embedding, createdAt: now, updatedAt: now };
    const documents = new Map([[documentKey, { _key: documentKey, scopeKey, managedPurpose: 'audio-chapter', content: 'Canonical Archive transcript' }]]); const archiveLookups: string[] = [];
    const database: BookDatabase = { async query(query) {
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      if (!query.includes('DOCUMENT(documents, chapter.archiveDocumentKey)')) throw new Error('Archive transcript lookup was omitted.');
      archiveLookups.push(String(chapter.archiveDocumentKey)); const document = documents.get(String(chapter.archiveDocumentKey));
      const projected = document?.scopeKey === chapter.scopeKey && document.managedPurpose === 'audio-chapter' ? { ...chapter, content: document.content } : chapter;
      return { all: async () => [{ book, chapters: [{ chapter: projected, progress: null }] }] };
    } };
    const detail = await createBookRepository(database).detail({ organizationKey: 'organization', scopeKey, userKey }, bookKey);
    expect(archiveLookups).toEqual([documentKey]);
    expect('content' in chapter).toBe(false);
    expect(detail.chapters[0]?.chapter.content).toBe('Canonical Archive transcript');
  });

  test('never decreases progress or clears completion on later updates', async () => {
    const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId(); const userKey = newId(); let current: Record<string, unknown> | undefined;
    const database: BookDatabase = { async query(query, bind = {}) {
      if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] };
      const incoming = bind.progress as Record<string, unknown>;
      current = current ? { ...current, progressSeconds: Math.max(Number(current.progressSeconds), Number(incoming.progressSeconds)), isCompleted: Boolean(current.isCompleted) || Boolean(incoming.isCompleted), completedAt: current.isCompleted ? current.completedAt : incoming.isCompleted ? incoming.completedAt : current.completedAt, updatedAt: incoming.updatedAt } : incoming;
      return { all: async () => [current] };
    } };
    const repository = createBookRepository(database); const context = { organizationKey: 'organization', scopeKey, userKey };
    const first = { key: newId(), scopeKey, userKey, bookKey, chapterKey, progressSeconds: 120, isCompleted: true, completedAt: now, createdAt: now, updatedAt: now };
    await repository.upsertProgress(context, bookKey, chapterKey, first);
    const replay = await repository.upsertProgress(context, bookKey, chapterKey, { ...first, key: newId(), progressSeconds: 10, isCompleted: false, completedAt: null, updatedAt: '2026-08-25T12:01:00.000Z' });
    expect(replay).toMatchObject({ progressSeconds: 120, isCompleted: true, completedAt: now, createdAt: now });
  });
});
