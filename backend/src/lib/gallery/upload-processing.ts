import { performance } from 'node:perf_hooks';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { galleryUploadSchema } from '@/lib/db/gallery-uploads.node';
import { ImageProcessingError, processImages, type GeneratedImageCaption, type ImageProcessingMetrics } from '@/lib/ai/image-processing';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { EMBEDDING_DIMENSIONS, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { computePerceptualHashBatch } from '@/lib/perceptual-hash';
import { getDefaultGalleryRepository, type GalleryRepository } from './repository';
import { imageAnalysisDataUrl } from './image-reference';
import { reverseGeocodeImage, sanitizeGalleryImage, type ImageCoordinates, type ImageLocation } from './image-location';

export type GalleryUploadBatchMetrics = ImageProcessingMetrics & {
  downloadDurationMs: number;
  persistDurationMs: number;
};

export interface GalleryUploadProcessingDependencies {
  repository?: GalleryRepository;
  storage?: DocumentObjectStorage;
  processBatch?: typeof processImages;
  captionBatch?: (organizationKey: string, imageUrls: string[]) => Promise<GeneratedImageCaption[]>;
  resolveImageReference?: (bytes: Uint8Array) => Promise<string>;
  sanitizeImage?: typeof sanitizeGalleryImage;
  reverseGeocode?: (coordinates: ImageCoordinates) => Promise<ImageLocation | undefined>;
  now?: () => Date;
  onMetrics?: (metrics: GalleryUploadBatchMetrics) => void;
  failureStatus?: 'queued' | 'failed';
}

async function classifyImageSubjects(repository: GalleryRepository, image: Awaited<ReturnType<typeof processImages>>[number]) {
  const matches = await repository.listIdentityMatches(image.scopeKey, image.embedding);
  for (const match of matches) await repository.persistIdentityMatches(image.scopeKey, match.identityKey, [{ imageKey: image.key, confidence: match.confidence }]);
}

export async function processGalleryUploadBatch(uploadKeys: readonly string[], dependencies: GalleryUploadProcessingDependencies = {}) {
  if (uploadKeys.length === 0 || uploadKeys.length > 20) throw new Error('Gallery upload batches must contain between 1 and 20 uploads.');
  const repository = dependencies.repository ?? getDefaultGalleryRepository();
  const storage = dependencies.storage ?? documentStorage;
  const processBatch = dependencies.processBatch ?? processImages;
  const resolveImageReference = dependencies.resolveImageReference ?? (async (bytes: Uint8Array) => imageAnalysisDataUrl(bytes, 768));
  const sanitizeImage = dependencies.sanitizeImage ?? sanitizeGalleryImage;
  const reverseGeocode = dependencies.reverseGeocode ?? reverseGeocodeImage;
  const failureStatus = dependencies.failureStatus ?? 'failed';
  const now = dependencies.now ?? (() => new Date());
  const startedAt = performance.now();
  const records = await Promise.all(uploadKeys.map((key) => repository.getUpload(key)));
  if (records.some((upload) => !upload)) throw new Error('A queued Gallery upload could not be found.');
  const uploads = records.map((upload) => galleryUploadSchema.parse(upload)).filter(({ status }) => status !== 'completed');
  if (uploads.length === 0) return { processed: 0 };

  let processingMetrics: ImageProcessingMetrics | undefined;
  const stagedKeys: string[] = [];
  try {
    const processingAt = now().toISOString();
    await Promise.all(uploads.map((upload) => repository.updateUpload(upload.key, { status: 'processing', errorCode: null, updatedAt: processingAt })));
    const downloadStartedAt = performance.now();
    const prepared = await Promise.allSettled(uploads.map(async (upload) => {
      const object = await storage.download(upload.storageKey);
      if (object.bytes.byteLength !== upload.sizeBytes) throw new Error(`Uploaded image size changed for ${upload.key}.`);
      const sanitized = await sanitizeImage(object.bytes);
      const stagingKey = `${upload.storageKey}.sanitized.jpg`;
      await storage.upload({ key: stagingKey, bytes: sanitized.bytes, mimeType: 'image/jpeg' });
      stagedKeys.push(stagingKey);
      let location = upload.city || upload.country || upload.countryCode ? { ...(upload.city ? { city: upload.city } : {}), ...(upload.country ? { country: upload.country } : {}), ...(upload.countryCode ? { countryCode: upload.countryCode } : {}) } : undefined;
      if (sanitized.coordinates) location = await reverseGeocode(sanitized.coordinates);
      if (sanitized.coordinates) await repository.updateUpload(upload.key, { city: location?.city ?? null, country: location?.country ?? null, countryCode: location?.countryCode ?? null, updatedAt: now().toISOString() });
      return { bytes: sanitized.bytes, stagingKey, location };
    }));
    const preparationFailure = prepared.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (preparationFailure) throw preparationFailure.reason;
    const stored = prepared.map((result) => (result as PromiseFulfilledResult<{ bytes: Uint8Array; stagingKey: string; location?: ImageLocation }>).value);
    const downloadDurationMs = performance.now() - downloadStartedAt;
    const captionableBytes = new Set(uploads.flatMap((upload, index) => upload.processingMode === 'library' ? [stored[index]!.bytes] : []));
    const organizationKey = uploads[0]!.organizationKey;
    if (uploads.some((upload) => upload.organizationKey !== organizationKey)) throw new Error('Gallery upload batches must belong to one organization.');
    const captionBatch = dependencies.captionBatch ?? (async (organization, imageUrls) => (await imageCaptionTool.execute({ imageUrls }, { organizationKey: organization })).results);
    const images = await processBatch(uploads.map((upload, index) => ({
      scopeKey: upload.scopeKey,
      ownerKey: upload.actorKey,
      imageKey: upload.imageKey,
      file: { filename: upload.filename, mimeType: upload.mimeType, sizeBytes: stored[index]!.bytes.byteLength, bytes: stored[index]!.bytes },
      ...(stored[index]!.location ? { location: stored[index]!.location } : {}),
    })), {
      storage,
      hashBatch: computePerceptualHashBatch,
      captionBatch: async (values) => {
        const results: Array<GeneratedImageCaption | undefined> = Array(values.length);
        const libraryIndices = values.map((value, index) => captionableBytes.has(value.bytes) ? index : -1).filter((index) => index >= 0);
        if (libraryIndices.length > 0) {
          const generated = await captionBatch(organizationKey, await Promise.all(libraryIndices.map((index) => resolveImageReference(values[index]!.bytes))));
          if (generated.length !== libraryIndices.length) throw new Error('Gallery caption count did not match the unmatched image count.');
          libraryIndices.forEach((index, position) => { results[index] = generated[position]; });
        }
        values.forEach((_, index) => { results[index] ??= { caption: 'Folder cover image.', score: 1 }; });
        return results as GeneratedImageCaption[];
      },
      embed: async (text, signal) => text.endsWith('\n\nFolder cover image.') ? Array(EMBEDDING_DIMENSIONS).fill(0) : embedText({ text, signal }),
      onMetrics(metrics) { processingMetrics = metrics; },
    });
    const persistStartedAt = performance.now();
    const finalized = await Promise.allSettled(images.map(async (image, index) => {
      const upload = uploads[index]!;
      await classifyImageSubjects(repository, image).catch(() => undefined);
      if (upload.collectionKey) await repository.addImageToCollection(collectionImageSchema.parse({ key: newId(), scopeKey: upload.scopeKey, collectionKey: upload.collectionKey, imageKey: image.key, addedByKey: upload.actorKey, createdAt: now().toISOString() }));
      await repository.updateUpload(upload.key, { status: 'completed', errorCode: null, updatedAt: now().toISOString() });
      await Promise.all([storage.delete(upload.storageKey), storage.delete(stored[index]!.stagingKey)].map((cleanup) => cleanup.catch(() => undefined)));
    }));
    const finalizationErrors = finalized.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(({ reason }) => reason);
    if (finalizationErrors.length > 0) throw new AggregateError(finalizationErrors, 'Gallery upload batch finalization failed.');
    const persistDurationMs = performance.now() - persistStartedAt;
    if (processingMetrics) {
      const metrics = { ...processingMetrics, downloadDurationMs, persistDurationMs, durationMs: performance.now() - startedAt };
      console.info('gallery upload batch processed', { uploadCount: uploads.length, ...metrics });
      dependencies.onMetrics?.(metrics);
    }
    return { processed: uploads.length };
  } catch (error) {
    const errorCode = error instanceof ImageProcessingError ? error.code : 'IMAGE_PROCESSING_FAILED';
    console.error('gallery upload batch processing failed', { uploadKeys, errorCode, durationMs: Math.round(performance.now() - startedAt), error });
    const terminalCleanupKeys = (await Promise.all(uploads.map(async (upload) => {
      const current = await repository.getUpload(upload.key).catch(() => null);
      if (current?.status === 'completed') return [];
      if (failureStatus === 'failed') {
        const failed = await repository.failUpload(upload.key, upload.scopeKey, errorCode, now().toISOString());
        return failed ? [upload.storageKey] : [];
      }
      await repository.updateUpload(upload.key, { status: failureStatus, errorCode, updatedAt: now().toISOString() });
      return [];
    }).map((update) => update.catch(() => [])))).flat();
    await Promise.all(stagedKeys.map((key) => storage.delete(key).catch(() => undefined)));
    await Promise.all(terminalCleanupKeys.map((key) => storage.delete(key).catch(() => undefined)));
    throw error;
  }
}
