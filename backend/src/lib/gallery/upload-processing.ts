import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { collectionImageSchema } from '@/lib/db/collection-images.node';
import { galleryUploadSchema } from '@/lib/db/gallery-uploads.node';
import { insertPreparedImageWithCaption, type Image } from '@/lib/db/images.node';
import { ImageProcessingError, processImages, type GeneratedImageCaption, type ImageProcessingMetrics } from '@/lib/ai/image-processing';
import { imageCaptionTool } from '@/lib/ai/tools/image-caption';
import type { ImageCaptionToolDependencies } from '@/lib/ai/tools/image-caption';
import { observeToolExecution, type ToolBillingDependencies } from '@/lib/ai/events/runtime';
import { toolEventService, type ToolEventRecorder } from '@/lib/ai/events/service';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { APP_KEYS } from '@/lib/apps/registry';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { EMBEDDING_DIMENSIONS, embedText } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { computePerceptualHashBatch } from '@/lib/perceptual-hash';
import { getDefaultGalleryRepository, type GalleryRepository } from './repository';
import { imageAnalysisDataUrl } from './image-reference';
import { reverseGeocodeImage, sanitizeGalleryImage, type ImageCoordinates, type ImageLocation } from './image-location';
import { publishCollectionEvent, publishUserEvent } from '@/api/events';
import { mutationEventTargets, publishGalleryEvents, type GalleryMutationEventName } from './mutation-events';

export type GalleryUploadBatchMetrics = ImageProcessingMetrics & {
  downloadDurationMs: number;
  persistDurationMs: number;
};

export interface GalleryUploadProcessingDependencies {
  repository?: GalleryRepository;
  storage?: DocumentObjectStorage;
  processBatch?: typeof processImages;
  captionBatch?: (teamKey: string, imageUrls: string[]) => Promise<GeneratedImageCaption[]>;
  captionExecution?: GalleryCaptionExecutionDependencies;
  resolveImageReference?: (bytes: Uint8Array) => Promise<string>;
  sanitizeImage?: typeof sanitizeGalleryImage;
  reverseGeocode?: (coordinates: ImageCoordinates) => Promise<ImageLocation | undefined>;
  now?: () => Date;
  onMetrics?: (metrics: GalleryUploadBatchMetrics) => void;
  failureStatus?: 'queued' | 'failed';
  leaseRefreshIntervalMs?: number;
  publishCollectionEvent?: typeof publishCollectionEvent;
  publishUserEvent?: typeof publishUserEvent;
}

export interface GalleryCaptionExecutionDependencies extends ImageCaptionToolDependencies {
  appScopeKey?: string;
  billing?: ToolBillingDependencies;
  recordEvent?: ToolEventRecorder;
}

export async function executeGalleryCaptionBatch(input: {
  actorKey: string;
  imageUrls: string[];
  requestKey: string;
  scopeKey: string;
  teamKey: string;
  userKey: string;
}, dependencies: GalleryCaptionExecutionDependencies = {}) {
  const { appScopeKey, billing, recordEvent, ...actionDependencies } = dependencies;
  const context = {
    teamKey: input.teamKey,
    runtimeScopeKey: input.scopeKey,
    principal: {
      kind: 'member' as const,
      user: { key: input.userKey },
      userTeam: { key: input.actorKey, teamKey: input.teamKey, userId: input.userKey, status: 'active' as const },
      scopeMember: null,
    },
  } as unknown as ToolContext;
  return observeToolExecution(imageCaptionTool.name, context, () => imageCaptionTool.execute({ imageUrls: input.imageUrls }, { teamKey: input.teamKey, ...actionDependencies }), {
    appKey: APP_KEYS.GALLERY,
    appScopeKey,
    recorder: recordEvent ?? toolEventService.record,
    idempotencyKey: input.requestKey,
    input: { imageUrls: input.imageUrls },
    ...billing,
  }).then(({ results }) => results);
}

async function classifyImageSubjects(repository: GalleryRepository, image: Awaited<ReturnType<typeof processImages>>[number]) {
  if (!image.createdByKey) return false;
  const matches = await repository.listIdentityMatches(image.scopeKey, image.embedding, image.createdByKey);
  const changes = await Promise.all(matches.map((match) => repository.persistIdentityMatches(image.scopeKey, match.identityKey, [{ imageKey: image.key, confidence: match.confidence }])));
  return changes.some(Boolean);
}

async function publish(dependencies: GalleryUploadProcessingDependencies, operation: GalleryMutationEventName, targets: { collections?: Iterable<string>; users?: Iterable<string> }) {
  await publishGalleryEvents(mutationEventTargets(operation, targets), { collection: dependencies.publishCollectionEvent, user: dependencies.publishUserEvent });
}

export interface GalleryLibraryIngestInput {
  teamKey: string;
  scopeKey: string;
  actorKey: string;
  userKey: string;
  collectionKey: string;
  filename: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  bytes: Uint8Array;
  imageKey?: string;
}

function galleryLibraryFile(input: Pick<GalleryLibraryIngestInput, 'filename' | 'mimeType' | 'bytes'>) {
  const base = input.filename.replace(/\.[^.]+$/, '').slice(0, 251) || 'image';
  if (input.mimeType === 'image/jpeg' || (input.bytes[0] === 0xff && input.bytes[1] === 0xd8)) return { filename: `${base}.jpg`, mimeType: 'image/jpeg' as const };
  return { filename: `${base}.png`, mimeType: 'image/png' as const };
}

export async function ingestGalleryLibraryUploads(inputs: readonly GalleryLibraryIngestInput[], dependencies: GalleryUploadProcessingDependencies = {}): Promise<Image[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > 20) throw new Error('Gallery ingest batches must contain at most 20 uploads.');
  const teamKey = inputs[0]!.teamKey, scopeKey = inputs[0]!.scopeKey, actorKey = inputs[0]!.actorKey, collectionKey = inputs[0]!.collectionKey;
  if (inputs.some((input) => input.teamKey !== teamKey || input.scopeKey !== scopeKey || input.actorKey !== actorKey || input.collectionKey !== collectionKey)) throw new Error('Gallery ingest batches must share one team, scope, actor, and collection.');
  const repository = dependencies.repository ?? getDefaultGalleryRepository();
  const storage = dependencies.storage ?? documentStorage;
  const createdAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const uploads = inputs.map((input) => {
    const key = newId();
    const file = galleryLibraryFile(input);
    return {
      input,
      upload: galleryUploadSchema.parse({
        key, teamKey, scopeKey, actorKey, imageKey: input.imageKey ?? newId(), collectionKey,
        filename: file.filename, mimeType: file.mimeType, sizeBytes: input.bytes.byteLength,
        storageKey: `pending/gallery/${scopeKey}/${key}/original.png`, processingMode: 'library', status: 'queued',
        errorCode: null, createdAt, updatedAt: createdAt, expiresAt: new Date(Date.parse(createdAt) + 15 * 60_000).toISOString(),
      }),
    };
  });
  await Promise.all(uploads.map(({ input, upload }) => storage.upload({ key: upload.storageKey, bytes: input.bytes, mimeType: upload.mimeType, billingUserKey: input.userKey })));
  await repository.insertUploads(uploads.map(({ upload }) => upload));
  await processGalleryUploadBatch(uploads.map(({ upload }) => upload.key), { ...dependencies, repository, storage });
  const images = await Promise.all(uploads.map(({ upload }) => repository.getImage(upload.imageKey)));
  if (images.some((image) => !image)) throw new Error('Gallery ingest did not persist every image.');
  return images as Image[];
}

export async function ingestGalleryLibraryUpload(input: GalleryLibraryIngestInput, dependencies: GalleryUploadProcessingDependencies = {}) {
  const [image] = await ingestGalleryLibraryUploads([input], dependencies);
  return image!;
}

export async function processGalleryUploadBatch(uploadKeys: readonly string[], dependencies: GalleryUploadProcessingDependencies = {}) {
  if (uploadKeys.length === 0 || uploadKeys.length > 20) throw new Error('Gallery upload batches must contain between 1 and 20 uploads.');
  if (new Set(uploadKeys).size !== uploadKeys.length) throw new Error('Gallery upload batch keys must be unique.');
  const repository = dependencies.repository ?? getDefaultGalleryRepository();
  const storage = dependencies.storage ?? documentStorage;
  const processBatch = dependencies.processBatch ?? processImages;
  const resolveImageReference = dependencies.resolveImageReference ?? (async (bytes: Uint8Array) => imageAnalysisDataUrl(bytes, 768));
  const sanitizeImage = dependencies.sanitizeImage ?? sanitizeGalleryImage;
  const reverseGeocode = dependencies.reverseGeocode ?? reverseGeocodeImage;
  const failureStatus = dependencies.failureStatus ?? 'failed';
  const now = dependencies.now ?? (() => new Date());
  const startedAt = performance.now();
  const leaseId = newId();
  const claimed = await repository.claimUploads([...uploadKeys], leaseId, now().toISOString());
  if (claimed.length === 0) return { processed: 0 };
  const uploads = claimed.map((upload) => galleryUploadSchema.parse(upload));
  const claimedKeys = uploads.map(({ key }) => key);
  let leaseRefresh = Promise.resolve();
  const renewLease = () => leaseRefresh = leaseRefresh.catch(() => undefined).then(async () => {
    if (await repository.renewUploadLease(claimedKeys, leaseId, now().toISOString()) !== uploads.length) throw new Error('Gallery upload processing lease was lost.');
  });
  const leaseTimer = setInterval(() => { void renewLease().catch((error) => console.error('gallery upload lease refresh failed', { uploadKeys: claimedKeys, error })); }, dependencies.leaseRefreshIntervalMs ?? 10 * 60_000);
  leaseTimer.unref();
  const stopLease = async () => { clearInterval(leaseTimer); await leaseRefresh.catch(() => undefined); };

  let processingMetrics: ImageProcessingMetrics | undefined;
  const stagedKeys: string[] = [];
  const immediateCompensations = new Map<string, Awaited<ReturnType<GalleryRepository['compensateUpload']>>>();
  try {
    const actorUsers = new Map<string, string>();
    await Promise.all(uploads.map(async (upload) => {
      const userKey = await repository.getUserKeyByMembershipKey(upload.actorKey).catch(() => null);
      if (userKey) actorUsers.set(upload.actorKey, userKey);
    }));
    await publish(dependencies, 'uploadProcessing', { users: uploads.flatMap((upload) => actorUsers.get(upload.actorKey) ?? []) });
    if ((await Promise.all(uploads.map((upload) => repository.canFinalizeUpload(upload)))).some((allowed) => !allowed)) {
      throw new Error('Gallery upload access was revoked before processing.');
    }
    const downloadStartedAt = performance.now();
    const prepared = await Promise.allSettled(uploads.map(async (upload) => {
      const object = await storage.download(upload.storageKey);
      if (object.bytes.byteLength !== upload.sizeBytes) throw new Error(`Uploaded image size changed for ${upload.key}.`);
      const sanitized = await sanitizeImage(object.bytes);
      const stagingKey = `${upload.storageKey}.sanitized.png`;
      const billingUserKey = actorUsers.get(upload.actorKey);
      await storage.upload({ key: stagingKey, bytes: sanitized.bytes, mimeType: 'image/png', ...(billingUserKey ? { billingUserKey } : {}) });
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
    const bytesHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const captionableBytes = new Set(uploads.flatMap((upload, index) => upload.processingMode === 'library' ? [bytesHash(stored[index]!.bytes)] : []));
    const teamKey = uploads[0]!.teamKey;
    if (uploads.some((upload) => upload.teamKey !== teamKey)) throw new Error('Gallery upload batches must belong to one team.');
    const scopeKey = uploads[0]!.scopeKey;
    if (uploads.some((upload) => upload.scopeKey !== scopeKey)) throw new Error('Gallery upload batches must belong to one scope.');
    const actorKey = uploads[0]!.actorKey;
    if (uploads.some((upload) => upload.actorKey !== actorKey)) throw new Error('Gallery upload batches must belong to one actor.');
    const userKey = actorUsers.get(actorKey);
    if (!userKey) throw new Error('Gallery upload actor was not found.');
    const requestKey = `gallery-upload-caption:${createHash('sha256').update([...claimedKeys].sort().join('\0')).digest('hex')}`;
    const captionBatch = dependencies.captionBatch ?? ((team, imageUrls) => executeGalleryCaptionBatch({ actorKey, imageUrls, requestKey, scopeKey, teamKey: team, userKey }, dependencies.captionExecution));
    await renewLease();
    const images = await processBatch(uploads.map((upload, index) => ({
      scopeKey: upload.scopeKey,
      ownerKey: upload.actorKey,
      ...(actorUsers.get(upload.actorKey) ? { billingUserKey: actorUsers.get(upload.actorKey) } : {}),
      origin: 'uploaded' as const,
      imageKey: upload.imageKey,
      file: { filename: `${upload.filename.replace(/\.[^.]+$/, '').slice(0, 251) || 'image'}.png`, mimeType: 'image/png', sizeBytes: stored[index]!.bytes.byteLength, bytes: stored[index]!.bytes },
      ...(stored[index]!.location ? { location: stored[index]!.location } : {}),
    })), {
      storage,
      hashBatch: computePerceptualHashBatch,
      captionBatch: async (values) => {
        const results: Array<GeneratedImageCaption | undefined> = Array(values.length);
        const libraryIndices = values.map((value, index) => captionableBytes.has(bytesHash(value.bytes)) ? index : -1).filter((index) => index >= 0);
        if (libraryIndices.length > 0) {
          const generated = await captionBatch(teamKey, await Promise.all(libraryIndices.map((index) => resolveImageReference(values[index]!.bytes))));
          if (generated.length !== libraryIndices.length) throw new Error('Gallery caption count did not match the unmatched image count.');
          libraryIndices.forEach((index, position) => { results[index] = generated[position]; });
        }
        values.forEach((_, index) => { results[index] ??= { caption: 'Folder cover image.', score: 1 }; });
        return results as GeneratedImageCaption[];
      },
      embed: async (text, signal) => text.endsWith('\n\nFolder cover image.') ? Array(EMBEDDING_DIMENSIONS).fill(0) : embedText({ text, signal }),
      persistImage: async ({ image, caption, actorKey }) => {
        await renewLease();
        return insertPreparedImageWithCaption({ image, ...(caption ? { caption } : {}), actorKey });
      },
      onMetrics(metrics) { processingMetrics = metrics; },
    });
    await renewLease();
    await stopLease();
    const persistStartedAt = performance.now();
    const finalized = await Promise.allSettled(images.map(async (image, index) => {
      const upload = uploads[index]!;
      const relation = upload.collectionKey ? collectionImageSchema.parse({ key: newId(), scopeKey: upload.scopeKey, collectionKey: upload.collectionKey, imageKey: image.key, addedByKey: upload.actorKey, createdAt: now().toISOString() }) : null;
      const finalization = await repository.finalizeUpload(upload, relation, leaseId, now().toISOString(), failureStatus, 'UPLOAD_ACCESS_REVOKED');
      if (finalization.status === 'compensated') {
        immediateCompensations.set(upload.key, finalization.effects);
        await Promise.all(finalization.effects.storageKeys.map((key) => storage.delete(key).catch(() => undefined)));
      }
      if (finalization.status !== 'completed') throw new Error('Gallery upload access was revoked before finalization.');
      const subjectChanged = await classifyImageSubjects(repository, image).catch(() => false);
      await Promise.all([storage.delete(upload.storageKey), storage.delete(stored[index]!.stagingKey)].map((cleanup) => cleanup.catch(() => undefined)));
      return { upload, subjectChanged };
    }));
    const completed = finalized.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    await publish(dependencies, 'uploadCompleted', {
      collections: completed.flatMap(({ upload }) => upload.collectionKey ? [upload.collectionKey] : []),
      users: completed.flatMap(({ upload }) => actorUsers.get(upload.actorKey) ?? []),
    });
    await publish(dependencies, 'unfiledImageChanged', { users: completed.flatMap(({ upload }) => upload.collectionKey ? [] : actorUsers.get(upload.actorKey) ?? []) });
    const subjectScopes = new Set(completed.filter(({ subjectChanged }) => subjectChanged).map(({ upload }) => upload.scopeKey));
    const subjectUsers = (await Promise.all([...subjectScopes].map((scopeKey) => repository.listScopeManagerUserKeys(scopeKey).catch(() => [])))).flat();
    await publish(dependencies, 'reconcileSubject', { users: subjectUsers });
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
    await stopLease();
    const errorCode = error instanceof ImageProcessingError ? error.code : 'IMAGE_PROCESSING_FAILED';
    console.error('gallery upload batch processing failed', { uploadKeys, errorCode, durationMs: Math.round(performance.now() - startedAt), error });
    const failedTransitions = await Promise.all(uploads.map(async (upload) => {
      const immediate = immediateCompensations.get(upload.key);
      const compensation = immediate ?? await repository.compensateUpload(upload.key, upload.scopeKey, leaseId, errorCode, failureStatus, now().toISOString());
      return { cleanup: compensation && failureStatus === 'failed' ? [upload.storageKey] : [], upload, compensation, changed: compensation !== null };
    }).map((update, index) => update.catch(() => ({ cleanup: [] as string[], upload: uploads[index]!, compensation: null, changed: false }))));
    const failedUsers = (await Promise.all(failedTransitions.filter(({ changed }) => changed).map(({ upload }) => repository.getUserKeyByMembershipKey(upload.actorKey).catch(() => null)))).filter((key): key is string => Boolean(key));
    await publish(dependencies, 'uploadFailed', { users: failedUsers });
    const compensatedCollections = failedTransitions.flatMap(({ compensation }) => compensation?.collectionKeys ?? []);
    const unfiledCompensatedUsers = (await Promise.all(failedTransitions.filter(({ compensation }) => compensation?.imageChanged && compensation.collectionKeys.length === 0).map(({ upload }) => repository.getUserKeyByMembershipKey(upload.actorKey).catch(() => null)))).filter((key): key is string => Boolean(key));
    await publish(dependencies, 'uploadCompensated', { collections: compensatedCollections, users: unfiledCompensatedUsers });
    const compensatedScopes = new Set(failedTransitions.filter(({ compensation }) => compensation?.subjectChanged).map(({ upload }) => upload.scopeKey));
    const compensatedSubjectUsers = (await Promise.all([...compensatedScopes].map((scopeKey) => repository.listScopeManagerUserKeys(scopeKey).catch(() => [])))).flat();
    await publish(dependencies, 'reconcileSubject', { users: compensatedSubjectUsers });
    const terminalCleanupKeys = failedTransitions.flatMap(({ cleanup }) => cleanup);
    await Promise.all(stagedKeys.map((key) => storage.delete(key).catch(() => undefined)));
    await Promise.all(failedTransitions.flatMap(({ compensation }) => compensation?.storageKeys ?? []).map((key) => storage.delete(key).catch(() => undefined)));
    await Promise.all(terminalCleanupKeys.map((key) => storage.delete(key).catch(() => undefined)));
    throw error;
  }
}
