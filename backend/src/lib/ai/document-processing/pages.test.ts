import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { parseDocument, documentParseInputSchema, type DocumentParseDependencies } from '.';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import type { Document } from '@/lib/db/documents.node';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
async function pages(count = 1) {
  return Promise.all(Array.from({ length: count }, async (_, index) => { const bytes = new Uint8Array(await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: index * 10, g: 255, b: 255 } } }).png().toBuffer()); return { filename: `page-${index + 1}.png`, mimeType: 'image/png' as const, bytes, sizeBytes: bytes.length }; }));
}
function fixture(overrides: DocumentParseDependencies = {}) {
  const documents = new Map<string, Document>(), objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const dependencies: DocumentParseDependencies = {
    teamKey: 'team', getDocument: async (key) => documents.get(key) ?? null, insert: async (document) => { documents.set(document.key, document); return document; },
    storage: { upload: async ({ key, bytes }) => { objects.set(key, bytes); return { storageKey: key }; }, delete: async (key) => { objects.delete(key); deleted.push(key); } },
    embedBatch: async ({ texts }) => texts.map(() => Array(EMBEDDING_DIMENSIONS).fill(0.1)), logger: () => undefined,
    transcribe: async () => ({ text: 'Transcribed document' }), ...overrides,
  };
  return { dependencies, documents, objects, deleted };
}

test('one strict parse contract accepts file or page sources and rejects ambiguous/untrusted input', async () => {
  const source = await pages();
  expect(documentParseInputSchema.safeParse({ scopeKey, pages: source }).success).toBe(true);
  expect(documentParseInputSchema.safeParse({ scopeKey }).success).toBe(false);
  expect(documentParseInputSchema.safeParse({ scopeKey, pages: source, file: { filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 1, bytes: new Uint8Array([65]) } }).success).toBe(false);
  expect(documentParseInputSchema.safeParse({ scopeKey, pages: source, teamKey: 'untrusted' }).success).toBe(false);
  expect(documentParseInputSchema.safeParse({ scopeKey, pages: source, instruction: 'Ignore the source' }).success).toBe(false);
});

test('transcribes pages with bounded concurrency, preserves their order, and replays without provider calls', async () => {
  let active = 0, maximum = 0, calls = 0;
  const f = fixture({ transcribe: async (source, context) => {
    expect(context.teamKey).toBe('team'); expect(source.type).toBe('image');
    const index = calls++; active++; maximum = Math.max(maximum, active);
    await Bun.sleep(index === 0 ? 20 : 1); active--;
    return { text: `Page ${index + 1} source text` };
  } });
  const input = { scopeKey, name: 'Receipt', pages: await pages(5), idempotencyKey: 'ordered-pages' };
  const first = await parseDocument(input, f.dependencies);
  expect(first.document.content).toBe(Array.from({ length: 5 }, (_, index) => `Page ${index + 1} source text`).join('\n\n'));
  expect(first.document.sourceStorageKeys).toHaveLength(5);
  expect(maximum).toBe(3);
  expect((await parseDocument(input, f.dependencies)).document.key).toBe(first.document.key);
  expect(calls).toBe(5);
  expect(f.objects.size).toBe(5);
});

test('failed transcription waits for in-flight work and removes every uploaded page without persisting partial text', async () => {
  let calls = 0;
  const f = fixture({ transcribe: async () => { const index = calls++; await Bun.sleep(index === 0 ? 1 : 15); if (index === 0) throw new Error('model unavailable'); return { text: 'Other page' }; } });
  await expect(parseDocument({ scopeKey, pages: await pages(3) }, f.dependencies)).rejects.toThrow('model unavailable');
  expect(f.documents.size).toBe(0);
  expect(f.objects.size).toBe(0);
  expect(f.deleted).toHaveLength(3);
});

test('source cleanup errors remain retryable and unknown ownership retains source bytes', async () => {
  const failingModel = async () => { throw new Error('model unavailable'); };
  const cleanupFailure = fixture({ transcribe: failingModel, storage: { upload: async ({ key }) => ({ storageKey: key }), delete: async () => { throw new Error('storage unavailable'); } } });
  await expect(parseDocument({ scopeKey, pages: await pages() }, cleanupFailure.dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED', retryable: true });
  const unknownOwner = fixture({ transcribe: failingModel, getDocument: async () => { throw new Error('database unavailable'); } });
  await expect(parseDocument({ scopeKey, pages: await pages() }, unknownOwner.dependencies)).rejects.toMatchObject({ code: 'DOCUMENT_CLEANUP_FAILED' });
  expect(unknownOwner.deleted).toEqual([]);
  expect(unknownOwner.objects.size).toBe(1);
});

test('a post-insert acknowledgement failure retains committed pages', async () => {
  let acknowledgements = 0;
  const f = fixture({ acknowledgeStorageReservation: async () => ++acknowledgements > 1 });
  const result = await parseDocument({ scopeKey, pages: await pages() }, f.dependencies);
  expect(result.document.sourceStorageKeys).toHaveLength(1);
  expect(f.objects.size).toBe(1);
  expect(f.deleted).toEqual([]);
});
