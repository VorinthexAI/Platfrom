import { describe, expect, test } from 'bun:test';
import { MODEL_SLUGS, modelSlugSchema } from './index';
describe('logical model slugs', () => {
  test('declares the five Amazon model components', () => {
    expect(MODEL_SLUGS).toEqual([
      'amazon.nova-premier',
      'amazon.nova-pro',
      'amazon.nova-2-lite',
      'amazon.nova-2-sonic',
      'amazon.polly-generative',
    ]);
    for (const slug of MODEL_SLUGS) expect(modelSlugSchema.parse(slug)).toBe(slug);
  });
  test('accepts lowercase dot/hyphen notation and rejects display names', () => {
    expect(modelSlugSchema.parse('vendor.model-name')).toBe('vendor.model-name');
    expect(() => modelSlugSchema.parse('Vendor/Model Name')).toThrow();
  });
});
