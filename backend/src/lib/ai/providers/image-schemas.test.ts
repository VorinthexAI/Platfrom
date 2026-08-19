import { describe, expect, test } from 'bun:test';
import { GENERATED_IMAGE_BASE64_MAX_LENGTH, imageGenerateInputSchema, imageOutputSchema } from './types';

const png = 'iVBORw0KGgo=';

describe('image action schemas', () => {
  test('accepts supported generation controls and applies the count default', () => {
    expect(imageGenerateInputSchema.parse({ prompt: '  a globe  ', size: '1024x1536', quality: 'high' }))
      .toEqual({ prompt: 'a globe', size: '1024x1536', quality: 'high', count: 1 });
    for (const size of ['1024x1024', '1024x1536', '1536x1024']) expect(imageGenerateInputSchema.safeParse({ prompt: 'x', size }).success).toBe(true);
    for (const quality of ['low', 'medium', 'high']) expect(imageGenerateInputSchema.safeParse({ prompt: 'x', quality }).success).toBe(true);
    for (const count of [1, 4]) expect(imageGenerateInputSchema.safeParse({ prompt: 'x', count }).success).toBe(true);
  });

  test('rejects unknown fields and out-of-bounds prompts, counts, sizes, and quality', () => {
    for (const input of [
      { prompt: '' },
      { prompt: 'x'.repeat(32_001) },
      { prompt: 'x', count: 0 },
      { prompt: 'x', count: 5 },
      { prompt: 'x', size: '512x512' },
      { prompt: 'x', quality: 'auto' },
      { prompt: 'x', extra: true },
    ]) expect(imageGenerateInputSchema.safeParse(input).success).toBe(false);
  });

  test('strictly validates normalized image outputs', () => {
    expect(imageOutputSchema.parse({ images: [{ base64: png, mimeType: 'image/png' }] })).toEqual({ images: [{ base64: png, mimeType: 'image/png' }] });
    for (const output of [
      { images: [] },
      { images: [{ base64: 'not base64', mimeType: 'image/png' }] },
      { images: [{ base64: png, mimeType: 'application/octet-stream' }] },
      { images: [{ base64: png, mimeType: 'image/png', url: 'https://example.com' }] },
      { images: [{ base64: png, mimeType: 'image/png' }], extra: true },
    ]) expect(imageOutputSchema.safeParse(output).success).toBe(false);
  });

  test('bounds generated image base64 at sixteen MiB', () => {
    const atLimit = `iVBORw0K${'A'.repeat(GENERATED_IMAGE_BASE64_MAX_LENGTH - 8)}`;
    expect(imageOutputSchema.safeParse({ images: [{ base64: atLimit, mimeType: 'image/png' }] }).success).toBe(true);
    expect(imageOutputSchema.safeParse({ images: [{ base64: `${atLimit}AAAA`, mimeType: 'image/png' }] }).success).toBe(false);
  });
});
