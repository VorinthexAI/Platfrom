import { describe, expect, test } from 'bun:test';
import sharp from 'sharp';
import { computePerceptualHashBatch, perceptualHashDistance, perceptualHashSegments, perceptualHashSimilarity } from './perceptual-hash';

describe('perceptual image hashes', () => {
  test('computes deterministic batches and fixed index segments', async () => {
    const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#cc3333' } }).png().toBuffer();
    const hashes = await computePerceptualHashBatch([image, image]);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).toMatch(/^[a-f0-9]{16}$/);
    expect(hashes[1]).toBe(hashes[0]);
    expect(perceptualHashSegments(hashes[0]!)).toEqual([
      hashes[0]!.slice(0, 4), hashes[0]!.slice(4, 8), hashes[0]!.slice(8, 12), hashes[0]!.slice(12, 16),
    ]);
  });

  test('uses Hamming distance for the 95 percent duplicate boundary', () => {
    expect(perceptualHashDistance('0000000000000000', '0000000000000007')).toBe(3);
    expect(perceptualHashSimilarity('0000000000000000', '0000000000000007')).toBe(61 / 64);
    expect(perceptualHashDistance('0000000000000000', '000000000000000f')).toBe(4);
  });
});
