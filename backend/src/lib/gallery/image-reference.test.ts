import { expect, test } from 'bun:test';
import { imageDataUrl, storedImageDataUrl } from './image-reference';

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
