import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { ImageProcessingError, processImage, processImages } from './index';

function png(width = 2, height = 3) { const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
function input(bytes = png()) { return { scopeKey: 'c123456789', ownerKey: 'c987654321', file: { filename: 'photo.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes } }; }
describe('MediaLibrary image processing', () => {
  test('stores captions with current Qwen vectors', async () => {
    let stored: Record<string, unknown> | undefined;
    const result = await processImage(input(), {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} }, hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null, caption: async () => 'A blue square.', embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.25), getImage: async () => null,
      persistImage: async ({ image, caption }) => { stored = { image, caption }; return image; }, createKey: () => 'cmrnlzf650002qc7k4p5zem5w', createCaptionKey: () => 'cmrnlzf650002qc7k4p5zem5x',
    });
    expect(result.embedding).toHaveLength(4096);
    expect(stored).toMatchObject({ image: { width: 2, height: 3, imageCaptionKey: 'cmrnlzf650002qc7k4p5zem5x' }, caption: { perceptualHash: '0123456789abcdef', caption: 'A blue square.' } });
    expect(stored?.image).not.toHaveProperty('ownerKey');
    expect(stored?.image).not.toHaveProperty('embeddingProvider');
  });
  test('cleans uploaded data when embedding dimensions are stale', async () => {
    const deleted: string[] = [];
    await expect(processImage(input(), { storage: { async upload({ key }) { return { storageKey: key }; }, async delete(key) { deleted.push(key); } }, hashBatch: async () => ['0123456789abcdef'], findCaption: async () => null, caption: async () => 'Caption', embed: async () => Array(EMBEDDING_DIMENSIONS - 1).fill(0), getImage: async () => null, persistImage: async ({ image }) => image, createKey: () => 'cmrnlzf650002qc7k4p5zem5w' })).rejects.toBeInstanceOf(ImageProcessingError);
    expect(deleted).toHaveLength(1);
  });
  test('reuses the canonical hash and caption for a perceptual duplicate', async () => {
    const canonical = {
      key: 'cmrnlzf650002qc7k4p5zem5x', scopeKey: 'c123456789', sourceImageKey: 'cmrnlzf650002qc7k4p5zem5y', caption: 'Canonical caption.',
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
      caption: async () => { captionCalls += 1; return 'One canonical caption.'; },
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
      caption: async () => { await gate; return 'Caption'; }, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1),
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
    await expect(processImage({ ...input(png(4, 3)), idempotencyKey: 'same-key' }, { ...dependencies, caption: async () => 'Caption' })).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    expect(stored).not.toHaveProperty('requestHash');
  });
});
