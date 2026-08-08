import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, EMBEDDING_PROVIDER_ID } from '@/lib/embeddings';
import { ImageProcessingError, processImage } from './index';

function png(width = 2, height = 3) { const bytes = new Uint8Array(24); bytes.set([137, 80, 78, 71, 13, 10, 26, 10]); bytes.set([73, 72, 68, 82], 12); new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes; }
function input(bytes = png()) { return { scopeKey: 'c123456789', ownerKey: 'c987654321', file: { filename: 'photo.png', mimeType: 'image/png', sizeBytes: bytes.length, bytes } }; }
describe('Gallery image processing', () => {
  test('stores captions with current Qwen vectors and metadata', async () => {
    let stored: Record<string, unknown> | undefined;
    const result = await processImage(input(), {
      storage: { async upload({ key }) { return { storageKey: key }; }, async delete() {} }, caption: async () => 'A blue square.', embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.25), getImage: async () => null,
      insertImage: async (image) => { stored = image; return image; }, createKey: () => 'cmrnlzf650002qc7k4p5zem5w',
    });
    expect(result.embedding).toHaveLength(4096);
    expect(stored).toMatchObject({ ownerKey: 'c987654321', embeddingProvider: EMBEDDING_PROVIDER_ID, embeddingModel: EMBEDDING_MODEL, embeddingDimensions: 4096, width: 2, height: 3 });
  });
  test('cleans uploaded data when embedding dimensions are stale', async () => {
    const deleted: string[] = [];
    await expect(processImage(input(), { storage: { async upload({ key }) { return { storageKey: key }; }, async delete(key) { deleted.push(key); } }, caption: async () => 'Caption', embed: async () => Array(EMBEDDING_DIMENSIONS - 1).fill(0), getImage: async () => null, insertImage: async (image) => image, createKey: () => 'cmrnlzf650002qc7k4p5zem5w' })).rejects.toBeInstanceOf(ImageProcessingError);
    expect(deleted).toHaveLength(1);
  });
  test('rejects different in-flight and persisted payloads for one idempotency key', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let stored: any;
    const dependencies = {
      storage: { async upload({ key }: { key: string }) { return { storageKey: key }; }, async delete() {} },
      caption: async () => { await gate; return 'Caption'; }, embed: async () => Array(EMBEDDING_DIMENSIONS).fill(0.1),
      getImage: async () => stored ?? null, insertImage: async (image: any) => stored = image,
    } as Parameters<typeof processImage>[1];
    const first = processImage({ ...input(), idempotencyKey: 'same-key' }, dependencies);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(processImage({ ...input(png(4, 3)), idempotencyKey: 'same-key' }, dependencies)).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    release();
    await first;
    await expect(processImage({ ...input(png(4, 3)), idempotencyKey: 'same-key' }, { ...dependencies, caption: async () => 'Caption' })).rejects.toMatchObject({ code: 'IMAGE_IDEMPOTENCY_CONFLICT' });
    expect(stored.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
