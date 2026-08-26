import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createBookRuntime } from './runtime';

const sentence = (word: string, count: number) => Array(count).fill(word).join(' ');

describe('book runtime resumability', () => {
  test('reuses every committed stage after publication fails', async () => {
    const scopeKey = newId(); const bookKey = newId(); const userKey = newId(); const timestamp = '2026-08-25T12:00:00.000Z';
    const input = { organizationKey: 'organization', scopeKey, topic: 'Decision making', goal: 'Decide well', currentKnowledge: 'Basic familiarity', writingTone: 'Clear', chapterCount: 10 as const, language: 'English', archiveDocumentKeys: [], narratorVoiceKey: 'clear' as const, narrationPace: 2, chapterImages: false };
    let book: any = { key: bookKey, scopeKey, title: input.topic, description: input.goal, goal: input.goal, audience: input.currentKnowledge, outcome: input.goal, language: input.language, generationBriefFingerprint: 'a'.repeat(64), generationStage: 'accepted', generationCompletedUnits: 0, generationTotalUnits: 34, generationAttempt: 0, estimatedMinutes: 0, chapterCount: 10, status: 'queued', embedding: Array(EMBEDDING_DIMENSIONS).fill(0), createdAt: timestamp, updatedAt: timestamp };
    const jpegCover = new Uint8Array(await sharp({ create: { width: 3, height: 2, channels: 3, background: '#663399' } }).jpeg().toBuffer());
    const imageUploads: Array<{ bytes: Uint8Array; mimeType: string }> = [];
    let chapters: any[] = []; let sources: any[] = []; let publicationAttempts = 0; let asks = 0; let searches = 0; let speeches = 0; let covers = 0; let uploads = 0;
    const repository: any = {
      detail: async () => ({ book, chapters: chapters.map((chapter) => ({ chapter, progress: null })) }), sources: async () => [...sources],
      isCancellationRequested: async () => false,
      updateBook: async (_context: unknown, _key: string, patch: any) => { book = { ...book, ...patch }; return book; },
      updateChapter: async (_context: unknown, key: string, patch: any) => { const current = chapters.find((chapter) => chapter.key === key); for (const [field, value] of Object.entries(patch)) { if (value === undefined) delete current[field]; else current[field] = value; } return { ...current }; },
      addSources: async (_context: unknown, _key: string, values: any[]) => { for (const value of values) { const index = sources.findIndex(({ key }) => key === value.key); if (index < 0) sources.push(value); else sources[index] = value; } },
      replaceChapters: async (_context: unknown, _key: string, values: any[], _contexts: any[], patch: any) => { chapters = values; book = { ...book, ...patch }; },
      advanceGeneration: async () => { book.generationCompletedUnits += 1; }, reconcileGeneration: async (_context: unknown, _key: string, units: number) => { book.generationCompletedUnits = Math.max(book.generationCompletedUnits, units); },
      enqueueUnreferencedStorage: async () => {},
      publishChapters: async () => { publicationAttempts += 1; if (publicationAttempts === 1) throw new Error('temporary publication failure'); book.status = 'ready'; book.generationStage = 'complete'; },
    };
    const outline = { chapters: Array.from({ length: 10 }, (_, index) => ({ title: `Chapter ${index + 1}`, description: sentence(`brief${index}`, 80), objective: `Objective ${index + 1}`, evidenceKeyPoints: ['Evidence one', 'Evidence two'], topics: ['Decisions'], priorTransition: 'Connect from the prior idea.', nextTransition: 'Prepare the next idea.', repetitionBoundaries: ['Do not repeat the opening example.'], targetWordMin: 500, targetWordMax: 750 })) };
    const runtime = createBookRuntime({
      repository,
      research: async () => { searches += 1; return { text: 'Grounded research synthesis.', citations: [{ title: 'Research source', url: 'https://example.com/source' }], sources: ['https://example.com/source'] }; },
      ask: async ({ systemPrompt }: any) => { asks += 1; if (systemPrompt.startsWith('Design')) return JSON.stringify({ title: 'Better Decisions', description: 'A grounded guide.', outcome: 'Make better decisions.', summary: 'A practical synthesis.' }); if (systemPrompt.startsWith('Create exactly')) return JSON.stringify(outline); return sentence(systemPrompt.startsWith('Continuity-edit') ? 'final' : 'draft', 500); },
      embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1), speech: async () => { speeches += 1; return { bytes: new Uint8Array([1]), mimeType: 'audio/mpeg' }; },
      cover: async () => { covers += 1; return { bytes: jpegCover, mimeType: 'image/jpeg' }; },
      storage: { upload: async ({ key, bytes, mimeType }) => { uploads += 1; if (key.endsWith('.png')) imageUploads.push({ bytes, mimeType }); return { storageKey: key }; }, delete: async () => {}, copy: async ({ destinationKey }) => ({ storageKey: destinationKey }), download: async () => ({ bytes: new Uint8Array(), mimeType: 'application/octet-stream' }) },
      publishChanged: async () => {}, publishContentChanged: async () => {}, now: () => timestamp,
    });
    const context = { organizationKey: input.organizationKey, scopeKey, userKey, generationLeaseToken: 'lease' };
    await expect(runtime.write(bookKey, input, context)).rejects.toThrow('temporary publication failure');
    expect(book.status).toBe('failed');
    expect({ searches, asks, speeches, covers, uploads }).toEqual({ searches: 1, asks: 22, speeches: 10, covers: 1, uploads: 11 });
    expect(imageUploads).toHaveLength(1);
    expect(imageUploads[0]!.mimeType).toBe('image/png');
    expect([...imageUploads[0]!.bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(chapters.every(({ audioDurationSeconds }) => audioDurationSeconds === 93)).toBe(true);
    book.status = 'queued';
    await runtime.write(bookKey, input, context);
    expect(book.status).toBe('ready'); expect(publicationAttempts).toBe(2);
    expect({ searches, asks, speeches, covers, uploads }).toEqual({ searches: 1, asks: 22, speeches: 10, covers: 1, uploads: 11 });
  });
});
