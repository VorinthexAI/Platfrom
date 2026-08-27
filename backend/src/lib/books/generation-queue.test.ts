import { describe, expect, test } from 'bun:test';
import { bookGenerationJobOptions, bookGenerationJobSchema, enqueueBookGenerationIn, processBookGenerationJob, startBookGenerationRecoveryScheduler } from './generation-queue';
import { BOOK_GENERATION_LEASE_MS, BOOK_GENERATION_RETRY_ATTEMPTS, BOOK_GENERATION_RETRY_DELAY_MS } from './generation-config';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRuntime } from './runtime';
import { createBookService } from './service';

describe('book generation queue', () => {
  test('uses strict versioned jobs and retries beyond application lease expiry', () => {
    const key = newId();
    expect(bookGenerationJobSchema.parse({ schemaVersion: 1, bookKey: key, organizationKey: 'org', scopeKey: newId(), userKey: newId() }).bookKey).toBe(key);
    expect(() => bookGenerationJobSchema.parse({ schemaVersion: 2, bookKey: key, organizationKey: 'org', scopeKey: newId(), userKey: newId() })).toThrow();
    expect(bookGenerationJobOptions).toMatchObject({ attempts: BOOK_GENERATION_RETRY_ATTEMPTS, backoff: { type: 'fixed', delay: BOOK_GENERATION_RETRY_DELAY_MS } });
    expect((BOOK_GENERATION_RETRY_ATTEMPTS - 1) * BOOK_GENERATION_RETRY_DELAY_MS).toBeGreaterThanOrEqual(BOOK_GENERATION_LEASE_MS);
  });

  test('removes a terminal stable-ID job before creating a genuinely fresh job', async () => {
    const key = newId(); const calls: string[] = []; const job = { schemaVersion: 1 as const, bookKey: key, organizationKey: 'org', scopeKey: newId(), userKey: newId() };
    const target: any = { getJob: async () => ({ getState: async () => 'failed', remove: async () => { calls.push('remove'); } }), add: async (_name: string, _job: unknown, options: any) => { calls.push('add'); expect(options.jobId).toBe(key); return { id: key }; } };
    expect(await enqueueBookGenerationIn(target, job)).toEqual({ jobId: key }); expect(calls).toEqual(['remove', 'add']);
    target.getJob = async () => ({ id: key, getState: async () => 'active', remove: async () => { calls.push('unexpected'); } });
    await expect(enqueueBookGenerationIn(target, job)).resolves.toEqual({ jobId: key });
    expect(calls).toEqual(['remove', 'add']);
  });

  test('persists failure only when BullMQ exhausts the final attempt', async () => {
    const job = { schemaVersion: 1 as const, bookKey: newId(), organizationKey: 'org', scopeKey: newId(), userKey: newId() }; const terminal: unknown[] = [];
    const service: any = { process: async () => { throw new Error('failed'); }, terminalFailure: async (...args: unknown[]) => { terminal.push(args); } };
    await expect(processBookGenerationJob({ data: job, attemptsMade: 0, opts: { attempts: 2 } }, service)).rejects.toThrow('failed');
    expect(terminal).toEqual([]);
    await expect(processBookGenerationJob({ data: job, attemptsMade: 1, opts: { attempts: 2 } }, service)).rejects.toThrow('failed');
    expect(terminal).toHaveLength(1);
  });

  test('periodic recovery does not overlap a still-running scan', async () => {
    let calls = 0;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const scheduler = startBookGenerationRecoveryScheduler({ intervalMs: 60_000, recover: async () => { calls += 1; await pending; return { recovered: 0 }; } });
    const first = scheduler.run();
    const second = scheduler.run();
    expect(first).toBe(second);
    expect(calls).toBe(1);
    release();
    await first;
    scheduler.close();
  });

  test('keeps real runtime failures recoverable until worker exhaustion', async () => {
    const bookKey = newId(); const scopeKey = newId(); const userKey = newId(); const timestamp = '2026-08-25T12:00:00.000Z'; let terminalFailures = 0;
    const generationInput = { topic: 'Decisions', goal: 'Decide well', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 1, chapterImages: false };
    let book: any = { key: bookKey, scopeKey, title: 'Decisions', description: 'Description', goal: 'Decide well', audience: 'Basics', outcome: 'Decide well', language: 'English', generationInput, generationOwnerKey: userKey, generationStage: 'accepted', generationCompletedUnits: 0, generationTotalUnits: 33, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, status: 'queued', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    const repository: any = {
      detail: async () => ({ book, chapters: [] }), claimGeneration: async () => true, renewGeneration: async () => true, releaseGeneration: async () => true,
      sources: async () => [], isCancellationRequested: async () => false, enqueueUnreferencedStorage: async () => {},
      updateBook: async (_context: unknown, _key: string, patch: any) => { book = { ...book, ...patch }; return book; },
      failTerminalGeneration: async (_job: unknown, message: string) => { terminalFailures += 1; book = { ...book, status: 'failed', generationError: message }; return true; },
    };
    const runtime = createBookRuntime({ repository, ask: async () => { throw new Error('provider secret must not persist'); }, publishChanged: async () => {} });
    const service = createBookService({ repository, generator: runtime, now: () => timestamp, publishChanged: async () => {} });
    const data = { schemaVersion: 1 as const, bookKey, organizationKey: 'organization', scopeKey, userKey };
    await expect(processBookGenerationJob({ data, attemptsMade: 0, opts: { attempts: 2 } }, service)).rejects.toThrow('provider secret');
    expect(book.status).toBe('planning'); expect(book.generationError).toBeUndefined(); expect(terminalFailures).toBe(0);
    await expect(processBookGenerationJob({ data, attemptsMade: 1, opts: { attempts: 2 } }, service)).rejects.toThrow('provider secret');
    expect(book.status).toBe('failed'); expect(book.generationError).toBe('Book generation failed after all retry attempts. Retry the book to continue.'); expect(terminalFailures).toBe(1);
  });
});
