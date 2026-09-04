import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { z } from 'zod';
import { bookCreateInputSchema, createBookService, isTerminalBookGenerationFailure } from './service';
import { BookRepositoryError } from './repository';
import { ProviderExecutionError } from '@/lib/ai/router';
import { BookGenerationTerminalError } from './generation-errors';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const now = '2026-08-12T12:00:00.000Z';
const input = { organizationKey, scopeKey, generationRequestKey: 'request-1', topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'I know the basics', writingTone: 'Clear and practical', language: 'English', narratorVoiceKey: 'clear' as const, narrationPace: 1, archiveDocumentKeys: [] };
const requestInput = bookCreateInputSchema.parse(input);
const parsedInput = { organizationKey: requestInput.organizationKey, scopeKey: requestInput.scopeKey, generationRequestKey: requestInput.generationRequestKey, topic: requestInput.topic, goal: requestInput.goal, currentKnowledge: requestInput.currentKnowledge, writingTone: requestInput.writingTone, chapterCount: 10 as const, language: requestInput.language, archiveDocumentKeys: requestInput.archiveDocumentKeys, narratorVoiceKey: requestInput.narratorVoiceKey, narrationPace: requestInput.narrationPace };
const fingerprint = createHash('sha256').update(JSON.stringify((({ organizationKey: _o, scopeKey: _s, generationRequestKey: _r, ...value }) => value)(parsedInput))).digest('hex');
const row = (status: 'queued' | 'failed' | 'cancelled' | 'ready' = 'queued') => ({ book: { key: bookKey, scopeKey, title: input.topic, description: input.goal, goal: input.goal, audience: input.currentKnowledge, outcome: input.goal, language: input.language, narratorVoiceKey: input.narratorVoiceKey, narrationPace: 1, generationRequestKey: input.generationRequestKey, generationBriefFingerprint: fingerprint, generationInput: (({ organizationKey: _o, scopeKey: _s, generationRequestKey: _r, ...value }) => value)(parsedInput), generationOwnerKey: userKey, generationStage: 'accepted' as const, generationCompletedUnits: 0, generationTotalUnits: 34, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, isFavorite: false, status, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: now, updatedAt: now }, chapters: [] });

describe('book service asynchronous lifecycle', () => {
  test('terminalizes only deterministic failures, never cancellation or infrastructure uncertainty', () => {
    expect(isTerminalBookGenerationFailure(new BookGenerationTerminalError('invalid output'))).toBe(true);
    expect(isTerminalBookGenerationFailure(new z.ZodError([]))).toBe(false);
    expect(isTerminalBookGenerationFailure(new ProviderExecutionError('text', [{ modelId: 'm', providerId: 'p', externalModelId: 'e', code: 'invalid_input', message: 'invalid' }]))).toBe(true);
    expect(isTerminalBookGenerationFailure(new ProviderExecutionError('text', [{ modelId: 'm', providerId: 'p', externalModelId: 'e', code: 'unknown', message: 'unknown' }]))).toBe(false);
    expect(isTerminalBookGenerationFailure(new DOMException('cancelled', 'AbortError'))).toBe(false);
    expect(isTerminalBookGenerationFailure(new BookRepositoryError('conflict', 'lease lost'))).toBe(false);
    expect(isTerminalBookGenerationFailure(new Error('unclassified infrastructure failure'))).toBe(false);
  });
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

  test('accepts and detaches without awaiting generation', async () => {
    let current: any; let generationInput: unknown; const detached: Array<() => Promise<void>> = [];
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => null, detail: async () => current };
    const generator: any = { create: async (nextInput: unknown) => { generationInput = nextInput; current = row(); return bookKey; }, write: async () => { throw new Error('must be background'); } };
    const result = await createBookService({ repository, generator, detach: (run) => { detached.push(run); }, signUrl: async () => 'signed', publishChanged: async () => {} }).create(input, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued', isFavorite: false, generationProgressPercent: 0, createdAt: now, updatedAt: now });
    expect(generationInput).toMatchObject({ chapterCount: 10 });
    expect(detached).toHaveLength(1);
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
    const detached: Array<() => Promise<void>> = []; const receipts: unknown[] = []; let suggestions = 0;
    const repository: any = { detail: async () => current, acceptExtension: async (_context: unknown, extension: any) => { receipts.push(extension); current.book = { ...current.book, status: 'queued', chapterCount: extension.targetChapterCount, activeExtensionKey: extension.key }; return { extension, book: current.book, replayed: false }; } };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => {} }, suggestTopics: async (request) => { suggestions += 1; const text = JSON.stringify(request); expect(text).toContain(current.book.description); expect(text).toContain('Summary 10'); return JSON.stringify({ titles: ['The Next Decision'] }); }, detach: (run) => { detached.push(run); }, signUrl: async () => 'signed', publishChanged: async () => {}, now: () => now });
    await expect(service.extend(bookKey, { organizationKey, scopeKey, mode: 'preview', chapterCount: 1 }, userKey)).resolves.toEqual({ titles: ['The Next Decision'] }); expect(suggestions).toBe(1);
    await expect(service.extend(bookKey, { organizationKey, scopeKey, mode: 'generate', chapterCount: 1, titles: ['The Next Decision'], requestKey: 'extension-1' }, userKey)).resolves.toMatchObject({ key: bookKey, status: 'queued', chapterCount: 11, isExtending: true });
    expect(receipts).toHaveLength(1); expect(receipts[0]).toMatchObject({ bookKey, requestKey: 'extension-1', baseChapterCount: 10, targetChapterCount: 11, status: 'pending' }); expect(detached).toHaveLength(1);
  });

  test('detaches generation when durable create is replayed', async () => {
    const detached: Array<() => Promise<void>> = []; const current: any = row();
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => current };
    const generator: any = { create: async () => { throw new Error('unexpected'); }, write: async () => {} };
    const result = await createBookService({ repository, generator, detach: (run) => { detached.push(run); }, signUrl: async () => 'signed' }).create(input, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued' });
    expect(detached).toHaveLength(1);
  });

  test('detaches a queued retry replay', async () => {
    const detached: Array<() => Promise<void>> = []; const current: any = row();
    const repository: any = { retryGeneration: async () => { throw new BookRepositoryError('conflict'); }, detail: async () => current };
    const result = await createBookService({ repository, generator: { create: async () => bookKey, write: async () => {} }, detach: (run) => { detached.push(run); }, signUrl: async () => 'signed', publishChanged: async () => {} }).retry(bookKey, { organizationKey, scopeKey }, userKey);
    expect(result).toMatchObject({ key: bookKey, status: 'queued' });
    expect(detached).toHaveLength(1);
  });

  test('recovers a bounded batch of durable generations through the lease-claiming path', async () => {
    const detached: Array<() => Promise<void>> = [];
    const repository: any = { listRecoverableGenerations: async (_now: string, limit: number) => { expect(limit).toBe(25); return [{ bookKey, organizationKey, scopeKey, userKey }]; } };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => {} }, detach: (run) => detached.push(run), now: () => now });
    await expect(service.recoverGenerations(25)).resolves.toEqual({ recovered: 1 });
    expect(detached).toHaveLength(1);
  });

  test('keeps unknown detached failures recoverable without refunding', async () => {
    let current: any; const calls: string[] = []; const detached: Array<() => Promise<void>> = [];
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => null, detail: async () => current,
      claimGeneration: async () => { calls.push('claim'); return true; }, renewGeneration: async () => true, isCancellationRequested: async () => false,
      releaseGeneration: async () => { calls.push('release'); return true; },
      terminalizeGeneration: async () => { calls.push('terminalize'); return true; },
    };
    const generator: any = { create: async () => { current = row(); return bookKey; }, write: async (_key: string, _input: unknown, context: any) => { calls.push(`write:${context.persistFailure}`); throw new Error('raw provider secret'); } };
    const service = createBookService({ repository, generator, detach: (run) => { detached.push(run); }, scheduleLeaseRenewal: () => () => {}, signUrl: async () => 'signed', publishChanged: async () => { calls.push('publish'); }, now: () => now });
    await expect(service.create(input, userKey)).resolves.toMatchObject({ status: 'queued' });
    expect(calls).toEqual(['publish']);
    await expect(detached[0]!()).resolves.toBeUndefined();
    expect(calls).toEqual(['publish', 'claim', 'write:false', 'release', 'publish']);
    expect(current.book.status).toBe('queued');
  });

  test('terminalizes deterministic detached validation failures exactly once', async () => {
    let current: any; const detached: Array<() => Promise<void>> = []; const terminal: unknown[][] = [];
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => null, detail: async () => current, claimGeneration: async () => true, renewGeneration: async () => true, isCancellationRequested: async () => false, releaseGeneration: async () => true, terminalizeGeneration: async (...args: unknown[]) => { terminal.push(args); return true; } };
    const generator: any = { create: async () => { current = row(); return bookKey; }, write: async () => { throw new BookGenerationTerminalError('invalid output'); } };
    const service = createBookService({ repository, generator, detach: (run) => detached.push(run), scheduleLeaseRenewal: () => () => {}, signUrl: async () => 'signed', publishChanged: async () => {}, now: () => now, id: () => newId() });
    await service.create(input, userKey); await detached[0]!();
    expect(terminal).toHaveLength(1); expect(terminal[0]?.[0]).toMatchObject({ bookKey, scopeKey, userKey }); expect(terminal[0]?.[1]).toBeString(); expect(terminal[0]?.[2]).toContain('Retry');
  });

  test('retries in-process while cancellation and hard deletion remain durable-first', async () => {
    let current: any = row('failed'); const calls: string[] = [];
    const repository: any = { retryGeneration: async () => { calls.push('retry'); current = row(); return current.book; }, cancelGeneration: async () => { calls.push('cancel'); current = row('cancelled'); }, deleteBook: async () => { calls.push('delete'); return { deleted: true, bookKey, shareTokenHash: 'a'.repeat(64) }; }, detail: async () => current };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => {} }, detach: () => { calls.push('detach'); }, signUrl: async () => 'signed', publishChanged: async () => {}, publishShareChanged: async () => {} });
    await service.retry(bookKey, { organizationKey, scopeKey }, userKey); await service.cancel(bookKey, { organizationKey, scopeKey }, userKey); expect(await service.delete(bookKey, { organizationKey, scopeKey }, userKey)).toEqual({ key: bookKey });
    expect(calls).toEqual(['retry', 'detach', 'cancel', 'delete']);
  });

  test('strictly sets favorite state through the repository and publishes the updated summary', async () => {
    const current: any = row('ready'); const calls: unknown[][] = [];
    const repository: any = { setFavorite: async (...args: unknown[]) => { calls.push(args); current.book.isFavorite = (args[2] as boolean); }, detail: async () => current };
    const service = createBookService({ repository, signUrl: async () => 'signed', now: () => now, publishChanged: async (key) => { calls.push(['publish', key]); } });
    await expect(service.setFavorite(bookKey, { organizationKey, scopeKey, isFavorite: true }, userKey)).resolves.toMatchObject({ key: bookKey, isFavorite: true });
    expect(calls).toEqual([[{ organizationKey, scopeKey, userKey }, bookKey, true, now], ['publish', scopeKey]]);
    await expect(service.setFavorite(bookKey, { organizationKey, scopeKey, isFavorite: false, forged: true }, userKey)).rejects.toThrow('Unrecognized key');
  });

  test('does not publish when authorized hard deletion fails', async () => {
    const calls: string[] = []; const repository: any = { deleteBook: async () => { calls.push('delete'); throw new Error('forbidden'); } };
    const service = createBookService({ repository, publishChanged: async () => { calls.push('publish'); } });
    await expect(service.delete(bookKey, { organizationKey, scopeKey }, userKey)).rejects.toThrow('forbidden');
    expect(calls).toEqual(['delete']);
  });

  test('publishes successful hard deletion without external cleanup', async () => {
    const calls: string[] = []; const repository: any = { deleteBook: async () => { calls.push('delete'); return { deleted: true, bookKey, shareTokenHash: 'a'.repeat(64) }; } };
    const service = createBookService({ repository, publishChanged: async () => { calls.push('publish'); }, publishShareChanged: async () => {} });
    await expect(service.delete(bookKey, { organizationKey, scopeKey }, userKey)).resolves.toEqual({ key: bookKey }); expect(calls).toEqual(['delete', 'publish']);
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
    const current: any = row('ready'); current.book.coverStorageKey = 'cover'; current.chapters = [{ chapter: { key: newId(), title: 'One', description: 'One', position: 1, estimatedMinutes: 2, audioStorageKey: 'audio', audioDurationSeconds: 120 }, progress: null }];
    const signed: string[] = []; const repository: any = { list: async () => [current], detail: async () => current };
    const service = createBookService({ repository, signUrl: async (key) => { signed.push(key); return `signed:${key}`; } });
    await service.overview({ organizationKey, scopeKey }, userKey);
    expect(signed).toEqual(['cover']);
    signed.length = 0;
    await service.detail(bookKey, { organizationKey, scopeKey }, userKey);
    expect(signed).toEqual(['cover', 'audio']);
  });
});
