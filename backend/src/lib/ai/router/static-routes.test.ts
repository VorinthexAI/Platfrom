import { describe, expect, test } from 'bun:test';
import { createStaticProviderAdapter, isStaticProvider, STATIC_PROVIDER_IDS } from './static-routes';

describe('static provider routes', () => {
  test('registers each environment-backed AWS provider', () => {
    expect(STATIC_PROVIDER_IDS).toEqual(['aws-bedrock', 'aws-polly', 'aws-transcribe']);
    expect(isStaticProvider('aws-bedrock')).toBe(true);
    expect(isStaticProvider('openai')).toBe(false);
  });

  test('does not create an adapter for a non-static provider', () => {
    expect(createStaticProviderAdapter('openai')).toBeUndefined();
  });
});
