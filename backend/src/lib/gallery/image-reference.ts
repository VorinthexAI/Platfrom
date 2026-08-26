import sharp from 'sharp';
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

export async function imageAnalysisDataUrl(bytes: Uint8Array, maxEdge: number) {
  if (!Number.isInteger(maxEdge) || maxEdge <= 0) throw new Error('Image analysis maximum edge must be a positive integer.');
  const derivative = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: 100_000_000 })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
  return imageDataUrl(new Uint8Array(derivative), 'image/png');
}

export async function storedImageAnalysisDataUrl(storageKey: string, maxEdge: number, storage: DocumentObjectStorage = documentStorage) {
  return imageAnalysisDataUrl((await storage.download(storageKey)).bytes, maxEdge);
}
