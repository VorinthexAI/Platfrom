import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { createRasterPdf, createTextPdf, liveOcrFixtures } from './live-ocr-fixtures';
import { documentValidate } from '../../src/lib/ai/document-processing';

function verifyCrossReferences(bytes: Buffer, pages: number) {
  const text = bytes.toString('latin1');
  const xrefOffset = Number(/startxref\n(\d+)/.exec(text)![1]);
  expect(text.slice(xrefOffset, xrefOffset + 4)).toBe('xref');
  expect(text).toContain(`/Count ${pages}`);
  const entries = text.slice(xrefOffset).split('\n');
  const count = Number(entries[1]!.split(' ')[1]);
  for (let id = 1; id < count; id += 1) {
    const offset = Number(entries[id + 2]!.slice(0, 10));
    expect(text.slice(offset).startsWith(`${id} 0 obj\n`)).toBe(true);
  }
}

test('live PDF fixtures have real page objects, valid byte offsets and production signatures', async () => {
  for (const [bytes, pages] of [[createTextPdf(5), 5], [await createRasterPdf(2), 2]] as const) {
    verifyCrossReferences(bytes, pages);
    expect((await documentValidate({ scopeKey: 'cmrnlzf640001qc7kazsr96k5', file: { filename: 'benchmark.pdf', mimeType: 'application/pdf', sizeBytes: bytes.length, bytes } }, { logger: () => undefined })).extension).toBe('pdf');
  }
});

test('image fixtures are decodable images and PDF page counts are bounded', async () => {
  const fixture = liveOcrFixtures().find(({ name }) => name === 'png-600x800')!;
  const metadata = await sharp(await fixture.build()).metadata();
  expect(metadata).toMatchObject({ format: 'png', width: 600, height: 800 });
  expect(() => createTextPdf(0)).toThrow();
  await expect(createRasterPdf(19)).rejects.toThrow();
});
