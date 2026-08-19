import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createBookService } from './service';
import { BookRepositoryError } from './repository';

const organizationKey = 'organization'; const scopeKey = newId(); const userKey = newId(); const bookKey = newId(); const chapterKey = newId(); const now = '2026-08-12T12:00:00.000Z';
const book = { key: bookKey, scopeKey, title: 'Clear Thinking', description: 'A guide', goal: 'Decide well', audience: 'Leaders', outcome: 'Better decisions', language: 'en', estimatedMinutes: 10, chapterCount: 1, isFavorite: false, status: 'ready' as const, embedding: Array(4096).fill(0), deletedAt: null, createdAt: now, updatedAt: now };
const chapter = { key: chapterKey, scopeKey, bookKey, title: 'Signals', description: 'Notice signals', objective: 'Observe', topics: ['attention'], content: 'Chapter prose', status: 'written' as const, position: 1, estimatedMinutes: 10, embedding: Array(4096).fill(0), createdAt: now, updatedAt: now };
const createInput = { organizationKey, scopeKey, generationRequestKey: 'stable-request', topic: 'Thinking', goal: 'Improve', audience: 'Leaders', tone: 'Clear', length: 'short' as const, language: 'English' };
const briefFingerprint = (input: typeof createInput = createInput) => { const { generationRequestKey: _key, organizationKey: _organization, scopeKey: _scope, ...brief } = input; return createHash('sha256').update(JSON.stringify(brief)).digest('hex'); };
const detailRow = (status: 'planning' | 'generating' | 'failed' | 'ready' = 'planning', fingerprint = briefFingerprint()) => ({ book: { ...book, generationRequestKey: createInput.generationRequestKey, generationBriefFingerprint: fingerprint, status }, chapters: status === 'ready' ? [{ chapter, progress: null }] : [] });

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

  test('allows exactly one genuinely overlapping caller to write while the other polls for ready', async () => {
    let row: any = null; let lease: { token: string; expiresAt: string } | null = null; let writes = 0; let polls = 0;
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => row, detail: async () => row,
      claimGeneration: async (_context: unknown, _key: string, token: string, claimedAt: string, expiresAt: string) => { if (lease && lease.expiresAt > claimedAt) return false; lease = { token, expiresAt }; row = { ...row, book: { ...row.book, generationLeaseToken: token, generationLeaseExpiresAt: expiresAt } }; return true; },
      releaseGeneration: async (_context: unknown, _key: string, token: string) => { if (lease?.token === token) lease = null; },
    };
    const generator: any = {
      create: async (input: { generationBriefFingerprint: string }) => { await Bun.sleep(1); if (row) throw new BookRepositoryError('conflict'); row = detailRow('planning', input.generationBriefFingerprint); return bookKey; },
      write: async () => { writes += 1; await Bun.sleep(10); row = detailRow('ready'); },
    };
    const service = createBookService({ repository, generator, signUrl: async () => 'signed', sleep: async () => { polls += 1; await Bun.sleep(1); }, generationPollMs: 1 });
    const results = await Promise.all([service.create(createInput, userKey), service.create(createInput, userKey)]);
    expect(results).toEqual([expect.objectContaining({ key: bookKey, status: 'ready' }), expect.objectContaining({ key: bookKey, status: 'ready' })]);
    expect(writes).toBe(1); expect(polls).toBeGreaterThan(0);
  });

  test('rejects generation request key reuse with a different normalized brief', async () => {
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => detailRow('ready'), detail: async () => detailRow('ready') };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => { throw new Error('unexpected write'); } }, signUrl: async () => 'signed' });
    await expect(service.create({ ...createInput, topic: 'Different topic' }, userKey)).rejects.toMatchObject({ reason: 'conflict', message: 'Generation request key was reused with a different brief.' });
  });

  test('returns a ready legacy replay without evaluating the retry brief', async () => {
    const legacy: any = detailRow('ready'); delete legacy.book.generationBriefFingerprint;
    let claims = 0; let writes = 0;
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => legacy, detail: async () => legacy,
      claimGeneration: async () => { claims += 1; return true; },
    };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => { writes += 1; } }, signUrl: async () => 'signed' });
    await expect(service.create({ ...createInput, topic: 'Unverifiable retry topic' }, userKey)).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(claims).toBe(0); expect(writes).toBe(0); expect(legacy.book.generationBriefFingerprint).toBeUndefined();
  });

  test('rejects an incomplete legacy replay because the original brief cannot be verified', async () => {
    const legacy: any = detailRow('planning'); delete legacy.book.generationBriefFingerprint;
    let claims = 0; let writes = 0;
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => legacy, detail: async () => legacy,
      claimGeneration: async () => { claims += 1; return true; },
    };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => { writes += 1; } }, signUrl: async () => 'signed' });
    await expect(service.create(createInput, userKey)).rejects.toMatchObject({ reason: 'conflict', message: 'Cannot resume legacy book generation because the original brief cannot be verified.' });
    expect(claims).toBe(0); expect(writes).toBe(0); expect(legacy.book.generationBriefFingerprint).toBeUndefined();
  });

  test('takes over an expired lease using the configured clock and sleep', async () => {
    let clock = Date.parse(now); const sleeps: number[] = []; let writes = 0;
    let row: any = { ...detailRow(), book: { ...detailRow().book, generationLeaseToken: 'crashed-writer', generationLeaseExpiresAt: new Date(clock + 100).toISOString() } };
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => row, detail: async () => row,
      claimGeneration: async (_context: unknown, _key: string, token: string, claimedAt: string, expiresAt: string) => { if (row.book.generationLeaseToken && row.book.generationLeaseExpiresAt > claimedAt) return false; row = { ...row, book: { ...row.book, generationLeaseToken: token, generationLeaseExpiresAt: expiresAt } }; return true; },
      releaseGeneration: async () => {},
    };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => { writes += 1; row = detailRow('ready'); } }, signUrl: async () => 'signed', now: () => new Date(clock).toISOString(), sleep: async (milliseconds) => { sleeps.push(milliseconds); clock += milliseconds; }, leaseToken: () => 'takeover', generationLeaseMs: 1_000, generationPollMs: 1_000 });
    await expect(service.create(createInput, userKey)).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(sleeps).toEqual([100]); expect(writes).toBe(1);
  });

  test('renews its lease deterministically while a long generation is running', async () => {
    let clock = Date.parse(now); let row: any = detailRow(); let activeToken: string | null = null; const expirations: string[] = []; const releases: string[] = [];
    let renew: (() => Promise<void>) | undefined; let finishWrite!: () => void; let writing!: () => void;
    const writeStarted = new Promise<void>((resolve) => { writing = resolve; });
    const writeFinished = new Promise<void>((resolve) => { finishWrite = resolve; });
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => row, detail: async () => row,
      claimGeneration: async (_context: unknown, _key: string, token: string, _claimedAt: string, expiresAt: string) => { activeToken = token; expirations.push(expiresAt); return true; },
      renewGeneration: async (_context: unknown, _key: string, token: string, expiresAt: string) => { if (activeToken !== token) return false; expirations.push(expiresAt); return true; },
      releaseGeneration: async (_context: unknown, _key: string, token: string) => { if (activeToken !== token) return false; activeToken = null; releases.push(token); return true; },
    };
    const generator: any = { create: async () => bookKey, write: async (_key: string, _brief: unknown, context: { generationLeaseToken?: string }) => { expect(context.generationLeaseToken).toBe('owner'); writing(); await writeFinished; row = detailRow('ready'); } };
    const service = createBookService({ repository, generator, signUrl: async () => 'signed', now: () => new Date(clock).toISOString(), leaseToken: () => 'owner', generationLeaseMs: 900, generationRenewMs: 300, scheduleLeaseRenewal: (callback) => { renew = callback; return () => {}; } });
    const pending = service.create(createInput, userKey); await writeStarted;
    clock += 300; await renew!(); clock += 300; await renew!();
    finishWrite(); await expect(pending).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(expirations).toEqual([new Date(Date.parse(now) + 900).toISOString(), new Date(Date.parse(now) + 1_200).toISOString(), new Date(Date.parse(now) + 1_500).toISOString()]);
    expect(releases).toEqual(['owner']);
  });

  test('does not release or complete after another token takes over', async () => {
    let row: any = detailRow(); let activeToken = ''; const releases: string[] = []; let renew: (() => Promise<void>) | undefined; let finishWrite!: () => void; let writing!: () => void;
    const writeStarted = new Promise<void>((resolve) => { writing = resolve; }); const writeFinished = new Promise<void>((resolve) => { finishWrite = resolve; });
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => row, detail: async () => row,
      claimGeneration: async (_context: unknown, _key: string, token: string) => { activeToken = token; return true; },
      renewGeneration: async (_context: unknown, _key: string, token: string) => activeToken === token,
      releaseGeneration: async (_context: unknown, _key: string, token: string) => { if (activeToken !== token) return false; releases.push(token); activeToken = ''; return true; },
    };
    const generator: any = { create: async () => bookKey, write: async () => { writing(); await writeFinished; } };
    const service = createBookService({ repository, generator, signUrl: async () => 'signed', leaseToken: () => 'stale-owner', generationLeaseMs: 900, generationRenewMs: 300, scheduleLeaseRenewal: (callback) => { renew = callback; return () => {}; } });
    const pending = service.create(createInput, userKey); await writeStarted;
    activeToken = 'new-owner'; await renew!(); finishWrite();
    await expect(pending).rejects.toMatchObject({ reason: 'conflict', message: 'Book generation lease was lost.' });
    expect(releases).toEqual([]); expect(activeToken).toBe('new-owner'); expect(row.book.status).toBe('planning');
  });

  test('releases a failed writer lease and remains resumable', async () => {
    let row: any = detailRow(); let lease: string | null = null; let attempts = 0; const releases: string[] = [];
    const repository: any = {
      authorize: async () => {}, findByGenerationRequest: async () => row, detail: async () => row,
      claimGeneration: async (_context: unknown, _key: string, token: string) => { if (lease) return false; lease = token; return true; },
      releaseGeneration: async (_context: unknown, _key: string, token: string) => { if (lease === token) { releases.push(token); lease = null; } },
    };
    const generator: any = { create: async () => bookKey, write: async () => { attempts += 1; if (attempts === 1) { row = detailRow('failed'); throw new Error('write failed'); } row = detailRow('ready'); } };
    let token = 0; const service = createBookService({ repository, generator, signUrl: async () => 'signed', leaseToken: () => `lease-${++token}` });
    await expect(service.create(createInput, userKey)).rejects.toThrow('write failed');
    await expect(service.create(createInput, userKey)).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(attempts).toBe(2); expect(releases).toEqual(['lease-1', 'lease-2']);
  });

  test('returns a ready replay without claiming or writing', async () => {
    let claims = 0; let writes = 0; const ready = detailRow('ready');
    const repository: any = { authorize: async () => {}, findByGenerationRequest: async () => ready, detail: async () => ready, claimGeneration: async () => { claims += 1; return true; } };
    const service = createBookService({ repository, generator: { create: async () => bookKey, write: async () => { writes += 1; } }, signUrl: async () => 'signed' });
    await expect(service.create({ ...createInput, generationRequestKey: ' stable-request ', topic: ' Thinking ', goal: ' Improve ' }, userKey)).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(claims).toBe(0); expect(writes).toBe(0);
  });

  test('loads and resumes the unique-index winner after a concurrent create collision', async () => {
    const winner = detailRow();
    let finds = 0;
    const calls: string[] = [];
    const repository: any = {
      authorize: async () => {},
      findByGenerationRequest: async () => ++finds === 1 ? null : winner,
      claimGeneration: async () => true,
      releaseGeneration: async () => {},
      detail: async () => detailRow('ready'),
    };
    const generator: any = {
      create: async () => { calls.push('create'); throw new BookRepositoryError('conflict'); },
      write: async (key: string) => { calls.push(`write:${key}`); },
    };
    const service = createBookService({ repository, generator, signUrl: async () => 'signed' });
    await expect(service.create(createInput, userKey)).resolves.toMatchObject({ key: bookKey, status: 'ready' });
    expect(calls).toEqual(['create', `write:${bookKey}`]);
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
