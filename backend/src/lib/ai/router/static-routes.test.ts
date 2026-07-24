import { describe, expect, test } from 'bun:test';
import { createStaticProviderAdapter, isStaticProvider, resolveStaticBedrockEnvironment, STATIC_PROVIDER_IDS } from './static-routes';

describe('static provider routes', () => {
  test('registers each environment-backed AWS provider', () => {
    expect(STATIC_PROVIDER_IDS).toEqual(['aws-bedrock', 'aws-polly', 'aws-transcribe']);
    expect(isStaticProvider('aws-bedrock')).toBe(true);
    expect(isStaticProvider('openai')).toBe(false);
  });

  test('does not create an adapter for a non-static provider', () => {
    expect(createStaticProviderAdapter('openai')).toBeUndefined();
  });

  test('prefers dedicated Bedrock configuration over generic AWS configuration', () => {
    expect(resolveStaticBedrockEnvironment({
      BEDROCK_REGION: 'us-east-1',
      BEDROCK_AWS_ACCESS_KEY_ID: 'bedrock-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
      AWS_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
    })).toEqual({
      AWS_REGION: 'us-east-1',
      AWS_DEFAULT_REGION: undefined,
      AWS_ACCESS_KEY_ID: 'bedrock-key',
      AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
    });
  });

  test('falls back to generic AWS configuration when dedicated Bedrock values are absent', () => {
    expect(resolveStaticBedrockEnvironment({
      AWS_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
    })).toEqual({
      AWS_REGION: 'us-west-2',
      AWS_DEFAULT_REGION: undefined,
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
    });
  });
});
