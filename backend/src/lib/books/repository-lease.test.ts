import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { BookRepositoryError, createBookRepository, type BookAccessContext, type BookDatabase } from './repository';

const scopeKey = newId(); const bookKey = newId(); const chapterKey = newId();
const baseContext = { organizationKey: 'organization', scopeKey, userKey: newId() };

function leaseDatabase(initialToken = 'owner') {
  let token: string | null = initialToken; let chapterRemovals = 0; const mutationFences: boolean[] = []; const patches: unknown[] = [];
  const database: BookDatabase = {
    async query(query, bind = {}) {
      let values: unknown[] = [];
      if (query.includes('RETURN membership._key')) values = ['membership'];
      else if (query.includes('generationLeaseExpiresAt: @leaseExpiresAt')) {
        if (token === bind.leaseToken) values = [1];
      } else if (query.includes('generationLeaseToken: null')) {
        if (token === bind.leaseToken) { token = null; values = [1]; }
      } else if (query.includes('REMOVE chapter IN bookChapters')) chapterRemovals += 1;
      else if (query.includes('UPDATE book WITH @patch') || query.includes('UPDATE chapter WITH @patch')) {
        patches.push(bind.patch);
        mutationFences.push(bind.fenced === true);
        if (!bind.fenced || token === bind.generationLeaseToken) values = query.includes('RETURN 1') ? [1] : [];
      }
      return { all: async () => values };
    },
  };
  const transact = async <T>(_collections: { read?: string[]; write: string[] }, run: (transaction: BookDatabase) => Promise<T>) => run(database);
  return { database, transact, token: () => token, chapterRemovals: () => chapterRemovals, mutationFences, patches };
}

describe('book repository generation leases', () => {
  test('renews and releases only the current owner', async () => {
    const state = leaseDatabase(); const repository = createBookRepository(state.database, state.transact);
    await expect(repository.renewGeneration(baseContext, bookKey, 'stale', '2026-08-19T12:01:00.000Z')).resolves.toBe(false);
    await expect(repository.renewGeneration(baseContext, bookKey, 'owner', '2026-08-19T12:01:00.000Z')).resolves.toBe(true);
    await expect(repository.releaseGeneration(baseContext, bookKey, 'stale')).resolves.toBe(false); expect(state.token()).toBe('owner');
    await expect(repository.releaseGeneration(baseContext, bookKey, 'owner')).resolves.toBe(true); expect(state.token()).toBeNull();
  });

  test('blocks stale chapter replacement before deleting existing chapters', async () => {
    const state = leaseDatabase('new-owner'); const repository = createBookRepository(state.database, state.transact); const stale: BookAccessContext = { ...baseContext, generationLeaseToken: 'owner' };
    await expect(repository.replaceChapters(stale, bookKey, [], [], {})).rejects.toMatchObject({ reason: 'conflict' });
    expect(state.chapterRemovals()).toBe(0);
  });

  test('blocks stale book and chapter updates while preserving tokenless calls', async () => {
    const state = leaseDatabase('new-owner'); const repository = createBookRepository(state.database, state.transact); const stale: BookAccessContext = { ...baseContext, generationLeaseToken: 'owner' };
    await expect(repository.updateBook(stale, bookKey, {})).rejects.toBeInstanceOf(BookRepositoryError);
    await expect(repository.updateChapter(stale, chapterKey, {})).rejects.toMatchObject({ reason: 'conflict' });
    await expect(repository.updateBook(baseContext, bookKey, {})).rejects.toMatchObject({ reason: 'not_found' });
    await expect(repository.updateChapter(baseContext, chapterKey, {})).rejects.toMatchObject({ reason: 'not_found' });
    expect(state.mutationFences).toEqual([true, true, false, false]);
  });

  test('serializes undefined patch fields as null so Arango removes them', async () => {
    const state = leaseDatabase('new-owner'); const repository = createBookRepository(state.database, state.transact); const stale: BookAccessContext = { ...baseContext, generationLeaseToken: 'owner' };
    await expect(repository.updateChapter(stale, chapterKey, { audioStorageKey: undefined })).rejects.toMatchObject({ reason: 'conflict' });
    expect(state.patches).toEqual([{ audioStorageKey: null }]);
  });

  test('blocks cancelled retries until the active lease expires', async () => {
    const expiry = '2026-08-25T12:02:00.000Z'; let retried = false;
    const generationInput = { topic: 'Thinking', goal: 'Decide well', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear', narrationPace: 1 };
    const raw = { _key: bookKey, scopeKey, title: 'Book', description: 'Description', goal: 'Learn', audience: 'Reader', outcome: 'Knowledge', language: 'English', generationInput, generationOwnerKey: baseContext.userKey, generationStage: 'draft', generationCompletedUnits: 1, generationTotalUnits: 34, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, status: 'cancelled', cancelRequestedAt: '2026-08-25T12:00:00.000Z', generationLeaseToken: 'owner', generationLeaseExpiresAt: expiry, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: '2026-08-25T12:00:00.000Z', updatedAt: '2026-08-25T12:00:00.000Z' };
    const database: BookDatabase = { async query(query, bind = {}) { if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] }; if (query.includes('book.status == "cancelled"')) { if (String(bind.now) < expiry) return { all: async () => [] }; retried = true; const { cancelRequestedAt: _cancel, generationLeaseToken: _token, generationLeaseExpiresAt: _expires, ...rest } = raw; return { all: async () => [{ ...rest, status: 'queued', generationAttempt: 1, updatedAt: bind.now }] }; } return { all: async () => [] }; } };
    const repository = createBookRepository(database);
    await expect(repository.retryGeneration(baseContext, bookKey, '2026-08-25T12:01:00.000Z')).rejects.toMatchObject({ reason: 'conflict' }); expect(retried).toBe(false);
    await expect(repository.retryGeneration(baseContext, bookKey, '2026-08-25T12:03:00.000Z')).resolves.toMatchObject({ status: 'queued', generationAttempt: 1 }); expect(retried).toBe(true);
  });

  test('rejects retry when migration could not recover generation input', async () => {
    const database: BookDatabase = { async query(query) { if (query.includes('RETURN membership._key')) return { all: async () => ['membership'] }; return { all: async () => [] }; } };
    await expect(createBookRepository(database).retryGeneration(baseContext, bookKey, '2026-08-25T12:03:00.000Z')).rejects.toMatchObject({ reason: 'conflict', message: expect.stringContaining('resumable input') });
  });
});
