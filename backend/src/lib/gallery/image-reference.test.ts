import { expect, test } from 'bun:test';
import sharp from 'sharp';
import { imageAnalysisDataUrl, imageDataUrl, storedImageAnalysisDataUrl, storedImageDataUrl } from './image-reference';

test('loads a stored image into a provider-safe inline reference', async () => {
  let requestedKey = '';
  const storage = {
    async download(key: string) { requestedKey = key; return { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }; },
    async upload() { throw new Error('not used'); },
    async delete() {},
    async copy() { throw new Error('not used'); },
  };

  await expect(storedImageDataUrl('media/scope/image/original.jpg', 'image/jpeg', storage)).resolves.toBe('data:image/jpeg;base64,/9j/2Q==');
  expect(requestedKey).toBe('media/scope/image/original.jpg');
  await expect(storedImageDataUrl('media/scope/image/original.svg', 'image/svg+xml', storage)).rejects.toThrow('supported image type');
});

test('builds a provider-safe inline reference from sanitized bytes', () => {
  expect(imageDataUrl(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 'image/jpeg')).toBe('data:image/jpeg;base64,/9j/2Q==');
});

test('creates bounded PNG analysis derivatives without changing the source', async () => {
  const source = new Uint8Array(await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#336699' } }).png().toBuffer());
  const original = new Uint8Array(source);
  const reference = await imageAnalysisDataUrl(source, 768);
  const bytes = Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64');

  expect(reference.startsWith('data:image/png;base64,')).toBe(true);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 768, height: 576, format: 'png' });
  expect(source).toEqual(original);
  await expect(imageAnalysisDataUrl(source, 0)).rejects.toThrow('positive integer');
});

test('loads and bounds stored analysis references without enlarging small images', async () => {
  const source = new Uint8Array(await sharp({ create: { width: 400, height: 300, channels: 3, background: '#663399' } }).jpeg().toBuffer());
  let requestedKey = '';
  const storage = {
    async download(key: string) { requestedKey = key; return { bytes: source }; },
    async upload() { throw new Error('not used'); }, async delete() {}, async copy() { throw new Error('not used'); },
  };
  const reference = await storedImageAnalysisDataUrl('media/scope/image/original.jpg', 1024, storage);
  const bytes = Buffer.from(reference.slice(reference.indexOf(',') + 1), 'base64');
  expect(await sharp(bytes).metadata()).toMatchObject({ width: 400, height: 300 });
  expect(requestedKey).toBe('media/scope/image/original.jpg');
});
