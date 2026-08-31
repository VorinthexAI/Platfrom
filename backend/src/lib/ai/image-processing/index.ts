import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { executeAction } from '@/lib/ai/router';
import { imageCaptionOutputSchema, type ImageCaptionInput, type ImageCaptionOutput } from '@/lib/ai/providers';
import { documentStorage, type DocumentStorage } from '@/lib/ai/document-processing/storage';
import { EMBEDDING_DIMENSIONS, currentEmbeddingSchema, embedText } from '@/lib/embeddings';
import { type Image, type imageOriginSchema, getImageById, insertPreparedImageWithCaption } from '@/lib/db/images.node';
import { findReusableImageCaption, imageCaptionRecordSchema, PERCEPTUAL_HASH_ALGORITHM, type ImageCaptionRecord } from '@/lib/db/image-captions.node';
import { perceptualHashDistance, perceptualHashSegments, PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';
import { computePerceptualHashBatchDispatched } from './perceptual-hash-queue';
import { newId } from '@/lib/ids';
import type { ImageLocation } from '@/lib/gallery/image-location';
import { buildImageEmbeddingText } from '@/lib/image-embedding';
import { acknowledgeStorageUploadReservation, releaseStorageUploadReservation, renewStorageUploadReservation, reserveStorageKeyForUpload, type StorageUploadReservation } from '@/lib/db/storage-deletion-jobs.node';
import { startStorageUploadHeartbeat } from '@/lib/storage-upload-reservation';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 16_384;
export const MAX_IMAGE_PIXELS = 100_000_000;
const formats = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
type Extension = keyof typeof formats;
export type UploadedImageFile = File | { filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array };
export interface ProcessImageInput { scopeKey: string; ownerKey: string; origin: z.infer<typeof imageOriginSchema>; file: UploadedImageFile; imageKey?: string; idempotencyKey?: string; location?: ImageLocation; mutationPolicy?: 'user' | 'system-only'; signal?: AbortSignal; }
export const generatedImageCaptionSchema = z.object({ caption: z.string().trim().min(1).max(20_000), score: z.number().int().min(1).max(100) }).strict();
export type GeneratedImageCaption = z.infer<typeof generatedImageCaptionSchema>;
export interface ImageProcessingMetrics { count: number; generated: number; reused: number; hashDurationMs: number; captionDurationMs: number; durationMs: number; }
export interface ImageProcessingDependencies {
  storage?: DocumentStorage; getImage?: typeof getImageById;
  persistImage?: (input: { image: Image; caption?: ImageCaptionRecord; actorKey: string }) => Promise<Image>;
  findCaption?: typeof findReusableImageCaption;
  hashBatch?: (images: readonly Uint8Array[]) => Promise<string[]>;
  caption?: (input: { filename: string; mimeType: string; bytes: Uint8Array; signal?: AbortSignal }) => Promise<GeneratedImageCaption>;
  captionBatch?: (inputs: readonly { filename: string; mimeType: string; bytes: Uint8Array; signal?: AbortSignal }[]) => Promise<GeneratedImageCaption[]>;
  embed?: (text: string, signal?: AbortSignal) => Promise<number[]>;
  maxBytes?: number; maxDimension?: number; maxPixels?: number; createKey?: () => string; createCaptionKey?: () => string;
  onMetrics?: (metrics: ImageProcessingMetrics) => void;
  reserveStorageKey?: (storageKey: string) => Promise<StorageUploadReservation | null>;
  renewStorageReservation?: (reservation: StorageUploadReservation) => Promise<boolean>;
  acknowledgeStorageReservation?: (reservation: StorageUploadReservation) => Promise<boolean>;
  releaseStorageReservation?: (reservation: StorageUploadReservation) => Promise<boolean>;
  reservationHeartbeatMs?: number;
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

export async function canonicalizeImageToPng(bytes: Uint8Array, maxPixels = MAX_IMAGE_PIXELS) {
  const result = await sharp(bytes, { animated: false, failOn: 'error', limitInputPixels: maxPixels })
    .rotate()
    .png()
    .toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(result.data), width: result.info.width, height: result.info.height };
}

async function validate(input: ProcessImageInput, dependencies: ImageProcessingDependencies) {
  if (!/^c[a-z0-9]{8,127}$/.test(input.scopeKey)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image scope key is invalid.');
  if (!/^c[a-z0-9]{8,127}$/.test(input.ownerKey)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image owner key is invalid.');
  if (input.imageKey !== undefined && !/^c[a-z0-9]{8,127}$/.test(input.imageKey)) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image key is invalid.');
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
  let canonical: Awaited<ReturnType<typeof canonicalizeImageToPng>>;
  try {
    canonical = await canonicalizeImageToPng(bytes, dependencies.maxPixels ?? MAX_IMAGE_PIXELS);
  } catch (error) {
    throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image could not be converted to PNG.', { cause: error });
  }
  const canonicalBytes = canonical.bytes;
  if (canonicalBytes.byteLength > (dependencies.maxBytes ?? MAX_IMAGE_BYTES)) throw new ImageProcessingError('IMAGE_TOO_LARGE', 'The canonical PNG image exceeds the maximum allowed size.');
  const canonicalFilename = `${filename.replace(/\.[^.]+$/, '').slice(0, 251) || 'image'}.png`;
  return { filename: canonicalFilename, mimeType: 'image/png' as const, sizeBytes: canonicalBytes.byteLength, bytes: canonicalBytes, extension: 'png' as const, width: canonical.width, height: canonical.height, source: { filename, mimeType, sizeBytes, bytes, extension } };
}

type ValidatedImage = Awaited<ReturnType<typeof validate>>;
function imageRequestHash(scopeKey: string, ownerKey: string, origin: ProcessImageInput['origin'], image: ValidatedImage): string {
  return hash(`${scopeKey}\0${ownerKey}\0${origin}\0${image.source.filename}\0${image.source.mimeType}\0${image.source.sizeBytes}\0${hash(image.source.bytes)}`);
}

function persistedImageMatches(existing: Image, input: ProcessImageInput, image: ValidatedImage) {
  const key = input.imageKey ?? `c${hash(`${input.scopeKey}\0${input.idempotencyKey}`).slice(0, 24)}`;
  const canonicalKey = `media/${input.scopeKey}/${key}/${hash(image.bytes)}/original.png`;
  const legacyKey = `media/${input.scopeKey}/${key}/${hash(image.source.bytes)}/original.${image.source.extension}`;
  const canonical = existing.filename === image.filename && existing.mimeType === image.mimeType && existing.sizeBytes === image.sizeBytes && existing.storageKey === canonicalKey;
  const legacy = existing.filename === image.source.filename && existing.mimeType === image.source.mimeType && existing.sizeBytes === image.source.sizeBytes && existing.storageKey === legacyKey;
  return existing.origin === input.origin && existing.width === image.width && existing.height === image.height && (canonical || legacy);
}

export async function captionImageWithVertex(organizationKey: string, input: { filename: string; mimeType: string; bytes: Uint8Array; signal?: AbortSignal }) {
  const providerInput: ImageCaptionInput = { imageUrls: [`data:${input.mimeType};base64,${Buffer.from(input.bytes).toString('base64')}`], purpose: 'caption' };
  const response = await executeAction<ImageCaptionInput & { operation: 'caption' }, ImageCaptionOutput>({ mode: 'auto', organizationKey, actionSlug: 'image' }, { operation: 'caption', ...providerInput }, { providers: ['image.primary'], signal: input.signal, timeoutMs: 180_000 });
  const output = imageCaptionOutputSchema.parse(response.output);
  return generatedImageCaptionSchema.parse(output.results[0]);
}

async function removeWithRetry(storage: DocumentStorage, key: string) { let last: unknown; for (let attempt = 0; attempt < 3; attempt += 1) try { await storage.delete(key); return; } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt)); } throw last; }
async function replayPersistedImage(input: ProcessImageInput, image: ValidatedImage, dependencies: ImageProcessingDependencies): Promise<Image | null> {
  if (!input.idempotencyKey && !input.imageKey) return null;
  const key = input.imageKey ?? `c${hash(`${input.scopeKey}\0${input.idempotencyKey}`).slice(0, 24)}`;
  const existing = await (dependencies.getImage ?? getImageById)(key);
  if (!existing) return null;
  if (existing.scopeKey !== input.scopeKey) throw new ImageProcessingError('IMAGE_INSERT_FAILED', 'The idempotent image is unavailable.');
  if (!persistedImageMatches(existing, input, image)) throw new ImageProcessingError('IMAGE_IDEMPOTENCY_CONFLICT', 'The image idempotency key belongs to a different request.');
  return existing;
}
async function execute(input: ProcessImageInput, image: ValidatedImage, perceptualHash: string, dependencies: ImageProcessingDependencies, prepared?: { canonical?: ImageCaptionRecord; generated?: GeneratedImageCaption & { embedding: number[] } }): Promise<Image> {
  const getImage = dependencies.getImage ?? getImageById;
  const persistImage = dependencies.persistImage ?? insertPreparedImageWithCaption;
  const key = input.imageKey ?? (input.idempotencyKey ? `c${hash(`${input.scopeKey}\0${input.idempotencyKey}`).slice(0, 24)}` : (dependencies.createKey ?? newId)());
  const requestedKey = `media/${input.scopeKey}/${key}/${hash(image.bytes)}/original.png`;
  if (input.idempotencyKey) { const existing = await getImage(key); if (existing) { if (existing.scopeKey !== input.scopeKey) throw new ImageProcessingError('IMAGE_INSERT_FAILED', 'The idempotent image is unavailable.'); if (!persistedImageMatches(existing, input, image)) throw new ImageProcessingError('IMAGE_IDEMPOTENCY_CONFLICT', 'The image idempotency key belongs to a different request.'); return existing; } }
  const storage = dependencies.storage ?? documentStorage; let storageKey: string;
  const customReservation = (storageKey: string): StorageUploadReservation => ({ storageKey, token: 'custom-storage' });
  const renewReservation = dependencies.renewStorageReservation ?? (dependencies.storage ? async () => true : renewStorageUploadReservation);
  const acknowledgeReservation = dependencies.acknowledgeStorageReservation ?? (dependencies.storage ? async () => true : acknowledgeStorageUploadReservation);
  const releaseReservation = dependencies.releaseStorageReservation ?? (dependencies.storage ? async () => true : releaseStorageUploadReservation);
  let reservation: StorageUploadReservation | undefined;
  let heartbeat: ReturnType<typeof startStorageUploadHeartbeat> | undefined;
  try {
    const reserve = dependencies.reserveStorageKey ?? (dependencies.storage ? async (storageKey: string) => customReservation(storageKey) : reserveStorageKeyForUpload);
    reservation = await reserve(requestedKey) ?? undefined;
    if (!reservation) throw new Error('A storage deletion claim or upload reservation is active for this deterministic image key');
    heartbeat = startStorageUploadHeartbeat(reservation, renewReservation, dependencies.reservationHeartbeatMs);
    storageKey = (await storage.upload({ key: requestedKey, bytes: image.bytes, mimeType: image.mimeType })).storageKey;
  } catch (error) { await heartbeat?.stop(); throw new ImageProcessingError('IMAGE_UPLOAD_FAILED', 'The original image could not be uploaded.', { cause: error }); }
  try {
    let canonical = prepared?.canonical ?? await (dependencies.findCaption ?? findReusableImageCaption)(input.scopeKey, perceptualHash, input.ownerKey);
    let captionRecord: ImageCaptionRecord | undefined;
    let caption: string;
    let embedding: number[];
    if (canonical) {
      caption = canonical.caption;
      perceptualHash = canonical.perceptualHash ?? perceptualHash;
      embedding = canonical.embedding;
    } else {
      let generated: GeneratedImageCaption;
      try { generated = prepared?.generated ?? generatedImageCaptionSchema.parse(await (dependencies.caption ? dependencies.caption({ filename: image.filename, mimeType: image.mimeType, bytes: image.bytes, signal: input.signal }) : captionImageWithVertex(input.scopeKey, { filename: image.filename, mimeType: image.mimeType, bytes: image.bytes, signal: input.signal }))); } catch (error) { throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption and score could not be generated.', { cause: error }); }
      await heartbeat.checkpoint();
      caption = generated.caption;
      if (!caption) throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption must not be blank.');
      const embeddingText = buildImageEmbeddingText({ filename: image.filename, caption });
      try { embedding = prepared?.generated?.embedding ?? (dependencies.embed ? await dependencies.embed(embeddingText, input.signal) : await embedText({ text: embeddingText, signal: input.signal })); currentEmbeddingSchema.parse(embedding); } catch (error) { throw new ImageProcessingError('IMAGE_EMBEDDING_FAILED', `The image embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite values.`, { cause: error }); }
      await heartbeat.checkpoint();
      const now = new Date().toISOString();
      const segments = perceptualHashSegments(perceptualHash);
      captionRecord = imageCaptionRecordSchema.parse({
        key: (dependencies.createCaptionKey ?? newId)(),
        scopeKey: input.scopeKey,
        sourceImageKey: key,
        caption,
        score: generated.score,
        scoreVersion: 1,
        embedding,
        perceptualHash,
        hashAlgorithm: PERCEPTUAL_HASH_ALGORITHM,
        hashSegment0: segments[0],
        hashSegment1: segments[1],
        hashSegment2: segments[2],
        hashSegment3: segments[3],
        createdAt: now,
        updatedAt: now,
      });
      canonical = captionRecord;
    }
    if (input.location?.city || input.location?.country || input.location?.countryCode || input.location?.placeName || input.location?.placeSummary) {
      const embeddingText = buildImageEmbeddingText({ filename: image.filename, caption, ...input.location });
      try { embedding = dependencies.embed ? await dependencies.embed(embeddingText, input.signal) : await embedText({ text: embeddingText, signal: input.signal }); currentEmbeddingSchema.parse(embedding); } catch (error) { throw new ImageProcessingError('IMAGE_EMBEDDING_FAILED', `The image embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite values.`, { cause: error }); }
      await heartbeat.checkpoint();
    }
    const now = new Date().toISOString();
    try {
      const persisted = await persistImage({ image: { key, scopeKey: input.scopeKey, filename: image.filename, caption, imageCaptionKey: canonical.key, createdByKey: input.ownerKey, storageKey, mimeType: image.mimeType, sizeBytes: image.sizeBytes, width: image.width, height: image.height, ...(input.location?.city ? { city: input.location.city } : {}), ...(input.location?.country ? { country: input.location.country } : {}), ...(input.location?.countryCode ? { countryCode: input.location.countryCode } : {}), ...(input.location?.placeName ? { placeName: input.location.placeName } : {}), ...(input.location?.placeSummary ? { placeSummary: input.location.placeSummary } : {}), ...(input.location?.latitude !== undefined ? { latitude: input.location.latitude } : {}), ...(input.location?.longitude !== undefined ? { longitude: input.location.longitude } : {}), ...(input.location?.locationSource ? { locationSource: input.location.locationSource } : {}), origin: input.origin, mutationPolicy: input.mutationPolicy ?? 'user', embedding, isFavorite: false, createdAt: now, updatedAt: now }, caption: captionRecord, actorKey: input.ownerKey });
      await heartbeat.checkpoint();
      if (!await acknowledgeReservation(reservation)) throw new Error('Storage upload reservation acknowledgement fence was lost');
      return persisted;
    } catch (error) { throw new ImageProcessingError('IMAGE_INSERT_FAILED', 'The prepared image could not be persisted.', { cause: error }); }
  } catch (error) {
    let owner: Image | null; try { owner = await getImage(key); } catch (ownershipError) { throw new ImageProcessingError('IMAGE_CLEANUP_FAILED', 'Image ownership could not be verified; the uploaded object was retained.', { cause: new AggregateError([error, ownershipError]) }); }
    if (owner?.storageKey === storageKey) { if (owner.scopeKey === input.scopeKey) { await acknowledgeReservation(reservation); return owner; } throw error; }
    try { await removeWithRetry(storage, storageKey); await releaseReservation(reservation); } catch (cleanupError) { throw new ImageProcessingError('IMAGE_CLEANUP_FAILED', 'Image processing failed and the uploaded object could not be removed.', { cause: new AggregateError([error, cleanupError]) }); }
    throw error;
  } finally {
    await heartbeat.stop();
  }
}

export async function processImage(input: ProcessImageInput, dependencies: ImageProcessingDependencies = {}): Promise<Image> {
  const image = await validate(input, dependencies);
  const requestHash = imageRequestHash(input.scopeKey, input.ownerKey, input.origin, image);
  const replay = await replayPersistedImage(input, image, dependencies);
  if (replay) return replay;
  let hashes: string[];
  try { hashes = await (dependencies.hashBatch ?? computePerceptualHashBatchDispatched)([image.bytes]); } catch (error) { throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image could not be decoded for perceptual hashing.', { cause: error }); }
  const [perceptualHash] = hashes;
  if (!perceptualHash) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image perceptual hash could not be computed.');
  if (!input.idempotencyKey) return execute(input, image, perceptualHash, dependencies);
  const flightKey = `${input.scopeKey}\0${input.idempotencyKey}`;
  const existing = inFlight.get(flightKey);
  if (existing) {
    if (existing.requestHash !== requestHash) throw new ImageProcessingError('IMAGE_IDEMPOTENCY_CONFLICT', 'The image idempotency key is already processing a different request.');
    return existing.promise;
  }
  const promise = execute(input, image, perceptualHash, dependencies);
  const flight = { requestHash, promise };
  inFlight.set(flightKey, flight);
  try { return await promise; } finally { if (inFlight.get(flightKey) === flight) inFlight.delete(flightKey); }
}

export async function processImages(inputs: readonly ProcessImageInput[], dependencies: ImageProcessingDependencies = {}): Promise<Image[]> {
  const startedAt = performance.now();
  if (inputs.length === 0 || inputs.length > 20) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'Image batches must contain between 1 and 20 images.');
  const validated = await Promise.all(inputs.map((input) => validate(input, dependencies)));
  const replays = await Promise.all(inputs.map((input, index) => replayPersistedImage(input, validated[index]!, dependencies)));
  const pendingIndices = inputs.map((_, index) => index).filter((index) => !replays[index]);
  if (pendingIndices.length === 0) return replays as Image[];
  let hashes: string[];
  const hashStartedAt = performance.now();
  try { hashes = await (dependencies.hashBatch ?? computePerceptualHashBatchDispatched)(pendingIndices.map((index) => validated[index]!.bytes)); } catch (error) { throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image batch could not be decoded for perceptual hashing.', { cause: error }); }
  const hashDurationMs = performance.now() - hashStartedAt;
  if (hashes.length !== pendingIndices.length) throw new ImageProcessingError('IMAGE_INVALID_INPUT', 'The image perceptual hash batch returned the wrong number of hashes.');
  const canonicalByIndex = new Map<number, ImageCaptionRecord>();
  await Promise.all(pendingIndices.map(async (index, position) => {
    const canonical = await (dependencies.findCaption ?? findReusableImageCaption)(inputs[index]!.scopeKey, hashes[position]!, inputs[index]!.ownerKey);
    if (canonical) canonicalByIndex.set(index, canonical);
  }));
  const representatives: Array<{ index: number; hash: string }> = [];
  const representativeFor = new Map<number, number>();
  pendingIndices.forEach((index, position) => {
    if (canonicalByIndex.has(index)) return;
    const perceptualHash = hashes[position]!;
    const representative = representatives.find((candidate) => perceptualHashDistance(candidate.hash, perceptualHash) <= PERCEPTUAL_HASH_DUPLICATE_DISTANCE);
    if (representative) representativeFor.set(index, representative.index);
    else { representatives.push({ index, hash: perceptualHash }); representativeFor.set(index, index); }
  });
  const captionStartedAt = performance.now();
  const captionInputs = representatives.map(({ index }) => ({ filename: validated[index]!.filename, mimeType: validated[index]!.mimeType, bytes: validated[index]!.bytes, signal: inputs[index]!.signal }));
  let generatedCaptions: GeneratedImageCaption[] = [];
  if (captionInputs.length > 0) {
    try {
      generatedCaptions = dependencies.captionBatch
        ? (await dependencies.captionBatch(captionInputs)).map((result) => generatedImageCaptionSchema.parse(result))
        : await Promise.all(captionInputs.map((value, position) => (dependencies.caption ? dependencies.caption(value) : captionImageWithVertex(inputs[representatives[position]!.index]!.scopeKey, value)).then((result) => generatedImageCaptionSchema.parse(result))));
    } catch (error) {
      throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption batch could not be generated.', { cause: error });
    }
    if (generatedCaptions.length !== captionInputs.length) throw new ImageProcessingError('IMAGE_CAPTION_FAILED', 'The image caption batch returned the wrong number of results.');
  }
  const generatedByIndex = new Map<number, GeneratedImageCaption & { embedding: number[] }>();
  await Promise.all(representatives.map(async ({ index }, position) => {
    const generated = generatedCaptions[position]!;
    let embedding: number[];
    try {
      const embeddingText = buildImageEmbeddingText({ filename: validated[index]!.filename, caption: generated.caption });
      embedding = dependencies.embed ? await dependencies.embed(embeddingText, inputs[index]!.signal) : await embedText({ text: embeddingText, signal: inputs[index]!.signal });
      currentEmbeddingSchema.parse(embedding);
    } catch (error) {
      throw new ImageProcessingError('IMAGE_EMBEDDING_FAILED', `The image embedding must contain exactly ${EMBEDDING_DIMENSIONS} finite values.`, { cause: error });
    }
    generatedByIndex.set(index, { ...generated, embedding });
  }));
  const captionDurationMs = performance.now() - captionStartedAt;
  const results = replays.slice() as Array<Image | null>;
  for (let position = 0; position < pendingIndices.length; position += 1) {
    const index = pendingIndices[position]!;
    const input = inputs[index]!;
    const image = validated[index]!;
    const perceptualHash = hashes[position]!;
    const canonical = canonicalByIndex.get(index);
    const representative = representativeFor.get(index);
    results[index] = await execute(input, image, perceptualHash, dependencies, {
      ...(canonical ? { canonical } : {}),
      ...(representative === index ? { generated: generatedByIndex.get(index)! } : {}),
    });
  }
  dependencies.onMetrics?.({ count: inputs.length, generated: representatives.length, reused: pendingIndices.length - representatives.length, hashDurationMs, captionDurationMs, durationMs: performance.now() - startedAt });
  return results as Image[];
}
