import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookRuntime } from './runtime';
import { BookRepositoryError } from './repository';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId();
const input = { organizationKey, scopeKey, topic: 'Thinking', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 1, chapterImages: false };

describe('book runtime generation lease fencing', () => {
  test('requires a generation lease token before runtime writes', async () => {
    const runtime = createBookRuntime({ repository: {} as never });
    await expect(runtime.write(bookKey, input, { organizationKey, scopeKey, userKey } as never)).rejects.toThrow('lease token');
  });

  test('stops before model or storage effects when cancellation is durable', async () => {
    let asked = false; let uploaded = false;
    const repository: any = { isCancellationRequested: async () => true, updateBook: async () => { throw new Error('unexpected write'); } };
    const runtime = createBookRuntime({ repository, ask: async () => { asked = true; return ''; }, storage: { upload: async () => { uploaded = true; return { storageKey: 'x' }; }, delete: async () => {}, copy: async () => ({ storageKey: 'x' }), download: async () => ({ bytes: new Uint8Array(), mimeType: 'text/plain' }) } });
    await expect(runtime.write(bookKey, input, { organizationKey, scopeKey, userKey, generationLeaseToken: 'owner' })).rejects.toThrow('cancelled');
    expect(asked).toBe(false); expect(uploaded).toBe(false);
  });

  test('preserves repository fencing errors from the first stage write', async () => {
    const repository: any = { isCancellationRequested: async () => false, detail: async () => ({ book: {}, chapters: [] }), sources: async () => [], updateBook: async () => { throw new BookRepositoryError('conflict', 'Book generation lease was lost.'); } };
    const runtime = createBookRuntime({ repository });
    await expect(runtime.write(bookKey, input, { organizationKey, scopeKey, userKey, generationLeaseToken: 'stale' })).rejects.toMatchObject({ reason: 'conflict' });
  });

  test('stops an active worker when its book is hard-deleted during provider work', async () => {
    let checks = 0; let persistedSources = false; let uploaded = false;
    const repository: any = { detail: async () => ({ book: {}, chapters: [] }), sources: async () => [], updateBook: async () => ({}), isCancellationRequested: async () => { checks += 1; if (checks > 1) throw new BookRepositoryError('not_found'); return false; }, addSources: async () => { persistedSources = true; }, enqueueUnreferencedStorage: async () => {} };
    const runtime = createBookRuntime({ repository, research: async () => ({ text: 'Evidence', citations: [{ title: 'Source', url: 'https://example.com' }], sources: ['https://example.com'] }), storage: { upload: async () => { uploaded = true; return { storageKey: 'x' }; }, delete: async () => {}, copy: async () => ({ storageKey: 'x' }), download: async () => ({ bytes: new Uint8Array(), mimeType: 'text/plain' }) }, publishChanged: async () => {} });
    await expect(runtime.write(bookKey, input, { organizationKey, scopeKey, userKey, generationLeaseToken: 'owner' })).rejects.toMatchObject({ reason: 'not_found' });
    expect(persistedSources).toBe(false); expect(uploaded).toBe(false);
  });
});
