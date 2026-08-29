import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { bookCreateInputSchema, createBookService } from './service';
import { BookRepositoryError } from './repository';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const now = '2026-08-12T12:00:00.000Z';
const input = { organizationKey, scopeKey, generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'I know the basics', writingTone: 'Clear and practical', language: 'English', narratorVoiceKey: 'clear' as const, narrationPace: 1, archiveDocumentKeys: [], chapterImages: false };
const requestInput = bookCreateInputSchema.parse(input);
const parsedInput = { organizationKey: requestInput.organizationKey, scopeKey: requestInput.scopeKey, generationRequestKey: requestInput.generationRequestKey, topic: requestInput.topic, goal: requestInput.goal, currentKnowledge: requestInput.currentKnowledge, writingTone: requestInput.writingTone, chapterCount: 10 as const, language: requestInput.language, archiveDocumentKeys: requestInput.archiveDocumentKeys, narratorVoiceKey: requestInput.narratorVoiceKey, narrationPace: requestInput.narrationPace, chapterImages: requestInput.chapterImages };
const fingerprint = createHash('sha256').update(JSON.stringify((({ organizationKey: _o, scopeKey: _s, generationRequestKey: _r, ...value }) => value)(parsedInput))).digest('hex');
const row = (status: 'queued' | 'failed' | 'cancelled' | 'ready' = 'queued') => ({ book: { key: bookKey, scopeKey, title: input.topic, description: input.goal, goal: input.goal, audience: input.currentKnowledge, outcome: input.goal, language: input.language, narratorVoiceKey: input.narratorVoiceKey, narrationPace: 1, generationRequestKey: input.generationRequestKey, generationBriefFingerprint: fingerprint, generationInput: (({ organizationKey: _o, scopeKey: _s, generationRequestKey: _r, ...value }) => value)(parsedInput), generationOwnerKey: userKey, generationStage: 'accepted' as const, generationCompletedUnits: 0, generationTotalUnits: 34, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, isFavorite: false, status, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now }, chapters: [] });

describe('book service asynchronous lifecycle', () => {
  test('authorizes and generates ten creative topic suggestions through the AI action boundary', async () => {
    const calls: unknown[][] = [];
    const topics = Array.from({ length: 10 }, (_, index) => `Unexpected learning topic ${index + 1}`);
    const service = createBookService({
      repository: { authorize: async (...args: unknown[]) => { calls.push(['authorize', ...args]); } } as never,
      suggestTopics: async (...args) => { calls.push(['suggest', ...args]); return JSON.stringify({ topics }); },
    });
    await expect(service.suggestTopics({ organizationKey, scopeKey, excludeTopics: ['Old idea'] }, userKey)).resolves.toEqual({ topics });
    expect(calls[0]).toEqual(['authorize', { organizationKey, scopeKey, userKey }, false]);
    expect(calls[1]?.[1]).toMatchObject({ options: { temperature: 1, maxTokens: 2_000 }, responseFormat: { name: 'book_topic_suggestions', schema: { additionalProperties: false, required: ['topics'], properties: { topics: { minItems: 10, maxItems: 10 } } } } });
    expect(JSON.stringify(calls[1]?.[1])).toContain('Old idea');
    expect(calls[1]?.[2]).toBe(organizationKey);
  });

  test('strictly rejects invalid topic requests and malformed model output', async () => {
    let generated = 0;
    const service = createBookService({ repository: { authorize: async () => {} } as never, suggestTopics: async () => { generated += 1; return JSON.stringify({ topics: Array(10).fill('Duplicate topic') }); } });
    await expect(service.suggestTopics({ organizationKey, scopeKey, unknown: true }, userKey)).rejects.toBeDefined();
    expect(generated).toBe(0);
    await expect(service.suggestTopics({ organizationKey, scopeKey }, userKey)).rejects.toThrow('Topics must be unique');
  });

  test('generates ten unique goals for the selected topic and excludes the previous batch', async () => {
    const goals = Array.from({ length: 10 }, (_, index) => `Concrete reader outcome ${index + 1}`);
    let prompt: unknown;
    const service = createBookService({ repository: { authorize: async () => {} } as never, suggestTopics: async (input) => { prompt = input; return JSON.stringify({ goals }); } });
    await expect(service.suggestGoals({ organizationKey, scopeKey, topic: 'Decision making', excludeGoals: ['Old goal'] }, userKey)).resolves.toEqual({ goals });
    expect(JSON.stringify(prompt)).toContain('Decision making');
    expect(JSON.stringify(prompt)).toContain('Old goal');
    expect(prompt).toMatchObject({ options: { maxTokens: 2_000 }, responseFormat: { name: 'book_goal_suggestions', schema: { required: ['goals'], properties: { goals: { minItems: 10, maxItems: 10 } } } } });
  });

  test('accepts and enqueues without running generation', async () => {
    let current: any; let generationInput: unknown; const jobs: unknown[] = [];
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => null, detail: async () => current };
    const generator: any = { create: async (nextInput: unknown) => { generationInput = nextInput; current = row(); return bookKey; }, write: async () => { throw new Error('must be background'); } };
    const result = await createBookService({ repository, generator, enqueue: async (job) => { jobs.push(job); return { jobId: bookKey }; }, signUrl: async () => 'signed', publishChanged: async () => {} }).create(input, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued', isFavorite: false, generationProgressPercent: 0 });
    expect(generationInput).toMatchObject({ chapterCount: 10 });
    expect(jobs).toEqual([{ schemaVersion: 1, bookKey, organizationKey, scopeKey, userKey }]);
  });

  test('owns the ten-chapter count and strictly rejects overrides and unknown fields', async () => {
    const service = createBookService({ repository: {} as never });
    expect(bookCreateInputSchema.parse(input)).not.toHaveProperty('chapterCount');
    await expect(service.create({ ...input, chapterCount: 10 }, userKey)).rejects.toBeDefined();
    await expect(service.create({ ...input, chapterCount: 25 }, userKey)).rejects.toBeDefined();
    await expect(service.create({ ...input, unknown: true }, userKey)).rejects.toBeDefined();
  });

  test('previews one exact continuation batch and durably accepts generation', async () => {
    const current: any = row('ready'); current.chapters = Array.from({ length: 10 }, (_, index) => ({ chapter: { key: newId(), position: index + 1, title: `Chapter ${index + 1}`, description: `Summary ${index + 1}`, status: 'audio-ready', content: 'Content', audioStorageKey: `audio-${index}.mp3`, audioDurationSeconds: 60 }, progress: null }));
    const jobs: unknown[] = []; const receipts: unknown[] = []; let suggestions = 0;
    const repository: any = { detail: async () => current, acceptExtension: async (_context: unknown, extension: any) => { receipts.push(extension); current.book = { ...current.book, status: 'queued', chapterCount: extension.targetChapterCount }; return { extension, book: current.book, replayed: false }; } };
    const service = createBookService({ repository, suggestTopics: async (request) => { suggestions += 1; const text = JSON.stringify(request); expect(text).toContain(current.book.description); expect(text).toContain('Summary 10'); return JSON.stringify({ titles: ['The Next Decision'] }); }, enqueue: async (job) => { jobs.push(job); return { jobId: bookKey }; }, signUrl: async () => 'signed', publishChanged: async () => {}, now: () => now });
    await expect(service.extend(bookKey, { organizationKey, scopeKey, mode: 'preview', chapterCount: 1 }, userKey)).resolves.toEqual({ titles: ['The Next Decision'] }); expect(suggestions).toBe(1);
    await expect(service.extend(bookKey, { organizationKey, scopeKey, mode: 'generate', chapterCount: 1, titles: ['The Next Decision'], requestKey: 'extension-1' }, userKey)).resolves.toMatchObject({ key: bookKey, status: 'queued', chapterCount: 11 });
    expect(receipts).toHaveLength(1); expect(receipts[0]).toMatchObject({ bookKey, requestKey: 'extension-1', baseChapterCount: 10, targetChapterCount: 11, status: 'pending' }); expect(jobs).toHaveLength(1);
  });

  test('keeps accepted work queued for recovery when Redis insertion fails', async () => {
    let current: any;
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => null, detail: async () => current };
    const generator: any = { create: async () => { current = row(); return bookKey; } };
    const service = createBookService({ repository, generator, enqueue: async () => { throw new Error('queue unavailable'); }, publishChanged: async () => {} });
    await expect(service.create(input, userKey)).resolves.toMatchObject({ key: bookKey, status: 'queued' });
  });

  test('repairs a missing stable job when create is replayed', async () => {
    const jobs: unknown[] = []; const current: any = row();
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => current };
    const result = await createBookService({ repository, enqueue: async (job) => { jobs.push(job); return { jobId: bookKey }; }, signUrl: async () => 'signed' }).create(input, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued' });
    expect(jobs).toEqual([{ schemaVersion: 1, bookKey, organizationKey, scopeKey, userKey }]);
  });

  test('repairs a queued retry replay after the database-to-queue crash window', async () => {
    const jobs: unknown[] = []; const current: any = row();
    const repository: any = { retryGeneration: async () => { throw new BookRepositoryError('conflict'); }, detail: async () => current };
    const result = await createBookService({ repository, enqueue: async (job) => { jobs.push(job); return { jobId: bookKey }; }, signUrl: async () => 'signed', publishChanged: async () => {} }).retry(bookKey, { organizationKey, scopeKey }, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued' });
    expect(jobs).toHaveLength(1);
  });

  test('keeps a retried book queued when Redis is temporarily unavailable', async () => {
    const current: any = row();
    const repository: any = { retryGeneration: async () => current.book, detail: async () => current };
    const service = createBookService({ repository, enqueue: async () => { throw new Error('redis unavailable'); }, signUrl: async () => 'signed', publishChanged: async () => {} });

    await expect(service.retry(bookKey, { organizationKey, scopeKey }, userKey)).resolves.toMatchObject({ key: bookKey, status: 'queued' });
  });

  test('persists terminal worker failures through the repository guard', async () => {
    const calls: unknown[][] = [];
    const repository: any = { failTerminalGeneration: async (...args: unknown[]) => { calls.push(args); return true; } };
    const service = createBookService({ repository, now: () => now });
    await expect(service.terminalFailure({ schemaVersion: 1, bookKey, organizationKey, scopeKey, userKey })).resolves.toBe(true);
    expect(calls).toEqual([[{ schemaVersion: 1, bookKey, organizationKey, scopeKey, userKey }, 'Audio book generation failed after all retry attempts. Retry the audio book to continue.', now]]);
  });

  test('retries, cancels, and hard deletes through repository and queue', async () => {
    let current: any = row('failed'); const calls: string[] = [];
    const repository: any = { retryGeneration: async () => { calls.push('retry'); current = row(); return current.book; }, cancelGeneration: async () => { calls.push('cancel'); current = row('cancelled'); }, deleteBook: async () => { calls.push('delete'); return { deleted: true, bookKey, shareTokenHash: 'a'.repeat(64) }; }, detail: async () => current };
    const service = createBookService({ repository, enqueue: async () => { calls.push('enqueue'); return { jobId: bookKey }; }, removeJob: async () => { calls.push('remove'); }, signUrl: async () => 'signed', publishChanged: async () => {}, publishShareChanged: async () => {} });
    await service.retry(bookKey, { organizationKey, scopeKey }, userKey); await service.cancel(bookKey, { organizationKey, scopeKey }, userKey); expect(await service.delete(bookKey, { organizationKey, scopeKey }, userKey)).toEqual({ key: bookKey });
    expect(calls).toEqual(['retry', 'enqueue', 'cancel', 'remove', 'delete', 'remove']);
  });

  test('strictly sets favorite state through the repository and publishes the updated summary', async () => {
    const current: any = row('ready'); const calls: unknown[][] = [];
    const repository: any = { setFavorite: async (...args: unknown[]) => { calls.push(args); current.book.isFavorite = (args[2] as boolean); }, detail: async () => current };
    const service = createBookService({ repository, signUrl: async () => 'signed', now: () => now, publishChanged: async (key) => { calls.push(['publish', key]); } });
    await expect(service.setFavorite(bookKey, { organizationKey, scopeKey, isFavorite: true }, userKey)).resolves.toMatchObject({ key: bookKey, isFavorite: true });
    expect(calls).toEqual([[{ organizationKey, scopeKey, userKey }, bookKey, true, now], ['publish', scopeKey]]);
    await expect(service.setFavorite(bookKey, { organizationKey, scopeKey, isFavorite: false, forged: true }, userKey)).rejects.toThrow('Unrecognized key');
  });

  test('does not touch BullMQ when authorized hard deletion fails', async () => {
    const calls: string[] = []; const repository: any = { deleteBook: async () => { calls.push('delete'); throw new Error('forbidden'); } };
    const service = createBookService({ repository, removeJob: async () => { calls.push('remove'); }, publishChanged: async () => {} });
    await expect(service.delete(bookKey, { organizationKey, scopeKey }, userKey)).rejects.toThrow('forbidden');
    expect(calls).toEqual(['delete']);
  });

  test('keeps successful hard deletion successful when queue cleanup fails', async () => {
    const calls: string[] = []; const repository: any = { deleteBook: async () => { calls.push('delete'); return { deleted: true, bookKey, shareTokenHash: 'a'.repeat(64) }; } };
    const service = createBookService({ repository, removeJob: async () => { calls.push('remove'); throw new Error('redis unavailable'); }, publishChanged: async () => { calls.push('publish'); }, publishShareChanged: async () => {} });
    await expect(service.delete(bookKey, { organizationKey, scopeKey }, userKey)).resolves.toEqual({ key: bookKey }); expect(calls).toEqual(['delete', 'remove', 'publish']);
  });

  test('computes listening progress from audio duration rather than chapter count', async () => {
    const first = newId(); const second = newId(); const current: any = row('ready'); current.chapters = [
      { chapter: { key: first, title: 'One', description: 'One', position: 1, estimatedMinutes: 1, audioDurationSeconds: 100 }, progress: { progressSeconds: 100, isCompleted: true } },
      { chapter: { key: second, title: 'Two', description: 'Two', position: 2, estimatedMinutes: 5, audioDurationSeconds: 500 }, progress: { progressSeconds: 200, isCompleted: false } },
    ];
    const service = createBookService({ repository: { detail: async () => current } as never, signUrl: async () => 'signed' });
    expect((await service.detail(bookKey, { organizationKey, scopeKey }, userKey)).book).toMatchObject({ progressPercent: 50, currentChapterKey: second });
  });

  test('does not presign chapter media for overview summaries', async () => {
    const current: any = row('ready'); current.book.coverStorageKey = 'cover'; current.chapters = [{ chapter: { key: newId(), title: 'One', description: 'One', position: 1, estimatedMinutes: 2, audioStorageKey: 'audio', imageStorageKey: 'image', audioDurationSeconds: 120 }, progress: null }];
    const signed: string[] = []; const repository: any = { list: async () => [current], detail: async () => current };
    const service = createBookService({ repository, signUrl: async (key) => { signed.push(key); return `signed:${key}`; } });
    await service.overview({ organizationKey, scopeKey }, userKey);
    expect(signed).toEqual(['cover']);
    signed.length = 0;
    await service.detail(bookKey, { organizationKey, scopeKey }, userKey);
    expect(signed).toEqual(['cover', 'audio', 'image']);
  });
});
