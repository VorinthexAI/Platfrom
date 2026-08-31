import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { galleryUploadSchema, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { imageSchema as persistedImageSchema } from '@/lib/db/images.node';
import { processImages } from '@/lib/ai/image-processing';
import { perceptualHashDistance, PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';
import { newId } from '@/lib/ids';
import type { GalleryRepository } from './repository';
import { processGalleryUploadBatch as executeGalleryUploadBatch, type GalleryUploadProcessingDependencies } from './upload-processing';
import { sanitizeGalleryImage } from './image-location';
import { imageDataUrl } from './image-reference';

const now = '2026-08-17T12:00:00.000Z';
const keys = ['cmrnlzf650002qc7k4p5zem5w', 'cmrnlzf650002qc7k4p5zem5x', 'cmrnlzf650002qc7k4p5zem5y'];
const imageSchema = { parse: (value: unknown) => persistedImageSchema.parse({ origin: 'uploaded', ...(value as object) }) };
const passthroughSanitizer: typeof sanitizeGalleryImage = async (bytes) => ({ bytes: new Uint8Array(bytes), coordinates: undefined });
const processGalleryUploadBatch = (uploadKeys: readonly string[], dependencies: GalleryUploadProcessingDependencies) => executeGalleryUploadBatch(uploadKeys, {
  publishCollectionEvent: async () => undefined,
  publishUserEvent: async () => undefined,
  ...dependencies,
});

function upload(index: number): GalleryUpload {
  return galleryUploadSchema.parse({
    key: keys[index], organizationKey: 'organization', scopeKey: 'cmrnlzf640001qc7kazsr96k5', actorKey: 'cmrnlzf640001qc7kazsr96k6', imageKey: `cmrnlzf650002qc7k4p5zema${index}`,
    collectionKey: 'cmrnlzf650002qc7k4p5zemb0', filename: `image-${index}.jpg`, mimeType: 'image/jpeg', sizeBytes: 4, storageKey: `pending/${index}.jpg`, processingMode: 'library', status: 'queued', errorCode: null,
    createdAt: now, updatedAt: now, expiresAt: '2026-08-17T12:15:00.000Z',
  });
}

function fixture() {
  const uploads = new Map(keys.map((key, index) => [key, upload(index)]));
  const updates: Array<{ key: string; status?: string }> = [];
  const relations: string[] = [];
  const deleted: string[] = [];
  const compensated: string[] = [];
  const repository = {
    async getUpload(key: string) { return uploads.get(key) ?? null; },
    async updateUpload(key: string, patch: Partial<GalleryUpload>) { const updated = galleryUploadSchema.parse({ ...uploads.get(key)!, ...patch }); uploads.set(key, updated); updates.push({ key, status: patch.status }); return updated; },
    async claimUploads(uploadKeys: string[], leaseId: string, updatedAt: string) { return Promise.all(uploadKeys.filter((key) => uploads.get(key)?.status === 'queued').map((key) => repository.updateUpload(key, { status: 'processing', processingLeaseId: leaseId, errorCode: null, updatedAt }))); },
    async renewUploadLease(uploadKeys: string[], leaseId: string, updatedAt: string) { const owned = uploadKeys.filter((key) => uploads.get(key)?.status === 'processing' && uploads.get(key)?.processingLeaseId === leaseId); await Promise.all(owned.map((key) => repository.updateUpload(key, { updatedAt }))); return owned.length; },
    async addImageToCollection(relation: { imageKey: string }) { relations.push(relation.imageKey); return relation; },
    async listIdentityMatches() { return []; },
    async persistIdentityMatches() { return false; },
    async getUserKeyByMemberKey() { return 'user-1'; },
    async listScopeManagerUserKeys() { return ['manager-1']; },
    async canFinalizeUpload() { return true; },
    async finalizeUpload(value: GalleryUpload, relation: { imageKey: string } | null, leaseId: string, updatedAt: string) { if (uploads.get(value.key)?.processingLeaseId !== leaseId) return { status: 'unchanged' as const }; if (relation) relations.push(relation.imageKey); await repository.updateUpload(value.key, { status: 'completed', processingLeaseId: null, errorCode: null, updatedAt }); return { status: 'completed' as const }; },
    async compensateUpload(key: string, _scopeKey: string, leaseId: string, errorCode: string, status: 'queued' | 'failed', updatedAt: string) { if (uploads.get(key)?.status !== 'processing' || uploads.get(key)?.processingLeaseId !== leaseId) return null; const imageKey = uploads.get(key)!.imageKey; compensated.push(imageKey); await repository.updateUpload(key, { status, processingLeaseId: null, errorCode, updatedAt }); return { collectionKeys: [], subjectChanged: false, imageChanged: true, storageKeys: [`media/${imageKey}`] }; },
  } as unknown as GalleryRepository;
  const storage = {
    async upload({ key }: { key: string }) { return { storageKey: key }; },
    async download(key: string) { return { bytes: new Uint8Array([255, 216, Number(key.at(-5)), 217]) }; },
    async delete(key: string) { deleted.push(key); },
    async copy({ destinationKey }: { destinationKey: string }) { return { storageKey: destinationKey }; },
  };
  return { uploads, updates, relations, deleted, compensated, repository, storage };
}

describe('Gallery upload batch processing', () => {
  test('downloads one batch, captions unmatched images together, persists, and reports timing', async () => {
    const f = fixture();
    const captionRequests: string[][] = [];
    let sanitized = 0;
    let measured = 0;
    const collectionEvents: string[] = [], userEvents: string[] = [];
    const result = await processGalleryUploadBatch(keys, {
      repository: f.repository,
      storage: f.storage,
      resolveImageReference: async (bytes) => imageDataUrl(bytes, 'image/png'),
      sanitizeImage: async (bytes) => ({ bytes: new Uint8Array(bytes), coordinates: sanitized++ === 0 ? { latitude: 59.3293, longitude: 18.0686 } : undefined }),
      reverseGeocode: async (coordinates) => { expect(coordinates).toEqual({ latitude: 59.3293, longitude: 18.0686 }); return { city: 'Stockholm', country: 'Sweden', countryCode: 'SE' }; },
      captionBatch: async (_organizationKey, urls) => { captionRequests.push(urls); return urls.map((_, index) => ({ caption: `Caption ${index + 1}`, score: 90 - index })); },
      processBatch: async (inputs, dependencies) => {
        expect(inputs.every(({ origin }) => origin === 'uploaded')).toBe(true);
        expect(inputs[0]?.location).toEqual({ city: 'Stockholm', country: 'Sweden', countryCode: 'SE' });
        const generated = await dependencies!.captionBatch!([inputs[0]!.file as any, inputs[2]!.file as any]);
        expect(generated.map(({ score }) => score)).toEqual([90, 89]);
        dependencies!.onMetrics?.({ count: 3, generated: 2, reused: 1, hashDurationMs: 4, captionDurationMs: 8, durationMs: 15 });
        return inputs.map((input, index) => imageSchema.parse({
          key: input.imageKey, scopeKey: input.scopeKey, filename: (input.file as any).filename, caption: index === 1 ? generated[0]!.caption : generated[index === 0 ? 0 : 1]!.caption,
          imageCaptionKey: index === 1 ? 'cmrnlzf650002qc7k4p5zemc0' : `cmrnlzf650002qc7k4p5zemc${index}`, storageKey: `media/${index}.jpg`, mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10,
          embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), isFavorite: false, createdAt: now, updatedAt: now,
        }));
      },
      onMetrics(metrics) { measured = metrics.durationMs; expect(metrics).toMatchObject({ count: 3, generated: 2, reused: 1, downloadDurationMs: expect.any(Number), persistDurationMs: expect.any(Number) }); },
      publishCollectionEvent: async (collectionKey) => { collectionEvents.push(collectionKey); },
      publishUserEvent: async (userKey) => { userEvents.push(userKey); },
    });
    expect(result).toEqual({ processed: 3 });
    expect(captionRequests).toHaveLength(1);
    expect(captionRequests[0]).toHaveLength(2);
    expect(captionRequests[0]?.every((reference) => reference.startsWith('data:image/png;base64,'))).toBe(true);
    expect(f.updates.filter(({ status }) => status === 'processing')).toHaveLength(3);
    expect(f.updates.filter(({ status }) => status === 'completed')).toHaveLength(3);
    expect(f.uploads.get(keys[0]!)!).toMatchObject({ city: 'Stockholm', country: 'Sweden', countryCode: 'SE' });
    expect(f.relations).toHaveLength(3);
    expect(collectionEvents).toEqual(Array(3).fill(upload(0).collectionKey));
    expect(userEvents).toEqual(Array(2).fill('user-1'));
    expect(f.deleted).toHaveLength(6);
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThan(1_000);
  });

  test('publishes only after completion and ignores publisher failures', async () => {
    const f = fixture();
    const publications: string[] = [];
    const result = await processGalleryUploadBatch([keys[0]!], {
      repository: f.repository, storage: f.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async ([input]) => [imageSchema.parse({ key: input!.imageKey, scopeKey: input!.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: 'cmrnlzf650002qc7k4p5zemc0', createdByKey: input!.ownerKey, storageKey: 'media/image.jpg', mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })],
      publishCollectionEvent: async () => { publications.push(f.uploads.get(keys[0]!)!.status); throw new Error('redis unavailable'); },
      publishUserEvent: async () => { publications.push(f.uploads.get(keys[0]!)!.status); },
    });
    expect(result).toEqual({ processed: 1 });
    expect(publications).toEqual(['processing', ...Array(4).fill('completed')]);
  });

  test('marks the whole retryable batch failed when processing fails', async () => {
    const f = fixture();
    const publications: string[] = [];
    await expect(processGalleryUploadBatch(keys, { repository: f.repository, storage: f.storage, resolveImageReference: async () => 'https://images.example/image.jpg', sanitizeImage: passthroughSanitizer, processBatch: async () => { throw new Error('temporary model failure'); }, publishCollectionEvent: async () => { publications.push('collection'); }, publishUserEvent: async () => { publications.push('user'); } })).rejects.toThrow('temporary model failure');
    expect(f.updates.filter(({ status }) => status === 'failed')).toHaveLength(3);
    expect(f.compensated).toHaveLength(3);
    expect(publications).toEqual(['user', 'user', 'user']);
  });

  test('keeps completed siblings replayable when one upload fails finalization', async () => {
    const f = fixture();
    const imageKeys = keys.map((_, index) => upload(index).imageKey);
    const scopeKey = upload(0).scopeKey;
    const captionKeys = ['cmrnlzf650002qc7k4p5zemd0', 'cmrnlzf650002qc7k4p5zemd1', 'cmrnlzf650002qc7k4p5zemd2'];
    const finalize = f.repository.finalizeUpload.bind(f.repository);
    f.repository.finalizeUpload = async (value, relation, leaseId, updatedAt, failureStatus, errorCode) => {
      if (relation?.imageKey !== imageKeys[1]) return finalize(value, relation, leaseId, updatedAt, failureStatus, errorCode);
      const effects = await f.repository.compensateUpload(value.key, value.scopeKey, leaseId, errorCode, failureStatus, updatedAt);
      return effects ? { status: 'compensated', effects } : { status: 'unchanged' };
    };
    await expect(processGalleryUploadBatch(keys, {
      repository: f.repository, storage: f.storage, resolveImageReference: async () => 'https://images.example/image.jpg', sanitizeImage: passthroughSanitizer,
      processBatch: async () => imageKeys.map((key, index) => imageSchema.parse({ key, scopeKey, filename: `${index}.jpg`, caption: 'caption', imageCaptionKey: captionKeys[index], storageKey: `media/${index}`, mimeType: 'image/jpeg', sizeBytes: 4, width: 1, height: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })),
    })).rejects.toThrow('Gallery upload batch finalization failed');
    expect((await f.repository.getUpload(keys[0]))?.status).toBe('completed');
    expect((await f.repository.getUpload(keys[1]))?.status).toBe('failed');
    expect((await f.repository.getUpload(keys[2]))?.status).toBe('completed');
    expect(f.compensated).toEqual([imageKeys[1]]);
    expect([...new Set(f.deleted)].sort()).toEqual([`media/${imageKeys[1]}`, 'pending/0.jpg', 'pending/0.jpg.sanitized.png', 'pending/1.jpg', 'pending/1.jpg.sanitized.png', 'pending/2.jpg', 'pending/2.jpg.sanitized.png']);
  });

  test('duplicate workers no-op when the queued batch claim is already held', async () => {
    const f = fixture();
    f.repository.claimUploads = async () => [];
    let processed = false, published = false;
    await expect(processGalleryUploadBatch([keys[0]!], { repository: f.repository, storage: f.storage, processBatch: async () => { processed = true; return []; }, publishUserEvent: async () => { published = true; } })).resolves.toEqual({ processed: 0 });
    expect(processed).toBe(false);
    expect(published).toBe(false);
    expect(f.uploads.get(keys[0]!)?.status).toBe('queued');
  });

  test('renews processing ownership before persistence and finalization', async () => {
    const active = fixture();
    const renew = active.repository.renewUploadLease.bind(active.repository);
    let renewals = 0;
    active.repository.renewUploadLease = async (...args) => { renewals += 1; return renew(...args); };
    await processGalleryUploadBatch([keys[0]!], {
      repository: active.repository, storage: active.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async ([input]) => [imageSchema.parse({ key: input!.imageKey, scopeKey: input!.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: keys[2], createdByKey: input!.ownerKey, storageKey: 'media/image.jpg', mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })],
    });
    expect(renewals).toBe(2);
    expect(active.uploads.get(keys[0]!)?.status).toBe('completed');
  });

  test('fences a worker after processing ownership changes', async () => {
    const fenced = fixture();
    let finalized = false;
    const finalize = fenced.repository.finalizeUpload.bind(fenced.repository);
    fenced.repository.finalizeUpload = async (...args) => { finalized = true; return finalize(...args); };
    await expect(processGalleryUploadBatch([keys[0]!], {
      repository: fenced.repository, storage: fenced.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async ([input]) => { await fenced.repository.updateUpload(keys[0]!, { processingLeaseId: newId() }); return [imageSchema.parse({ key: input!.imageKey, scopeKey: input!.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: keys[2], createdByKey: input!.ownerKey, storageKey: 'media/image.jpg', mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })]; },
    })).rejects.toThrow('processing lease was lost');
    expect(finalized).toBe(false);
    expect(fenced.uploads.get(keys[0]!)?.status).toBe('processing');
  });

  test('processes only queued siblings while preserving completed and active-processing siblings', async () => {
    const f = fixture();
    f.uploads.set(keys[0]!, galleryUploadSchema.parse({ ...f.uploads.get(keys[0]!)!, status: 'completed' }));
    f.uploads.set(keys[1]!, galleryUploadSchema.parse({ ...f.uploads.get(keys[1]!)!, status: 'processing' }));
    const processedKeys: string[] = [];
    const result = await processGalleryUploadBatch(keys, {
      repository: f.repository, storage: f.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async (inputs) => inputs.map((input) => { processedKeys.push(input.imageKey!); return imageSchema.parse({ key: input.imageKey!, scopeKey: input.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: keys[2], createdByKey: input.ownerKey, storageKey: `media/${input.imageKey}`, mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now }); }),
    });
    expect(result).toEqual({ processed: 1 });
    expect(processedKeys).toEqual([upload(2).imageKey]);
    expect(f.uploads.get(keys[0]!)?.status).toBe('completed');
    expect(f.uploads.get(keys[1]!)?.status).toBe('processing');
    expect(f.uploads.get(keys[2]!)?.status).toBe('completed');
  });

  test.each([true, false])('compensates persisted %s collection retry artifacts before atomically requeueing', async (filed) => {
    const f = fixture();
    if (!filed) f.uploads.set(keys[0]!, galleryUploadSchema.parse({ ...f.uploads.get(keys[0]!)!, collectionKey: null }));
    f.repository.finalizeUpload = async (value, relation, leaseId, updatedAt, failureStatus, errorCode) => {
      if (relation) f.relations.push(relation.imageKey);
      const effects = await f.repository.compensateUpload(value.key, value.scopeKey, leaseId, errorCode, failureStatus, updatedAt);
      if (relation) f.relations.splice(f.relations.indexOf(relation.imageKey), 1);
      return effects ? { status: 'compensated', effects: { ...effects, collectionKeys: filed ? [value.collectionKey!] : [] } } : { status: 'unchanged' };
    };
    await expect(processGalleryUploadBatch([keys[0]!], {
      repository: f.repository, storage: f.storage, failureStatus: 'queued', resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async ([input]) => [imageSchema.parse({ key: input!.imageKey, scopeKey: input!.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: keys[2], createdByKey: input!.ownerKey, storageKey: `media/${input!.imageKey}`, mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })],
    })).rejects.toThrow('finalization failed');
    expect(f.uploads.get(keys[0]!)?.status).toBe('queued');
    expect(f.relations).toEqual([]);
    expect(f.deleted).toContain(`media/${upload(0).imageKey}`);
    expect(f.deleted).not.toContain(upload(0).storageKey);
  });

  test('stops a collectionless upload before image persistence when manager access is revoked', async () => {
    const f = fixture();
    f.uploads.set(keys[0]!, galleryUploadSchema.parse({ ...f.uploads.get(keys[0]!)!, collectionKey: null }));
    f.repository.canFinalizeUpload = async () => false;
    const compensate = f.repository.compensateUpload.bind(f.repository);
    f.repository.compensateUpload = async (...args: Parameters<GalleryRepository['compensateUpload']>) => ({ ...(await compensate(...args))!, imageChanged: false, storageKeys: [] });
    let processingCalls = 0;
    const events: string[] = [];
    await expect(processGalleryUploadBatch([keys[0]!], {
      repository: f.repository, storage: f.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async () => { processingCalls += 1; return []; },
      publishUserEvent: async (_userKey, event) => { events.push(event); },
    })).rejects.toThrow('access was revoked before processing');
    expect(processingCalls).toBe(0);
    expect(f.relations).toEqual([]);
    expect(f.compensated).toEqual([upload(0).imageKey]);
    expect(f.uploads.get(keys[0]!)?.status).toBe('failed');
    expect(events).toEqual(['upload.changed', 'upload.changed']);
  });

  test('compensates a persisted image without classifying or attaching it when collection access races finalization', async () => {
    const f = fixture();
    f.repository.finalizeUpload = async (value, _relation, leaseId, updatedAt, failureStatus, errorCode) => {
      const effects = await f.repository.compensateUpload(value.key, value.scopeKey, leaseId, errorCode, failureStatus, updatedAt);
      return effects ? { status: 'compensated', effects } : { status: 'unchanged' };
    };
    let classifications = 0;
    f.repository.listIdentityMatches = async () => { classifications += 1; return [{ identityKey: keys[2]!, confidence: 0.9 }]; };
    await expect(processGalleryUploadBatch([keys[0]!], {
      repository: f.repository, storage: f.storage, resolveImageReference: async () => 'data:image/jpeg;base64,/9j/2Q==', sanitizeImage: passthroughSanitizer,
      processBatch: async ([input]) => [imageSchema.parse({ key: input!.imageKey, scopeKey: input!.scopeKey, filename: 'image.jpg', caption: 'Caption.', imageCaptionKey: keys[2], createdByKey: input!.ownerKey, storageKey: 'media/image.jpg', mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, createdAt: now, updatedAt: now })],
    })).rejects.toThrow('finalization failed');
    expect(classifications).toBe(0);
    expect(f.relations).toEqual([]);
    expect(f.compensated).toEqual([upload(0).imageKey]);
    expect(f.uploads.get(keys[0]!)?.status).toBe('failed');
  });

  test('processes exact, near, and distinct S3 uploads with canonical scored-caption reuse', async () => {
    const width = 64, height = 64;
    const pixels = Buffer.alloc(width * height * 3), differentPixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      pixels.fill((x * 3 + y * 2 + (x > y ? 45 : 0)) % 256, offset, offset + 3);
      differentPixels.fill((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 240 : 15, offset, offset + 3);
    }
    const exact = new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer());
    const near = new Uint8Array(await sharp(exact).modulate({ brightness: 1.02 }).jpeg({ quality: 88 }).toBuffer());
    const different = new Uint8Array(await sharp(differentPixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer());
    const bytes = [exact, near, different];
    const uploads = new Map(keys.map((key, index) => [key, galleryUploadSchema.parse({ ...upload(index), sizeBytes: bytes[index]!.byteLength })]));
    const objects = new Map<string, Uint8Array<ArrayBufferLike>>(bytes.map((value, index) => [`pending/${index}.jpg`, value]));
    const captions: any[] = [], images: any[] = [];
    const repository = {
      async getUpload(key: string) { return uploads.get(key) ?? null; },
      async updateUpload(key: string, patch: Partial<GalleryUpload>) { const updated = galleryUploadSchema.parse({ ...uploads.get(key)!, ...patch }); uploads.set(key, updated); return updated; },
      async claimUploads(uploadKeys: string[], leaseId: string, updatedAt: string) { return Promise.all(uploadKeys.filter((key) => uploads.get(key)?.status === 'queued').map((key) => repository.updateUpload(key, { status: 'processing', processingLeaseId: leaseId, updatedAt }))); },
      async renewUploadLease(uploadKeys: string[], leaseId: string, updatedAt: string) { const owned = uploadKeys.filter((key) => uploads.get(key)?.status === 'processing' && uploads.get(key)?.processingLeaseId === leaseId); for (const key of owned) await repository.updateUpload(key, { updatedAt }); return owned.length; },
      async addImageToCollection(relation: unknown) { return relation; },
      async listIdentityMatches() { return []; }, async persistIdentityMatches() { return false; },
      async getUserKeyByMemberKey() { return 'user-1'; }, async listScopeManagerUserKeys() { return []; }, async canFinalizeUpload() { return true; },
      async finalizeUpload(value: GalleryUpload, _relation: unknown, _leaseId: string, updatedAt: string) { const updated = galleryUploadSchema.parse({ ...uploads.get(value.key)!, status: 'completed', processingLeaseId: null, errorCode: null, updatedAt }); uploads.set(value.key, updated); return { status: 'completed' as const }; },
      async compensateUpload() { return null; },
    } as unknown as GalleryRepository;
    const storage = {
      async upload({ key, bytes: value }: { key: string; bytes: Uint8Array }) { objects.set(key, value); return { storageKey: key }; },
      async download(key: string) { return { bytes: objects.get(key)! }; },
      async delete(key: string) { objects.delete(key); },
      async copy({ sourceKey, destinationKey }: { sourceKey: string; destinationKey: string }) { objects.set(destinationKey, objects.get(sourceKey)!); return { storageKey: destinationKey }; },
    };
    let requestedCaptions = 0, resolvedCaptions = 0;
    await processGalleryUploadBatch(keys, {
      repository, storage, resolveImageReference: async () => { resolvedCaptions += 1; return 'https://images.example/image.jpg'; },
      captionBatch: async (_organization, urls) => { requestedCaptions += urls.length; return urls.map((_, index) => ({ caption: `Canonical ${index + 1}`, score: index === 0 ? 96 : 81 })); },
      processBatch: (inputs, dependencies) => processImages(inputs, {
        ...dependencies,
        findCaption: async (_scope, hash) => captions.find((caption) => perceptualHashDistance(caption.perceptualHash, hash) <= PERCEPTUAL_HASH_DUPLICATE_DISTANCE) ?? null,
        embed: async (text) => Array(EMBEDDING_DIMENSIONS).fill(text.includes('Canonical 1') ? 0.1 : 0.2),
        getImage: async (key) => images.find((image) => image.key === key) ?? null,
        persistImage: async ({ image, caption }) => { if (caption) captions.push(caption); images.push(image); return image; },
        createCaptionKey: (() => { const values = ['cmrnlzf650002qc7k4p5zemc0', 'cmrnlzf650002qc7k4p5zemc1']; return () => values.shift()!; })(),
      }),
    });
    expect(requestedCaptions).toBe(2);
    expect(resolvedCaptions).toBe(2);
    expect(captions.map(({ score }) => score)).toEqual([96, 81]);
    expect(images[0].imageCaptionKey).toBe(images[1].imageCaptionKey);
    expect(images[2].imageCaptionKey).not.toBe(images[0].imageCaptionKey);
    for (const image of images) {
      const storedBytes = objects.get(image.storageKey)!;
      expect(image.sizeBytes).toBe(storedBytes.byteLength);
      expect((await sharp(storedBytes).metadata()).exif).toBeUndefined();
    }
    expect([...uploads.values()].every(({ status }) => status === 'completed')).toBe(true);
    expect([...objects.keys()].filter((key) => key.startsWith('pending/'))).toEqual([]);
    expect([...objects.keys()].filter((key) => key.startsWith('media/'))).toHaveLength(3);
  });
});
