import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';

const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const inlineMimeTypes = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export function imageDataUrl(bytes: Uint8Array, mimeType: string) {
  if (!inlineMimeTypes.has(mimeType)) throw new Error('Inline image references require a supported image type.');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) throw new Error('Inline image reference size is invalid.');
  return `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`;
}

export async function storedImageDataUrl(storageKey: string, mimeType: string, storage: DocumentObjectStorage = documentStorage) {
  return imageDataUrl((await storage.download(storageKey)).bytes, mimeType);
}
