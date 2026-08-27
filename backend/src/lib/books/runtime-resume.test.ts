import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRuntime } from './runtime';

const sentence = (word: string, count: number) => Array(count).fill(word).join(' ');

describe('book runtime resumability', () => {
  test('reuses every committed stage after publication fails', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); const timestamp = '2026-08-25T12:00:00.000Z';
    const input = { organizationKey: 'organization', scopeKey, topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 2, chapterImages: true, additionalInstructions: 'Use practical examples.' };
    let book: any = { key: bookKey, scopeKey, title: input.topic, description: input.goal, goal: input.goal, audience: input.currentKnowledge, outcome: input.goal, language: input.language, generationBriefFingerprint: 'a'.repeat(64), generationStage: 'accepted', generationCompletedUnits: 0, generationTotalUnits: 43, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, status: 'queued', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    const jpegCover = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: '#663399' } }).jpeg().toBuffer());
    const imageUploads: Array<{ bytes: Uint8Array; mimeType: string }> = [];
    let chapters: any[] = []; let sources: any[] = []; let publicationAttempts = 0; let galleryAttempts = 0; let galleryProcessAttempts = 0; let asks = 0; let outlineAttempts = 0; let draftCorrection = false; let finalizationCorrection = false; let speeches = 0; let covers = 0; let uploads = 0; const imageInputs: any[] = []; const speechInputs: any[] = []; const askInputs: any[] = []; const events: string[] = [];
    const repository: any = {
      detail: async () => ({ book, chapters: chapters.map((chapter) => ({ chapter, progress: null })) }), sources: async () => [...sources],
      isCancellationRequested: async () => false,
      updateBook: async (_context: unknown, _key: string, patch: any) => { book = { ...book, ...patch }; if (patch.coverStorageKey) events.push('cover-persisted'); return book; },
      updateChapter: async (_context: unknown, key: string, patch: any) => { const current = chapters.find((chapter) => chapter.key === key); for (const [field, value] of Object.entries(patch)) { if (value === undefined) delete current[field]; else current[field] = value; } return { ...current }; },
      addSources: async (_context: unknown, _key: string, values: any[]) => { for (const value of values) { const index = sources.findIndex(({ key }) => key === value.key); if (index < 0) sources.push(value); else sources[index] = value; } },
      replaceChapters: async (_context: unknown, _key: string, values: any[], _contexts: any[], patch: any) => { chapters = values; book = { ...book, ...patch }; },
      advanceGeneration: async () => { book.generationCompletedUnits += 1; }, reconcileGeneration: async (_context: unknown, _key: string, units: number) => { book.generationCompletedUnits = Math.max(book.generationCompletedUnits, units); },
      enqueueUnreferencedStorage: async () => {},
      publishChapters: async () => { publicationAttempts += 1; if (publicationAttempts === 1) throw new Error('temporary publication failure'); book.status = 'ready'; book.generationStage = 'complete'; },
      ensureGalleryExportCollection: async () => { galleryAttempts += 1; return { collectionKey: newId(), ownerKey: newId() }; },
      linkGalleryExportImages: async () => { throw new Error('links must not run after processing fails'); },
    };
    const outline = { chapters: Array.from({ length: 10 }, (_, index) => ({ title: `Chapter ${index + 1}`, description: sentence(`brief${index}`, 80), objective: `Objective ${index + 1}`, evidenceKeyPoints: ['Evidence one', 'Evidence two'], topics: ['Decisions'], priorTransition: 'Connect from the prior idea.', nextTransition: 'Prepare the next idea.', repetitionBoundaries: ['Do not repeat the opening example.'], targetWordMin: 500, targetWordMax: 750 })) };
    const runtime = createBookRuntime({
      repository,
      ask: async (askInput: any) => { askInputs.push(askInput); const { systemPrompt } = askInput; asks += 1; if (systemPrompt.startsWith('Design')) return JSON.stringify({ title: 'Better Decisions', description: 'A grounded guide.', outcome: 'Make better decisions.', summary: 'A practical synthesis.' }); if (systemPrompt.startsWith('Create exactly')) { events.push('outline-requested'); outlineAttempts += 1; return JSON.stringify(outlineAttempts === 1 ? { chapters: [] } : outline); } if (systemPrompt.startsWith('Write') && !draftCorrection) { draftCorrection = true; return sentence('short', 499); } if (systemPrompt.startsWith('Continuity-edit') && !finalizationCorrection) { finalizationCorrection = true; return sentence('long', 751); } return sentence(systemPrompt.startsWith('Continuity-edit') ? 'final' : 'draft', 500); },
      embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1), speech: async (speechInput) => { speeches += 1; speechInputs.push(speechInput); return { bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }; },
      images: { generateRaw: async (imageInput: unknown) => { covers += 1; imageInputs.push(imageInput); return { output: { images: [{ base64: Buffer.from(jpegCover).toString('base64'), mimeType: 'image/jpeg' }] }, durationMs: 1, costUsd: null }; } },
      storage: { upload: async ({ key, bytes, mimeType }) => { uploads += 1; if (key.endsWith('.png')) imageUploads.push({ bytes, mimeType }); return { storageKey: key }; }, delete: async () => {}, copy: async ({ destinationKey }) => ({ storageKey: destinationKey }), download: async () => ({ bytes: new Uint8Array(), mimeType: 'application/octet-stream' }) },
      processImageBatch: async (values) => { galleryProcessAttempts += 1; expect(values).toHaveLength(11); expect(values.every(({ idempotencyKey, mutationPolicy }) => idempotencyKey?.startsWith('book-image-export:') && mutationPolicy === 'user')).toBe(true); throw new Error('gallery processing unavailable'); },
      publishChanged: async () => { events.push('book-changed'); }, publishContentChanged: async () => {}, now: () => timestamp,
    });
    const context = { organizationKey: input.organizationKey, scopeKey, userKey, generationLeaseToken: 'lease' };
    await expect(runtime.write(bookKey, input, context)).rejects.toThrow('temporary publication failure');
    expect(book.status).toBe('failed');
    expect({ asks, speeches, covers, uploads }).toEqual({ asks: 24, speeches: 10, covers: 11, uploads: 21 });
    const coverPersisted = events.indexOf('cover-persisted'); const outlineRequested = events.indexOf('outline-requested');
    expect(coverPersisted).toBeGreaterThan(-1); expect(events.slice(coverPersisted + 1, outlineRequested)).toContain('book-changed'); expect(coverPersisted).toBeLessThan(outlineRequested);
    const outlineInput = askInputs.find(({ systemPrompt }) => systemPrompt.startsWith('Create exactly'));
    const outlineContext = JSON.parse(outlineInput.messages[0].content[0].text);
    expect(outlineInput.systemPrompt).toContain('description must contain 80-120 words');
    expect(askInputs.filter(({ systemPrompt }) => systemPrompt.startsWith('Create exactly'))[1].systemPrompt).toContain('previous response was invalid');
    expect(askInputs.some(({ systemPrompt }) => systemPrompt.includes('Continue the existing chapter') && systemPrompt.includes('1-251 additional words'))).toBe(true);
    expect(outlineContext.generationBrief).toMatchObject({ topic: input.topic, goal: input.goal, currentKnowledge: input.currentKnowledge, writingTone: input.writingTone, additionalInstructions: input.additionalInstructions });
    expect(outlineContext.evidence).toEqual({ selectedArchive: [] });
    expect(imageInputs).toEqual(expect.arrayContaining([
      { prompt: 'Editorial audiobook cover without logos. Title: Better Decisions. A grounded guide.', count: 1, size: '1024x1024', quality: 'high', mode: 'default' },
      expect.objectContaining({ prompt: expect.stringContaining('Editorial chapter illustration, no text.'), count: 1, size: '1024x1024', quality: 'high', mode: 'default' }),
    ]));
    expect(imageInputs.every(({ count, size, quality, mode }) => count === 1 && size === '1024x1024' && quality === 'high' && mode === 'default')).toBe(true);
    expect(imageUploads).toHaveLength(11);
    expect(imageUploads[0]!.mimeType).toBe('image/png');
    expect([...imageUploads[0]!.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(chapters.every(({ audioDurationSeconds }) => audioDurationSeconds > 0)).toBe(true);
    expect(speechInputs).toHaveLength(10);
    expect(speechInputs.every(({ voice, pace, format }) => voice === 'alloy' && pace === 2 && format === 'mp3')).toBe(true);
    book.status = 'queued';
    await runtime.write(bookKey, input, context);
    expect(book.status).toBe('ready'); expect(publicationAttempts).toBe(2); expect(galleryAttempts).toBe(1); expect(galleryProcessAttempts).toBe(1);
    expect({ asks, speeches, covers, uploads }).toEqual({ asks: 24, speeches: 10, covers: 11, uploads: 21 });
  });

  test('prioritizes chapter one while bounding draft and audio work', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); const timestamp = '2026-08-25T12:00:00.000Z';
    const input = { organizationKey: 'organization', scopeKey, topic: 'Original topic', goal: 'Learn', currentKnowledge: 'Basics', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 1, chapterImages: false };
    let book: any = { key: bookKey, scopeKey, title: 'Committed title', description: 'Committed description', goal: input.goal, audience: input.currentKnowledge, outcome: input.goal, language: input.language, generationBriefFingerprint: 'b'.repeat(64), generationStage: 'draft', generationCompletedUnits: 1, generationTotalUnits: 33, generationAttempt: 1, estimatedMinutes: 0, chapterCount: 10, status: 'writing', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    const chapter = (position: number) => ({ key: newId(), scopeKey, bookKey, position, title: `Chapter ${position}`, description: sentence('brief', 80), objective: 'Objective', evidenceKeyPoints: ['One', 'Two'], topics: ['Topic'], priorTransition: 'Prior', nextTransition: 'Next', repetitionBoundaries: ['Boundary'], targetWordMin: 500, targetWordMax: 750, status: 'planned', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp });
    const chapters: any[] = Array.from({ length: 10 }, (_, index) => chapter(index + 1));
    const sources: any[] = [{ key: newId(), scopeKey, bookKey, sourceType: 'web', title: 'Source', url: 'https://example.com', content: 'Evidence', contentHash: 'evidence', relevance: 'Research', embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), createdAt: timestamp }];
    const checkpoints: number[] = []; const events: string[] = []; let draftActive = 0; let maxDraftActive = 0; let audioActive = 0; let maxAudioActive = 0; let designRequests = 0;
    let releaseDrafts!: () => void; const draftsReleased = new Promise<void>((resolve) => { releaseDrafts = resolve; });
    let resolveRemainingStarted!: () => void; const remainingStarted = new Promise<void>((resolve) => { resolveRemainingStarted = resolve; }); let remainingDraftsStarted = 0;
    let resolveFirstAudio!: () => void; const firstAudio = new Promise<void>((resolve) => { resolveFirstAudio = resolve; });
    const repository: any = {
      detail: async () => ({ book, chapters: chapters.map((value) => ({ chapter: value, progress: null })) }), sources: async () => sources, isCancellationRequested: async () => false,
      updateBook: async (_context: unknown, _key: string, patch: any) => { book = { ...book, ...patch }; return book; },
      updateChapter: async (_context: unknown, key: string, patch: any) => { const current = chapters.find((value) => value.key === key); Object.assign(current, patch); if (patch.audioStorageKey) events.push(`audio-persisted-${current.position}`); return { ...current }; },
      advanceGeneration: async () => { events.push('progress'); }, reconcileGeneration: async (_context: unknown, _key: string, units: number) => { checkpoints.push(units); }, enqueueUnreferencedStorage: async () => {},
      publishChapters: async () => { book.status = 'ready'; }, ensureGalleryExportCollection: async () => { throw new Error('gallery unavailable'); },
    };
    const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 4, background: '#335577' } }).png().toBuffer());
    const runtime = createBookRuntime({
      repository,
      ask: async (askInput: any) => {
        const systemPrompt = askInput.systemPrompt as string;
        if (systemPrompt.startsWith('Design')) { designRequests += 1; throw new Error('existing title must be reused'); }
        if (systemPrompt.startsWith('Write')) { const position = JSON.parse(askInput.messages[0].content[0].text).chapter.position; draftActive += 1; maxDraftActive = Math.max(maxDraftActive, draftActive); if (position === 1) await remainingStarted; else { remainingDraftsStarted += 1; if (remainingDraftsStarted === 3) resolveRemainingStarted(); await draftsReleased; } draftActive -= 1; return sentence(`draft${position}`, 500); }
        return sentence('final', 500);
      },
      appAudio: { generateForTarget: async (target: any, options: any) => { const position = Number(/chapter-(\d+)-/.exec(target.storageKey)![1]); audioActive += 1; maxAudioActive = Math.max(maxAudioActive, audioActive); const persisted = await options.persist({ storageKey: target.storageKey, durationSeconds: 60 }); events.push(`persist-returned-${position}`); audioActive -= 1; if (position === 1) resolveFirstAudio(); return { target: persisted, storageKey: target.storageKey, durationSeconds: 60 }; } },
      images: { generateRaw: async () => ({ output: { images: [{ base64: Buffer.from(png).toString('base64'), mimeType: 'image/png' }] }, durationMs: 1, costUsd: null }) },
      storage: { upload: async ({ key }) => ({ storageKey: key }), delete: async () => {}, copy: async ({ destinationKey }) => ({ storageKey: destinationKey }), download: async () => ({ bytes: png, mimeType: 'image/png' }) },
      embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1), publishChanged: async () => { events.push('book-changed'); }, publishContentChanged: async () => {}, now: () => timestamp,
    });
    const writing = runtime.write(bookKey, input, { organizationKey: input.organizationKey, scopeKey, userKey, generationLeaseToken: 'lease' });
    await firstAudio;
    expect(draftActive).toBe(3); const audioPersisted = events.indexOf('audio-persisted-1'); const persistReturned = events.indexOf('persist-returned-1'); expect(events.slice(audioPersisted + 1, persistReturned)).toContain('book-changed');
    releaseDrafts(); await writing;
    expect(designRequests).toBe(0); expect(book.title).toBe('Committed title'); expect(maxDraftActive).toBe(4); expect(maxAudioActive).toBeLessThanOrEqual(3);
    expect(checkpoints).toEqual([1, 2, 12, 22, 32]); expect(book.status).toBe('ready');
  });
});
