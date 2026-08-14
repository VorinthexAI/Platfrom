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
