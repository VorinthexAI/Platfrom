import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { galleryUploadSchema, type GalleryUpload } from '@/lib/db/gallery-uploads.node';
import { imageSchema } from '@/lib/db/images.node';
import { processImages } from '@/lib/ai/image-processing';
import { perceptualHashDistance, PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';
import type { GalleryRepository } from './repository';
import { processGalleryUploadBatch } from './upload-processing';

const now = '2026-08-17T12:00:00.000Z';
const keys = ['cmrnlzf650002qc7k4p5zem5w', 'cmrnlzf650002qc7k4p5zem5x', 'cmrnlzf650002qc7k4p5zem5y'];

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
  const repository = {
    async getUpload(key: string) { return uploads.get(key) ?? null; },
    async updateUpload(key: string, patch: Partial<GalleryUpload>) { const updated = galleryUploadSchema.parse({ ...uploads.get(key)!, ...patch }); uploads.set(key, updated); updates.push({ key, status: patch.status }); return updated; },
    async addImageToCollection(relation: { imageKey: string }) { relations.push(relation.imageKey); return relation; },
    async listIdentityMatches() { return []; },
    async persistIdentityMatches() {},
  } as unknown as GalleryRepository;
  const storage = {
    async upload({ key }: { key: string }) { return { storageKey: key }; },
    async download(key: string) { return { bytes: new Uint8Array([255, 216, Number(key.at(-5)), 217]) }; },
    async delete(key: string) { deleted.push(key); },
    async copy({ destinationKey }: { destinationKey: string }) { return { storageKey: destinationKey }; },
  };
  return { uploads, updates, relations, deleted, repository, storage };
}

describe('Gallery upload batch processing', () => {
  test('downloads one batch, captions unmatched images together, persists, and reports timing', async () => {
    const f = fixture();
    const captionRequests: string[][] = [];
    let measured = 0;
    const result = await processGalleryUploadBatch(keys, {
      repository: f.repository,
      storage: f.storage,
      signImageUrl: async (key) => `https://images.example/${key}`,
      captionBatch: async (_organizationKey, urls) => { captionRequests.push(urls); return urls.map((_, index) => ({ caption: `Caption ${index + 1}`, score: 90 - index })); },
      processBatch: async (inputs, dependencies) => {
        const generated = await dependencies!.captionBatch!([inputs[0]!.file as any, inputs[2]!.file as any]);
        expect(generated.map(({ score }) => score)).toEqual([90, 89]);
        dependencies!.onMetrics?.({ count: 3, generated: 2, reused: 1, hashDurationMs: 4, captionDurationMs: 8, durationMs: 15 });
        return inputs.map((input, index) => imageSchema.parse({
          key: input.imageKey, scopeKey: input.scopeKey, filename: (input.file as any).filename, caption: index === 1 ? generated[0]!.caption : generated[index === 0 ? 0 : 1]!.caption,
          imageCaptionKey: index === 1 ? 'cmrnlzf650002qc7k4p5zemc0' : `cmrnlzf650002qc7k4p5zemc${index}`, storageKey: `media/${index}.jpg`, mimeType: 'image/jpeg', sizeBytes: 4, width: 10, height: 10,
          embedding: Array(EMBEDDING_DIMENSIONS).fill(0.1), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now,
        }));
      },
      onMetrics(metrics) { measured = metrics.durationMs; expect(metrics).toMatchObject({ count: 3, generated: 2, reused: 1, downloadDurationMs: expect.any(Number), persistDurationMs: expect.any(Number) }); },
    });
    expect(result).toEqual({ processed: 3 });
    expect(captionRequests).toEqual([['https://images.example/pending/0.jpg', 'https://images.example/pending/2.jpg']]);
    expect(f.updates.filter(({ status }) => status === 'processing')).toHaveLength(3);
    expect(f.updates.filter(({ status }) => status === 'completed')).toHaveLength(3);
    expect(f.relations).toHaveLength(3);
    expect(f.deleted).toHaveLength(3);
    expect(measured).toBeGreaterThan(0);
    expect(measured).toBeLessThan(1_000);
  });

  test('marks the whole retryable batch failed when processing fails', async () => {
    const f = fixture();
    await expect(processGalleryUploadBatch(keys, { repository: f.repository, storage: f.storage, signImageUrl: async (key) => `https://images.example/${key}`, processBatch: async () => { throw new Error('temporary model failure'); } })).rejects.toThrow('temporary model failure');
    expect(f.updates.filter(({ status }) => status === 'failed')).toHaveLength(3);
  });

  test('keeps completed siblings replayable when one upload fails finalization', async () => {
    const f = fixture();
    const imageKeys = keys.map((_, index) => upload(index).imageKey);
    const scopeKey = upload(0).scopeKey;
    const captionKeys = ['cmrnlzf650002qc7k4p5zemd0', 'cmrnlzf650002qc7k4p5zemd1', 'cmrnlzf650002qc7k4p5zemd2'];
    f.repository.addImageToCollection = async (relation) => {
      if (relation.imageKey === imageKeys[1]) throw new Error('relation unavailable');
      return relation;
    };
    await expect(processGalleryUploadBatch(keys, {
      repository: f.repository, storage: f.storage, signImageUrl: async (key) => `https://images.example/${key}`,
      processBatch: async () => imageKeys.map((key, index) => imageSchema.parse({ key, scopeKey, filename: `${index}.jpg`, caption: 'caption', imageCaptionKey: captionKeys[index], storageKey: `media/${index}`, mimeType: 'image/jpeg', sizeBytes: 4, width: 1, height: 1, embedding: Array(EMBEDDING_DIMENSIONS).fill(0), isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now })),
    })).rejects.toThrow('Gallery upload batch finalization failed');
    expect((await f.repository.getUpload(keys[0]))?.status).toBe('completed');
    expect((await f.repository.getUpload(keys[1]))?.status).toBe('failed');
    expect((await f.repository.getUpload(keys[2]))?.status).toBe('completed');
    expect(f.deleted.sort()).toEqual(['pending/0.jpg', 'pending/2.jpg']);
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
      async addImageToCollection(relation: unknown) { return relation; },
      async listIdentityMatches() { return []; }, async persistIdentityMatches() {},
    } as unknown as GalleryRepository;
    const storage = {
      async upload({ key, bytes: value }: { key: string; bytes: Uint8Array }) { objects.set(key, value); return { storageKey: key }; },
      async download(key: string) { return { bytes: objects.get(key)! }; },
      async delete(key: string) { objects.delete(key); },
      async copy({ sourceKey, destinationKey }: { sourceKey: string; destinationKey: string }) { objects.set(destinationKey, objects.get(sourceKey)!); return { storageKey: destinationKey }; },
    };
    let requestedCaptions = 0;
    await processGalleryUploadBatch(keys, {
      repository, storage, signImageUrl: async (key) => `https://images.example/${key}`,
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
    expect(captions.map(({ score }) => score)).toEqual([96, 81]);
    expect(images[0].imageCaptionKey).toBe(images[1].imageCaptionKey);
    expect(images[2].imageCaptionKey).not.toBe(images[0].imageCaptionKey);
    expect([...uploads.values()].every(({ status }) => status === 'completed')).toBe(true);
    expect([...objects.keys()].filter((key) => key.startsWith('pending/'))).toEqual([]);
    expect([...objects.keys()].filter((key) => key.startsWith('media/'))).toHaveLength(3);
  });
});
