import { describe, expect, test } from 'bun:test';
import { MODEL_SLUGS, modelSlugSchema } from './index';
describe('logical model slugs', () => {
  test('declares the supported model components', () => {
    expect(MODEL_SLUGS).toEqual([
      'openai.gpt-5.6-sol',
      'openai.gpt-5.6-terra',
      'openai.gpt-5.6-luna',
      'openai.gpt-realtime-2',
      'amazon.polly-generative',
      'amazon.titan-embed-text-v2',
      'aws.transcribe-standard',
    ]);
    for (const slug of MODEL_SLUGS) expect(modelSlugSchema.parse(slug)).toBe(slug);
  });
  test('accepts lowercase dot/hyphen notation and rejects display names', () => {
    expect(modelSlugSchema.parse('vendor.model-name')).toBe('vendor.model-name');
    expect(() => modelSlugSchema.parse('Vendor/Model Name')).toThrow();
  });
});
