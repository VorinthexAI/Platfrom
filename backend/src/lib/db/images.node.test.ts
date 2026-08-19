import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { imageSchema, insertPreparedImageWithCaption, type Image } from './images.node';
import type { ImageCaptionRecord } from './image-captions.node';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const imageKey = 'cmrnlzf650002qc7k4p5zem5w';
const captionKey = 'cmrnlzf650002qc7k4p5zem5x';
const actorKey = 'cmrnlzf650002qc7k4p5zem5y';
const now = '2026-08-11T12:00:00.000Z';
const embedding = (value: number) => Array(EMBEDDING_DIMENSIONS).fill(value);

function image(overrides: Partial<Image> = {}): Image {
  return {
    key: imageKey, scopeKey, filename: 'image.png', caption: 'Generated caption.', imageCaptionKey: captionKey,
    storageKey: 'media/image.png', mimeType: 'image/png', sizeBytes: 10, width: 10, height: 10,
    embedding: embedding(0.1), isFavorite: false, createdAt: now, updatedAt: now,
    ...overrides, createdByKey: overrides.createdByKey ?? null,
  };
}

function caption(overrides: Partial<ImageCaptionRecord> = {}): ImageCaptionRecord {
  return {
    key: captionKey, scopeKey, sourceImageKey: imageKey, caption: 'Generated caption.', score: 80, scoreVersion: 1, embedding: embedding(0.1),
    perceptualHash: '0123456789abcdef', hashAlgorithm: 'phash-64-dct-v1',
    hashSegment0: '0123', hashSegment1: '4567', hashSegment2: '89ab', hashSegment3: 'cdef',
    createdAt: now, updatedAt: now, ...overrides,
  };
}

function transactionRunner(queries: string[], existing?: ImageCaptionRecord) {
  return (async (_collections: unknown, operation: (transaction: any) => Promise<unknown>) => operation({
    async query(query: string, bindVars?: Record<string, any>) {
      queries.push(query);
      if (query.startsWith('RETURN DOCUMENT')) return { async next() { return existing ? { ...existing, _key: existing.key, key: undefined } : null; } };
      if (query.startsWith('INSERT @image')) return { async next() { return { ...bindVars?.image, _key: (bindVars?.image as any)._key }; } };
      return { async next() { return null; } };
    },
  })) as typeof import('./client').withTransaction;
}

describe('prepared image caption transaction', () => {
  test('accepts optional derived city and country without coordinates', () => {
    expect(imageSchema.parse(image({ city: 'Stockholm', country: 'Sweden', countryCode: 'se' }))).toMatchObject({ city: 'Stockholm', country: 'Sweden', countryCode: 'SE' });
    expect(() => imageSchema.parse(image({ countryCode: 'SWE' }))).toThrow();
  });

  test('rechecks and converges on a canonical winner before inserting the image', async () => {
    const queries: string[] = [];
    const winner = caption({ key: 'cmrnlzf650002qc7k4p5zem5z', caption: 'Canonical winner.', embedding: embedding(0.9) });
    const result = await insertPreparedImageWithCaption({ image: image(), caption: caption(), actorKey }, {
      runTransaction: transactionRunner(queries),
      findCaption: async () => winner,
    });
    expect(queries).not.toContain('INSERT @caption INTO imageCaptions');
    expect(queries.at(-1)).toBe('INSERT @image INTO images RETURN NEW');
    expect(result).toMatchObject({ imageCaptionKey: winner.key, caption: winner.caption });
    expect(result.embedding[0]).toBe(0.9);
  });

  test('rejects direct attachment when the referenced caption is inaccessible', async () => {
    const queries: string[] = [];
    const existing = caption();
    await expect(insertPreparedImageWithCaption({ image: image(), actorKey }, {
      runTransaction: transactionRunner(queries, existing),
      findCaption: async () => null,
    })).rejects.toThrow('not accessible');
    expect(queries).not.toContain('INSERT @image INTO images RETURN NEW');
  });

  test('atomically inserts a new canonical caption and its image', async () => {
    const queries: string[] = [];
    await expect(insertPreparedImageWithCaption({ image: image(), caption: caption(), actorKey }, {
      runTransaction: transactionRunner(queries),
      findCaption: async () => null,
    })).resolves.toMatchObject({ key: imageKey, imageCaptionKey: captionKey });
    expect(queries).toEqual(['INSERT @caption INTO imageCaptions', 'INSERT @image INTO images RETURN NEW']);
  });
});
