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

  test('stabilizes DCT noise for structurally identical flat images', async () => {
    const colors = ['#000000', '#ffffff', '#777777', '#cc3333'];
    const images = await Promise.all(colors.map((background) => sharp({ create: { width: 48, height: 36, channels: 3, background } }).png().toBuffer()));
    const hashes = await computePerceptualHashBatch(images);
    for (const hash of hashes.slice(1)) expect(perceptualHashDistance(hashes[0]!, hash)).toBeLessThanOrEqual(3);
  });

  test('preserves Hamming and segment candidate invariants', () => {
    const base = '0123456789abcdef';
    expect(perceptualHashDistance(base, base)).toBe(0);
    expect(perceptualHashDistance(base, 'fedcba9876543210')).toBe(perceptualHashDistance('fedcba9876543210', base));
    for (const candidate of ['0123456789abcdee', '0123456789abcdec', '0123456789abcde8']) {
      expect(perceptualHashDistance(base, candidate)).toBeLessThanOrEqual(3);
      expect(perceptualHashSegments(base).some((segment, index) => segment === perceptualHashSegments(candidate)[index])).toBe(true);
    }
    expect(() => perceptualHashDistance(base, 'UPPERCASEHASH123')).toThrow();
  });

  test('is stable across lossless re-encoding and small brightness changes', async () => {
    const pixels = Buffer.alloc(64 * 64 * 3);
    for (let y = 0; y < 64; y += 1) for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 3;
      pixels[offset] = x * 4;
      pixels[offset + 1] = y * 4;
      pixels[offset + 2] = (x + y) * 2;
    }
    const source = sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } });
    const [png, webp, brighter] = await Promise.all([
      source.clone().png().toBuffer(),
      source.clone().webp({ lossless: true }).toBuffer(),
      source.clone().modulate({ brightness: 1.02 }).png().toBuffer(),
    ]);
    const hashes = await computePerceptualHashBatch([png, webp, brighter]);
    expect(perceptualHashDistance(hashes[0]!, hashes[1]!)).toBeLessThanOrEqual(3);
    expect(perceptualHashDistance(hashes[0]!, hashes[2]!)).toBeLessThanOrEqual(3);
  });
});
