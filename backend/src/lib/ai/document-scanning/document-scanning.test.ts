import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { scanDocumentImages } from '.';

test('preserves ordered pages and reconciles Textract with visual transcription', async () => {
  const uploaded: string[] = [];
  const captionInputs: any[] = [];
  const storage = {
    async upload(input: any) { uploaded.push(input.key); return { storageKey: input.key }; },
    async delete() {},
    async download() { return { bytes: new Uint8Array() }; },
    async copy() { return { storageKey: '' }; },
  };
  const output = await scanDocumentImages({
    scopeKey: newId(),
    name: 'Receipt',
    idempotencyKey: 'stable-scan',
    pages: [1, 2].map((index) => ({ filename: `${index}.jpg`, mimeType: 'image/jpeg' as const, sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, index]) })),
  }, 'organization', {
    storage,
    ocr: { extract: async (key) => ({ extractedText: `textract:${key.at(-5)}`, blocks: [], metadata: {} }) },
    signUrl: async (key) => `https://images.example/${key}`,
    caption: async (input: any) => {
      captionInputs.push(input);
      return input.purpose === 'document-transcription' ? { captions: ['visual one', 'visual two'] } : { captions: ['final one', 'final two'] };
    },
  });
  expect(uploaded).toHaveLength(2);
  expect(uploaded[0]).toContain('/scan/page-01.jpg');
  expect(captionInputs.map(({ purpose }) => purpose)).toEqual(['document-transcription', 'document-reconciliation']);
  expect(captionInputs[1].referenceTexts[0]).toMatchObject({ secondary: 'visual one' });
  expect(output.content).toBe('## Page 1\n\nfinal one\n\n## Page 2\n\nfinal two');
  expect(output.storageKeys).toEqual(uploaded);
});

test('cleans retained scan objects when processing fails', async () => {
  const deleted: string[] = [];
  await expect(scanDocumentImages({ scopeKey: newId(), pages: [{ filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }], idempotencyKey: 'failed' }, 'organization', {
    storage: { async upload(input) { return { storageKey: input.key }; }, async delete(key) { deleted.push(key); }, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    ocr: { extract: async () => { throw new Error('offline'); } },
    signUrl: async () => 'https://images.example/page.jpg',
    caption: async () => ({ captions: ['visual'] }),
  })).rejects.toThrow('offline');
  expect(deleted).toHaveLength(1);
});

test('starts every page OCR and the visual extraction batch before either branch completes', async () => {
  const pageCount = 12;
  let ocrStarted = 0;
  let visualStarted = false;
  let release!: () => void;
  let parallelStarted!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const allStarted = new Promise<void>((resolve) => { parallelStarted = resolve; });
  const markStarted = () => { if (ocrStarted === pageCount && visualStarted) parallelStarted(); };
  const operation = scanDocumentImages({
    scopeKey: newId(),
    idempotencyKey: 'parallel-scan',
    pages: Array.from({ length: pageCount }, (_, index) => ({ filename: `${index}.jpg`, mimeType: 'image/jpeg' as const, sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, index]) })),
  }, 'organization', {
    storage: { async upload(input) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    ocr: { extract: async () => { ocrStarted += 1; markStarted(); await gate; return { extractedText: 'primary', blocks: [], metadata: {} }; } },
    signUrl: async (key) => `https://images.example/${key}`,
    caption: async (input: any) => {
      if (input.purpose === 'document-transcription') { visualStarted = true; markStarted(); await gate; return { captions: Array(pageCount).fill('secondary') }; }
      return { captions: Array(pageCount).fill('unified') };
    },
  });
  await allStarted;
  expect(ocrStarted).toBe(pageCount);
  expect(visualStarted).toBe(true);
  release();
  const result = await operation;
  expect(result.content.match(/## Page/g)).toHaveLength(pageCount);
});
