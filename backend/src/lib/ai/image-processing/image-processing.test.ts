import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { perceptualHashDistance, PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';
import { ImageProcessingError, processImage, processImages, type ImageProcessingMetrics } from './index';

function png(width = 2, height = 3) { const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
function input(bytes = png()) { return { scopeKey: 'c123456789', ownerKey: 'c987654321', file: { filename: 'photo.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes } }; }
describe('MediaLibrary image processing', () => {
  test('stores captions with current Qwen vectors', async () => {
    let stored: Record<string, unknown> | undefined;
    const result = await processImage(input(), {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} }, hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null, caption: async () => ({ caption: 'A blue square.', score: 84 }), embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.25), getImage: async () => null,
      persistImage: async ({ image, caption }) => { stored = { image, caption }; return image; }, createKey: () => 'cmrnlzf650002qc7k4p5zem5w', createCaptionKey: () => 'cmrnlzf650002qc7k4p5zem5x',
    });
    expect(result.embedding).toHaveLength(4096);
    expect(stored).toMatchObject({ image: { width: 2, height: 3, imageCaptionKey: 'cmrnlzf650002qc7k4p5zem5x' }, caption: { perceptualHash: '0123456789abcdef', caption: 'A blue square.', score: 84 } });
    expect(stored?.image).not.toHaveProperty('ownerKey');
    expect(stored?.image).not.toHaveProperty('embeddingProvider');
  });
  test('cleans uploaded data when embedding dimensions are stale', async () => {
    const deleted: string[] = [];
    await expect(processImage(input(), { storage: { async upload({ key }) { return { storageKey: key }; }, async delete(key) { deleted.push(key); } }, hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null, caption: async () => ({ caption: 'Caption', score: 80 }), embed: async () => Array(EMBEDDING_DIMENSIONS - 1).fill(0), getImage: async () => null, persistImage: async ({ image }) => image, createKey: () => 'cmrnlzf650002qc7k4p5zem5w' })).rejects.toBeInstanceOf(ImageProcessingError);
    expect(deleted).toHaveLength(1);
  });
  test('reuses the canonical hash and caption for a perceptual duplicate', async () => {
    const canonical = {
      key: 'cmrnlzf650002qc7k4p5zem5x', scopeKey: 'c123456789', sourceImageKey: 'cmrnlzf650002qc7k4p5zem5y', caption: 'Canonical caption.',
      score: 91,
      scoreVersion: 1,
      embedding: Array(EMBEDDING_DIMENSIONS).fill(0.75),
      perceptualHash: '0123456789abcdee', hashAlgorithm: 'phash-64-dct-v1' as const,
      hashSegment0: '0123', hashSegment1: '4567', hashSegment2: '89ab', hashSegment3: 'cdee',
      createdAt: '2026-08-11T12:00:00.000Z', updatedAt: '2026-08-11T12:00:00.000Z',
    };
    let persisted: any;
    await processImage(input(), {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} },
      hashBatch: async () => ['0123456789abcdef'], findCaption: async () => canonical,
       caption: async () => { throw new Error('caption model must not run'); },
      embed: async () => { throw new Error('embedding model must not run'); },
      getImage: async () => null, persistImage: async (value) => { persisted = value; return value.image; },
      createKey: () => 'cmrnlzf650002qc7k4p5zem5w',
    });
    expect(persisted.caption).toBeUndefined();
    expect(persisted.image).toMatchObject({ caption: 'Canonical caption.', imageCaptionKey: canonical.key });
    expect(persisted.image.embedding[0]).toBe(0.75);
  });
  test('hashes uploads in one batch and captions one representative per duplicate group', async () => {
    let canonical: any;
    let hashCalls = 0;
    let captionCalls = 0;
    const keys = ['cmrnlzf650002qc7k4p5zem5w', 'cmrnlzf650002qc7k4p5zem5x'];
    const results = await processImages([input(), { ...input(), file: { ...input().file, filename: 'copy.png' } }], {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} },
      hashBatch: async (images) => { hashCalls += 1; expect(images).toHaveLength(2); return ['0123456789abcdef', '0123456789abcdee']; },
      findCaption: async () => canonical ?? null,
      captionBatch: async (values) => { captionCalls += 1; expect(values).toHaveLength(1); return [{ caption: 'One canonical caption.', score: 88 }]; },
      embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1),
      getImage: async () => null,
      persistImage: async ({ image, caption }) => { if (caption) canonical = caption; return image; },
      createKey: () => keys.shift()!,
      createCaptionKey: () => 'cmrnlzf650002qc7k4p5zema0',
    });
    expect(hashCalls).toBe(1);
    expect(captionCalls).toBe(1);
    expect(results.map(({ imageCaptionKey }) => imageCaptionKey)).toEqual(['cmrnlzf650002qc7k4p5zema0', 'cmrnlzf650002qc7k4p5zema0']);
    expect(results.map(({ caption }) => caption)).toEqual(['One canonical caption.', 'One canonical caption.']);
  });
  test('rejects different in-flight payloads and replays persisted results', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let stored: any;
    let hashCalls = 0;
    const dependencies = {
      storage: { async upload({ key }: { key: string }) { return { storageKey: key }; }, async delete() {} },
      hashBatch: async () => { hashCalls += 1; return ['0123456789abcdef']; }, findCaption: async () => null,
      caption: async () => { await gate; return { caption: 'Caption', score: 80 }; }, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1),
      getImage: async () => stored ?? null, persistImage: async ({ image }: any) => stored = image,
    } as Parameters<typeof processImage>[1];
    const first = processImage({ ...input(), idempotencyKey: 'same-key' }, dependencies);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(processImage({ ...input(png(4, 3)), idempotencyKey: 'same-key' }, dependencies)).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    release();
    await first;
    const hashesAfterInsert = hashCalls;
    await expect(processImage({ ...input(), idempotencyKey: 'same-key' }, dependencies)).resolves.toBe(stored);
    expect(hashCalls).toBe(hashesAfterInsert);
    await expect(processImage({ ...input(png(4, 3)), idempotencyKey: 'same-key' }, { ...dependencies, caption: async () => ({ caption: 'Caption', score: 80 }) })).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    expect(stored).not.toHaveProperty('requestHash');
  });
  test('hashes and uploads only pending items in a mixed replay batch', async () => {
    let stored: any;
    const baseDependencies = {
      storage: { async upload({ key }: { key: string }) { return { storageKey: key }; }, async delete() {} },
      hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null,
      caption: async () => ({ caption: 'Caption', score: 80 }), embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1),
      getImage: async () => stored ?? null, persistImage: async ({ image }: any) => stored = image,
      createCaptionKey: () => 'cmrnlzf650002qc7k4p5zem5x',
    } as Parameters<typeof processImage>[1];
    await processImage({ ...input(), idempotencyKey: 'persisted' }, baseDependencies);
    let hashed = 0;
    let uploads = 0;
    const results = await processImages([
      { ...input(), idempotencyKey: 'persisted' },
      { ...input(), file: { ...input().file, filename: 'new.png' } },
    ], {
      ...baseDependencies,
      storage: { async upload({ key }) { uploads += 1; return { storageKey: key }; }, async delete() {} },
      hashBatch: async (images) => { hashed += images.length; return ['0123456789abcdee']; },
      getImage: async (key) => key === stored.key ? stored : null,
      persistImage: async ({ image }) => image,
      createKey: () => 'cmrnlzf650002qc7k4p5zem5z',
    });
    expect(hashed).toBe(1);
    expect(uploads).toBe(1);
    expect(results[0]).toBe(stored);
    expect(results[1]?.filename).toBe('new.png');
  });
  test('rejects invalid batch bounds and hash cardinality before uploading', async () => {
    await expect(processImages([], {})).rejects.toMatchObject({ code: 'IMAGE_INVALID_INPUT' });
    let uploads = 0;
    await expect(processImages([input(), { ...input(), file: { ...input().file, filename: 'two.png' } }], {
      hashBatch: async () => ['0123456789abcdef'],
      getImage: async () => null,
      storage: { async upload({ key }) { uploads += 1; return { storageKey: key }; }, async delete() {} },
    })).rejects.toMatchObject({ code: 'IMAGE_INVALID_INPUT' });
    expect(uploads).toBe(0);
  });

  test('reuses caption and score for exact and near images while captioning a distinct image once', async () => {
    const width = 64, height = 64;
    const pixels = Buffer.alloc(width * height * 3);
    const differentPixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const value = (x * 3 + y * 2 + (x > y ? 45 : 0)) % 256;
      pixels.fill(value, offset, offset + 3);
      differentPixels.fill((Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 240 : 15, offset, offset + 3);
    }
    const exact = new Uint8Array(await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer());
    const near = new Uint8Array(await sharp(exact).modulate({ brightness: 1.02 }).png().toBuffer());
    const different = new Uint8Array(await sharp(differentPixels, { raw: { width, height, channels: 3 } }).png().toBuffer());
    const records: any[] = [];
    const captionCalls: number[] = [];
    let metrics: ImageProcessingMetrics | undefined;
    const inputs = [exact, near, different].map((bytes, index) => ({
      scopeKey: 'c123456789', ownerKey: 'c987654321', imageKey: `cmrnlzf650002qc7k4p5zem${index + 5}`,
      file: { filename: `photo-${index}.png`, mimeType: 'image/png', sizeBytes: bytes.byteLength, bytes },
    }));
    const results = await processImages(inputs, {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} },
      findCaption: async (_scopeKey, hash) => records.find((record) => perceptualHashDistance(record.perceptualHash, hash) <= PERCEPTUAL_HASH_DUPLICATE_DISTANCE) ?? null,
      captionBatch: async (values) => { captionCalls.push(values.length); return values.map((_, index) => ({ caption: `Generated ${index + 1}`, score: 90 - index * 10 })); },
      embed: async (text) => Array(EMBEDDING_DIMENSIONS).fill(text.includes('Generated 1') ? 0.1 : 0.2),
      getImage: async () => null,
      persistImage: async ({ image, caption }) => { if (caption) records.push(caption); return image; },
      createCaptionKey: (() => { const keys = ['cmrnlzf650002qc7k4p5zema0', 'cmrnlzf650002qc7k4p5zema1']; return () => keys.shift()!; })(),
      onMetrics(value) { metrics = value; },
    });
    expect(captionCalls).toEqual([2]);
    expect(records.map(({ score }) => score)).toEqual([90, 80]);
    expect(results[0]?.imageCaptionKey).toBe(results[1]?.imageCaptionKey);
    expect(results[2]?.imageCaptionKey).not.toBe(results[0]?.imageCaptionKey);
    expect(metrics).toMatchObject({ count: 3, generated: 2, reused: 1 });
    expect(metrics!.durationMs).toBeLessThan(5_000);
  });
});
