import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRuntime } from './runtime';
import { BookRepositoryError, type BookAccessContext } from './repository';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const chapterKey = newId(); const timestamp = '2026-08-19T12:00:00.000Z';
const context: BookAccessContext & { generationLeaseToken: string } = { organizationKey, scopeKey, userKey, generationLeaseToken: 'owner' };
const input = { organizationKey, scopeKey, topic: 'Thinking', goal: 'Decide well', audience: 'Leaders', tone: 'Clear', length: 'short' as const, language: 'English' };
  const book = { key: bookKey, scopeKey, title: 'Clear Thinking', description: 'A guide', goal: input.goal, audience: input.audience, outcome: 'Better decisions', language: input.language, estimatedMinutes: 0, chapterCount: 0, isFavorite: false, status: 'planning' as const, embedding: Array(4096).fill(0), createdAt: timestamp, updatedAt: timestamp };
const plannedChapter = { key: chapterKey, scopeKey, bookKey, title: 'Signals', description: 'Notice signals', objective: 'Observe', topics: ['attention'], status: 'planned' as const, position: 1, estimatedMinutes: 0, embedding: Array(4096).fill(0), createdAt: timestamp, updatedAt: timestamp };

function leaseRepository(chapters: any[]) {
  let activeToken = 'owner'; const successfulBookStatuses: string[] = []; const attempts: string[] = [];
  const own = (access: BookAccessContext, mutation: string) => { attempts.push(mutation); if (access.generationLeaseToken !== activeToken) throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); };
  const repository: any = {
    authorize: async () => {}, detail: async () => ({ book, chapters: chapters.map((chapter) => ({ chapter, progress: null })) }),
    updateBook: async (access: BookAccessContext, _key: string, patch: { status?: string }) => { own(access, `book:${patch.status}`); if (patch.status) successfulBookStatuses.push(patch.status); return { ...book, ...patch }; },
    replaceChapters: async (access: BookAccessContext) => { own(access, 'replace'); },
    updateChapter: async (access: BookAccessContext, _key: string, patch: { status?: string }) => { own(access, `chapter:${patch.status}`); return { ...plannedChapter, ...patch }; },
  };
  return { repository, attempts, successfulBookStatuses, takeOver: () => { activeToken = 'new-owner'; } };
}

const dependencies = { embed: async () => Array(4096).fill(0), speak: async () => ({ bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }), storage: { upload: async ({ key }: { key: string }) => ({ storageKey: key }), download: async () => new Uint8Array(), delete: async () => {} } as any, id: newId, now: () => timestamp };

describe('book runtime generation lease fencing', () => {
  test('requires a generation lease token before runtime writes', async () => {
    const lease = leaseRepository([plannedChapter]);
    const runtime = createBookRuntime({ ...dependencies, repository: lease.repository, ask: async () => 'unused', cover: async () => null });
    await expect(runtime.write(bookKey, input, { organizationKey, scopeKey, userKey } as any)).rejects.toThrow('Book generation lease token is required.');
    expect(lease.attempts).toEqual([]);
  });

  test('a takeover blocks chapter replacement and the stale catch cannot mark failed', async () => {
    const lease = leaseRepository([]);
    const runtime = createBookRuntime({ ...dependencies, repository: lease.repository, ask: async () => { lease.takeOver(); return JSON.stringify({ chapters: [{ title: 'Signals', description: 'Notice signals', objective: 'Observe', topics: ['attention'] }] }); }, cover: async () => null });
    await expect(runtime.write(bookKey, input, context)).rejects.toMatchObject({ reason: 'conflict' });
    expect(lease.attempts).toEqual(['book:generating', 'replace', 'book:failed']); expect(lease.successfulBookStatuses).toEqual(['generating']);
  });

  test('a takeover blocks chapter updates and the stale catch cannot mark failed', async () => {
    const lease = leaseRepository([plannedChapter]);
    lease.repository.updateChapter = async (access: BookAccessContext, _key: string, patch: { status?: string }) => { lease.takeOver(); lease.attempts.push(`chapter:${patch.status}`); if (access.generationLeaseToken !== 'new-owner') throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); };
    const runtime = createBookRuntime({ ...dependencies, repository: lease.repository, ask: async () => 'unused', cover: async () => null });
    await expect(runtime.write(bookKey, input, context)).rejects.toMatchObject({ reason: 'conflict' });
    expect(lease.attempts).toEqual(['book:generating', 'chapter:writing', 'book:failed']); expect(lease.successfulBookStatuses).toEqual(['generating']);
  });

  test('a takeover blocks ready and failed book updates', async () => {
    const completeChapter = { ...plannedChapter, content: 'Finished prose.', audioStorageKey: 'chapter.mp3', status: 'audio-ready' as const };
    const lease = leaseRepository([completeChapter]);
    const runtime = createBookRuntime({ ...dependencies, repository: lease.repository, ask: async () => 'unused', cover: async () => { lease.takeOver(); return null; } });
    await expect(runtime.write(bookKey, input, context)).rejects.toMatchObject({ reason: 'conflict' });
    expect(lease.attempts).toEqual(['book:generating', 'book:ready', 'book:failed']); expect(lease.successfulBookStatuses).toEqual(['generating']);
  });

  test('uses an attempt-specific audio key and deletes it when its fenced chapter update fails', async () => {
    const lease = leaseRepository([plannedChapter]); const uploaded: string[] = []; const deleted: string[] = [];
    let chapterUpdates = 0;
    lease.repository.updateChapter = async (access: BookAccessContext, _key: string, patch: { status?: string }) => {
      chapterUpdates += 1; lease.attempts.push(`chapter:${patch.status}`);
      if (chapterUpdates === 2) lease.takeOver();
      if (access.generationLeaseToken !== (chapterUpdates === 2 ? 'new-owner' : 'owner')) throw new BookRepositoryError('conflict', 'Book generation lease was lost.');
      return { ...plannedChapter, ...patch };
    };
    const storage = { ...dependencies.storage, upload: async ({ key }: { key: string }) => { uploaded.push(key); return { storageKey: key }; }, delete: async (key: string) => { deleted.push(key); } } as any;
    const runtime = createBookRuntime({ ...dependencies, storage, repository: lease.repository, ask: async () => 'Finished prose.', cover: async () => null });
    await expect(runtime.write(bookKey, input, context)).rejects.toMatchObject({ reason: 'conflict' });
    expect(uploaded).toEqual([`books/${scopeKey}/${bookKey}/attempts/owner/chapters/${chapterKey}.mp3`]);
    expect(deleted).toEqual(uploaded);
  });

  test('keeps committed audio but deletes an uncommitted cover after stale finalization', async () => {
    const lease = leaseRepository([plannedChapter]); const uploaded: string[] = []; const deleted: string[] = [];
    const updateBook = lease.repository.updateBook;
    lease.repository.updateBook = async (access: BookAccessContext, key: string, patch: { status?: string }) => {
      if (patch.status === 'ready') lease.takeOver();
      return updateBook(access, key, patch);
    };
    const storage = { ...dependencies.storage, upload: async ({ key }: { key: string }) => { uploaded.push(key); return { storageKey: key }; }, delete: async (key: string) => { deleted.push(key); } } as any;
    const runtime = createBookRuntime({ ...dependencies, storage, repository: lease.repository, ask: async () => 'Finished prose.', cover: async () => ({ bytes: new Uint8Array([2]), mimeType: 'image/png' }) });
    await expect(runtime.write(bookKey, input, context)).rejects.toMatchObject({ reason: 'conflict' });
    const audioKey = `books/${scopeKey}/${bookKey}/attempts/owner/chapters/${chapterKey}.mp3`;
    const coverKey = `books/${scopeKey}/${bookKey}/attempts/owner/cover.png`;
    expect(uploaded).toEqual([audioKey, coverKey]);
    expect(deleted).toEqual([coverKey]);
  });
});
