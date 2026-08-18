import { describe, expect, test } from 'bun:test';
import { findReusableImageCaption } from './image-captions.node';
import { PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const now = '2026-08-11T12:00:00.000Z';
const record = (key: string, perceptualHash: string, createdAt = now) => ({
  _key: key,
  scopeKey,
  sourceImageKey: key,
  caption: key,
  score: 80,
  scoreVersion: 1,
  embedding: Array(4_096).fill(0.1),
  perceptualHash,
  hashAlgorithm: 'phash-64-dct-v1',
  hashSegment0: perceptualHash.slice(0, 4),
  hashSegment1: perceptualHash.slice(4, 8),
  hashSegment2: perceptualHash.slice(8, 12),
  hashSegment3: perceptualHash.slice(12, 16),
  createdAt,
  updatedAt: now,
});

describe('image caption pHash lookup', () => {
  test('chooses the nearest deterministic match at the 95 percent boundary', async () => {
    let bindVars: Record<string, unknown> = {};
    let query = '';
    const fartherKey = 'cmrnlzf650002qc7k4p5zem5w';
    const nearerKey = 'cmrnlzf650002qc7k4p5zem5x';
    const database = {
      async query(value: string, variables?: Record<string, unknown>) {
        query = value;
        bindVars = variables ?? {};
        return { async all() { return [record(fartherKey, '0000000000000007'), record(nearerKey, '0000000000000001')]; } };
      },
    };
    const actorKey = 'cmrnlzf640001qc7kazsr96k6';
    await expect(findReusableImageCaption(scopeKey, '0000000000000000', actorKey, database)).resolves.toMatchObject({ key: nearerKey });
    expect(bindVars).toMatchObject({ scopeKey, actorKey, segment0: '0000', segment1: '0000', segment2: '0000', segment3: '0000' });
    expect(query).toContain('actorMembership.organizationId == actorScope.organizationKey');
    expect(query).toContain('FILTER elevated || scoped || collectionAccess');
    expect(query).toContain('image.imageCaptionKey == caption._key');
    expect(query).toContain('FILTER accessibleImage != null');
  });

  test('rejects candidates below 95 percent similarity', async () => {
    expect(PERCEPTUAL_HASH_DUPLICATE_DISTANCE).toBe(3);
    const database = { async query() { return { async all() { return [record('cmrnlzf650002qc7k4p5zem5w', '000000000000000f')]; } }; } };
    await expect(findReusableImageCaption(scopeKey, '0000000000000000', 'cmrnlzf640001qc7kazsr96k6', database)).resolves.toBeNull();
  });
});
