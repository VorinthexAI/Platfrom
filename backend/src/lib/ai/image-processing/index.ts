import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { EMBEDDING_DIMENSIONS, currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { type Image, getImageById, insertPreparedImage } from '@/lib/db/images.node';
import { newId } from '@/lib/ids';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 100_000_000;
export const OPENAI_VISION_MODEL = 'gpt-4.1-mini';
const formats = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
type Extension = keyof typeof formats;
export type UploadedImageFile = File | { filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array };
export interface ProcessImageInput { scopeKey: string; ownerKey: string; file: UploadedImageFile; idempotencyKey?: string; signal?: AbortSignal; }
interface ResponsesClient { responses: { create(input: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<{ output_text?: string | null }> } }
export interface ImageProcessingDependencies {
  storage?: DocumentStorage; getImage?: typeof getImageById; insertImage?: typeof insertPreparedImage;
  caption?: (input: { filename: string; mimeType: string; bytes: Uint8Array; signal?: AbortSignal }) => Promise<string>;
  embed?: (text: string, signal?: AbortSignal) => Promise<number[]>; openAI?: ResponsesClient;
  maxBytes?: number; maxDimension?: number; maxPixels?: number; createKey?: () => string;
}
export class ImageProcessingError extends Error {
  constructor(public readonly code: 'IMAGE_INVALID_INPUT' | 'IMAGE_TOO_LARGE' | 'IMAGE_DIMENSIONS_INVALID' | 'IMAGE_CAPTION_FAILED' | 'IMAGE_EMBEDDING_FAILED' | 'IMAGE_UPLOAD_FAILED' | 'IMAGE_INSERT_FAILED' | 'IMAGE_CLEANUP_FAILED' | 'IMAGE_IDEMPOTENCY_CONFLICT', message: string, options?: ErrorOptions) { super(message, options); this.name = 'ImageProcessingError'; }
}
const inFlight = new Map<string, { requestHash: string; promise: Promise<Image> }>();
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16be = (bytes: Uint8Array, offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!;
const u16le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256;
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536;
const u32be = (bytes: Uint8Array, offset: number) => bytes[offset]! * 16_777_216 + bytes[offset + 1]! * 65_536 + bytes[offset + 2]! * 256 + bytes[offset + 3]!;
const u32le = (bytes: Uint8Array, offset: number) => bytes[offset]! + bytes[offset + 1]! * 256 + bytes[offset + 2]! * 65_536 + bytes[offset + 3]! * 16_777_216;

function dimensions(extension: Extension, bytes: Uint8Array): { width: number; height: number } | null {
  if (extension === 'png') return bytes.length >= 24 && ascii(bytes, 12, 4) === 'IHDR' ? { width: u32be(bytes, 16), height: u32be(bytes, 20) } : null;
  if (extension === 'gif') return bytes.length >= 10 ? { width: u16le(bytes, 6), height: u16le(bytes, 8) } : null;
  if (extension === 'jpg' || extension === 'jpeg') {
    for (let offset = 2; offset + 3 < bytes.length;) {
      if (bytes[offset] !== 0xff) return null;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++]!;
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      const length = u16be(bytes, offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) return length >= 7 ? { width: u16be(bytes, offset + 5), height: u16be(bytes, offset + 3) } : null;
      offset += length;
    }
    return null;
  }
  if (bytes.length < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP' || u32le(bytes, 4) + 8 !== bytes.length) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  if (chunk === 'VP8L' && bytes[20] === 0x2f) { const bits = u32le(bytes, 21); return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }; }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  return null;
}

function signature(extension: Extension, bytes: Uint8Array): boolean {
  if (extension === 'png') return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (extension === 'gif') return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
  if (extension === 'jpg' || extension === 'jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9;
  return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

async function validate(input: ProcessImageInput, dependencies: ImageProcessingDependencies) {
  if (!/^c[a-z0-9]{8,127}$/.test(input.scopeKey)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image scope key is invalid.');
  if (!/^c[a-z0-9]{8,127}$/.test(input.ownerKey)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image owner key is invalid.');
  if (input.idempotencyKey !== undefined && (input.idempotencyKey.trim() !== input.idempotencyKey || !input.idempotencyKey || input.idempotencyKey.length > 256)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image idempotency key is invalid.');
  const file = input.file; const filename = file instanceof File ? file.name : file.filename; const mimeType = (file instanceof File ? file.type : file.mimeType).trim().toLowerCase(); const sizeBytes = file instanceof File ? file.size : file.sizeBytes;
  if (!filename || filename.trim() !== filename || filename.includes('/') || filename.includes('\\')) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image filename is invalid.');
  const extension = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase() as Extension | undefined;
  if (!extension || !(extension in formats) || formats[extension] !== mimeType || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image metadata is invalid.');
  if (sizeBytes > (dependencies.maxBytes ?? MAX_IMAGE_BYTES)) throw new ImageProcessingError('IMAGE_TOO_LARGE', 'The image exceeds the maximum allowed size.');
  const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file.bytes;
  if (bytes.byteLength !== sizeBytes || !signature(extension, bytes)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image failed its integrity check.');
  const measured = dimensions(extension, bytes); const maxDimension = dependencies.maxDimension ?? MAX_IMAGE_DIMENSION;
  if (!measured || measured.width <= 0 || measured.height <= 0 || measured.width > maxDimension || measured.height > maxDimension || measured.width * measured.height > (dependencies.maxPixels ?? MAX_IMAGE_PIXELS)) throw new ImageProcessingError('IMAGE_DIMENSIONS_INVALID', 'The image dimensions are invalid or exceed the allowed limits.');
  return { filename, mimeType, sizeBytes, bytes, extension, ...measured };
}

type ValidatedImage = Awaited<ReturnType<typeof validate>>;
function imageRequestHash(scopeKey: string, ownerKey: string, image: ValidatedImage): string {
  return hash(`${scopeKey}\0${ownerKey}\0${image.filename}\0${image.mimeType}\0${image.sizeBytes}\0${hash(image.bytes)}`);
}

export async function captionImageWithOpenAI(input: { filename: string; mimeType: string; bytes: Uint8Array; signal?: AbortSignal }, client: ResponsesClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL || undefined })) {
  const response = await client.responses.create({ model: OPENAI_VISION_MODEL, max_output_tokens: 1_500, input: [{ role: 'user', content: [{ type: 'input_text', text: `Describe this image accurately for a searchable media library. Include visible subjects, setting, composition, colors, style, and readable text. The filename is ${JSON.stringify(input.filename)}.` }, { type: 'input_image', image_url: `data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}`, detail: 'high' }] }] }, input.signal ? { signal: input.signal } : undefined);
  return response.output_text?.trim() ?? '';
}

async function removeWithRetry(storage: DocumentStorage, key: string) { let last: unknown; for (let attempt = 0; attempt < 3; attempt += 1) try { await storage.delete(key); return; } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt)); } throw last; }
async function execute(input: ProcessImageInput, image: ValidatedImage, requestHash: string, dependencies: ImageProcessingDependencies): Promise<Image> {
  const getImage = dependencies.getImage ?? getImageById; const insertImage = dependencies.insertImage ?? insertPreparedImage;
  const key = input.idempotencyKey ? `c${hash(`${input.scopeKey}\0${input.idempotencyKey}`).slice(0, 24)}` : (dependencies.createKey ?? newId)();
  const requestedKey = `media/${input.scopeKey}/${key}/${hash(image.bytes)}/original.${image.extension}`;
  if (input.idempotencyKey) { const existing = await getImage(key); if (existing) { if (existing.scopeKey !== input.scopeKey || existing.deletedAt !== null) throw new ImageProcessingError('IMAGE_INSERT_FAILED', 'The idempotent image is unavailable.'); if (existing.filename !== image.filename || existing.mimeType !== image.mimeType || existing.sizeBytes !== image.sizeBytes || existing.width !== image.width || existing.height !== image.height || existing.storageKey !== requestedKey) throw new ImageProcessingError('IMAGE_IDEMPOTENCY_CONFLICT', 'The image idempotency key belongs to a different request.'); return existing; } }
  const storage = dependencies.storage ?? documentStorage; let storageKey: string;
  try { storageKey = (await storage.upload({ key: requestedKey, bytes: image.bytes, mimeType: image.mimeType })).storageKey; } catch (error) { throw new ImageProcessingError('IMAGE_UPLOAD_FAILED', 'The original image could not be uploaded.', { cause: error }); }
  try {
    let caption: string; try { caption = (await (dependencies.caption ?? ((value) => captionImageWithOpenAI(value, dependencies.openAI)))({ filename: image.filename, mimeType: image.mimeType, bytes: image.bytes, signal: input.signal })).trim(); } catch (error) { throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption could not be generated.', { cause: error }); }
    if (!caption) throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption must not be blank.');
    let embedding: number[]; try { embedding = dependencies.embed ? await dependencies.embed(`${image.filename}\n\n${caption}`, input.signal) : await embedText({ text: `${image.filename}\n\n${caption}`, signal: input.signal }); currentEmbeddingSchema.parse(embedding); } catch (error) { throw new ImageProcessingError('IMAGE_EMBEDDING_FAILED', `The image embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite values.`, { cause: error }); }
    const now = new Date().toISOString();
    try { return await insertImage({ key, scopeKey: input.scopeKey, filename: image.filename, caption, storageKey, mimeType: image.mimeType, sizeBytes: image.sizeBytes, width: image.width, height: image.height, embedding, isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now }); } catch (error) { throw new ImageProcessingError('IMAGE_INSERT_FAILED', 'The prepared image could not be persisted.', { cause: error }); }
  } catch (error) {
    let owner: Image | null; try { owner = await getImage(key); } catch (ownershipError) { throw new ImageProcessingError('IMAGE_CLEANUP_FAILED', 'Image ownership could not be verified; the uploaded object was retained.', { cause: new AggregateError([error, ownershipError]) }); }
    if (owner?.storageKey === storageKey) { if (owner.scopeKey === input.scopeKey && owner.deletedAt === null) return owner; throw error; }
    try { await removeWithRetry(storage, storageKey); } catch (cleanupError) { throw new ImageProcessingError('IMAGE_CLEANUP_FAILED', 'Image processing failed and the uploaded object could not be removed.', { cause: new AggregateError([error, cleanupError]) }); }
    throw error;
  }
}

export async function processImage(input: ProcessImageInput, dependencies: ImageProcessingDependencies = {}): Promise<Image> {
  const image = await validate(input, dependencies);
  const requestHash = imageRequestHash(input.scopeKey, input.ownerKey, image);
  if (!input.idempotencyKey) return execute(input, image, requestHash, dependencies);
  const flightKey = `${input.scopeKey}\0${input.idempotencyKey}`;
  const existing = inFlight.get(flightKey);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new ImageProcessingError('IMAGE_IDEMPOTENCY_CONFLICT', 'The image idempotency key is already processing a different request.');
    return existing.promise;
  }
  const promise = execute(input, image, requestHash, dependencies);
  const flight = { requestHash, promise };
  inFlight.set(flightKey, flight);
  try { return await promise; } finally { if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey); }
}
