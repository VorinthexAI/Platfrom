import { expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { normalizeDocumentTranscription, scanDocumentImages } from '.';

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
      const first = input.imageUrls[0].includes('page-01');
      return { captions: [input.purpose === 'document-transcription' ? first ? 'visual one' : 'visual two' : first ? 'final one' : 'final two'] };
    },
  });
  expect(uploaded).toHaveLength(2);
  expect(uploaded[0]).toContain('/scan/page-01.jpg');
  expect(captionInputs.filter(({ purpose }) => purpose === 'document-transcription')).toHaveLength(2);
  expect(captionInputs.filter(({ purpose }) => purpose === 'document-reconciliation')).toHaveLength(2);
  expect(captionInputs.find((input) => input.purpose === 'document-reconciliation' && input.imageUrls[0].includes('page-01')).referenceTexts[0]).toMatchObject({ secondary: 'visual one' });
  expect(output.content).toBe('Page 1\n\nfinal one\n\nPage 2\n\nfinal two');
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

test('creates OCR content when the visual provider is unavailable', async () => {
  const output = await scanDocumentImages({
    scopeKey: newId(),
    idempotencyKey: 'ocr-fallback',
    pages: [{ filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
  }, 'organization', {
    storage: { async upload(input) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    ocr: { extract: async () => ({ extractedText: 'Reliable Textract text', blocks: [], metadata: {} }) },
    signUrl: async () => 'https://images.example/page.jpg',
    caption: async () => { throw new Error('visual provider unavailable'); },
  });
  expect(output.content).toBe('Reliable Textract text');
});

test('uses OCR content when visual reconciliation fails', async () => {
  const output = await scanDocumentImages({
    scopeKey: newId(),
    idempotencyKey: 'reconciliation-fallback',
    pages: [{ filename: '1.jpg', mimeType: 'image/jpeg', sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }],
  }, 'organization', {
    storage: { async upload(input) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    ocr: { extract: async () => ({ extractedText: 'Primary OCR', blocks: [], metadata: {} }) },
    signUrl: async () => 'https://images.example/page.jpg',
    caption: async (input: any) => {
      if (input.purpose === 'document-transcription') return { captions: ['Visual OCR'] };
      throw new Error('reconciliation unavailable');
    },
  });
  expect(output.content).toBe('Primary OCR');
});

test('starts every page in both visual stages concurrently while OCR runs in parallel', async () => {
  const pageCount = 12;
  let ocrStarted = 0;
  let visualStarted = 0;
  let reconciliationStarted = 0;
  let releaseExtraction!: () => void;
  let releaseReconciliation!: () => void;
  let parallelStarted!: () => void;
  let allReconciliationsStarted!: () => void;
  const extractionGate = new Promise<void>((resolve) => { releaseExtraction = resolve; });
  const reconciliationGate = new Promise<void>((resolve) => { releaseReconciliation = resolve; });
  const allStarted = new Promise<void>((resolve) => { parallelStarted = resolve; });
  const reconciliationStartedSignal = new Promise<void>((resolve) => { allReconciliationsStarted = resolve; });
  const markStarted = () => { if (ocrStarted === pageCount && visualStarted === pageCount) parallelStarted(); };
  const operation = scanDocumentImages({
    scopeKey: newId(),
    idempotencyKey: 'parallel-scan',
    pages: Array.from({ length: pageCount }, (_, index) => ({ filename: `${index}.jpg`, mimeType: 'image/jpeg' as const, sizeBytes: 4, bytes: new Uint8Array([0xff, 0xd8, 0xff, index]) })),
  }, 'organization', {
    storage: { async upload(input) { return { storageKey: input.key }; }, async delete() {}, async download() { return { bytes: new Uint8Array() }; }, async copy() { return { storageKey: '' }; } },
    ocr: { extract: async () => { ocrStarted += 1; markStarted(); await extractionGate; return { extractedText: 'primary', blocks: [], metadata: {} }; } },
    signUrl: async (key) => `https://images.example/${key}`,
    caption: async (input: any) => {
      if (input.purpose === 'document-transcription') { visualStarted += 1; markStarted(); await extractionGate; return { captions: ['secondary'] }; }
      reconciliationStarted += 1;
      if (reconciliationStarted === pageCount) allReconciliationsStarted();
      await reconciliationGate;
      return { captions: ['unified'] };
    },
  });
  await allStarted;
  expect(ocrStarted).toBe(pageCount);
  expect(visualStarted).toBe(pageCount);
  releaseExtraction();
  await reconciliationStartedSignal;
  expect(reconciliationStarted).toBe(pageCount);
  releaseReconciliation();
  const result = await operation;
  expect(result.content.match(/Page \d+/g)).toHaveLength(pageCount);
});

test('normalizes model wrappers without stripping visible document symbols', () => {
  expect(normalizeDocumentTranscription('```text\r\nTranscription: # Invoice\r\n\r\n\r\nTotal: *42*\r\n```')).toBe('# Invoice\n\nTotal: *42*');
});

test('removes tabs, indentation, repeated spaces, and excessive blank lines', () => {
  expect(normalizeDocumentTranscription('\t  Invoice   number  42  \n   \n\t\n  Total:\t\t $10.00   ')).toBe('Invoice number 42\n\nTotal: $10.00');
});

test('collapses Textract-style blank lines between every detected line', () => {
  expect(normalizeDocumentTranscription('Invoice\n\nNumber 42\n\nTotal $10.00\n\nPaid')).toBe('Invoice\nNumber 42\nTotal $10.00\nPaid');
  expect(normalizeDocumentTranscription('Heading\n\nFirst paragraph\nSecond line\n\nClosing paragraph')).toBe('Heading\n\nFirst paragraph\nSecond line\n\nClosing paragraph');
});
