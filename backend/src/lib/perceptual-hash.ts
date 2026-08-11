import sharp from 'sharp';
import { z } from 'zod';

const HASH_SIDE = 8;
const SAMPLE_SIDE = 32;
export const PERCEPTUAL_HASH_BITS = HASH_SIDE * HASH_SIDE;
export const PERCEPTUAL_HASH_DUPLICATE_DISTANCE = 3;
export const perceptualHashSchema = z.string().regex(/^[a-f0-9]{16}$/);

function dct(samples: Uint8Array): number[] {
  const coefficients: number[] = [];
  for (let vertical = 0; vertical < HASH_SIDE; vertical += 1) {
    for (let horizontal = 0; horizontal < HASH_SIDE; horizontal += 1) {
      let sum = 0;
      for (let y = 0; y < SAMPLE_SIDE; y += 1) {
        for (let x = 0; x < SAMPLE_SIDE; x += 1) {
          sum += samples[y * SAMPLE_SIDE + x]!
            * Math.cos(((2 * x + 1) * horizontal * Math.PI) / (2 * SAMPLE_SIDE))
            * Math.cos(((2 * y + 1) * vertical * Math.PI) / (2 * SAMPLE_SIDE));
        }
      }
      coefficients.push(sum);
    }
  }
  return coefficients;
}

export async function computePerceptualHash(bytes: Uint8Array): Promise<string> {
  const samples = await sharp(bytes, { animated: false })
    .rotate()
    .flatten({ background: '#ffffff' })
    .greyscale()
    .resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: 'fill' })
    .raw()
    .toBuffer();
  const coefficients = dct(samples);
  const sorted = coefficients.slice(1).sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  let hash = 0n;
  for (const coefficient of coefficients) hash = (hash << 1n) | (coefficient >= median ? 1n : 0n);
  return perceptualHashSchema.parse(hash.toString(16).padStart(16, '0'));
}

export async function computePerceptualHashBatch(images: readonly Uint8Array[]): Promise<string[]> {
  return Promise.all(images.map((bytes) => computePerceptualHash(bytes)));
}

export function perceptualHashSegments(hash: string): [string, string, string, string] {
  const value = perceptualHashSchema.parse(hash);
  return [value.slice(0, 4), value.slice(4, 8), value.slice(8, 12), value.slice(12, 16)];
}

export function perceptualHashDistance(left: string, right: string): number {
  let difference = BigInt(`0x${perceptualHashSchema.parse(left)}`) ^ BigInt(`0x${perceptualHashSchema.parse(right)}`);
  let distance = 0;
  while (difference > 0n) {
    distance += Number(difference & 1n);
    difference >>= 1n;
  }
  return distance;
}

export function perceptualHashSimilarity(left: string, right: string): number {
  return (PERCEPTUAL_HASH_BITS - perceptualHashDistance(left, right)) / PERCEPTUAL_HASH_BITS;
}
