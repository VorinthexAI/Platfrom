import { describe, expect, test } from 'bun:test';
import { createStaticProviderAdapter, isStaticProvider, resolveStaticBedrockEnvironment, resolveStaticOpenAIConfig, resolveStaticPollyEnvironment, STATIC_PROVIDER_IDS } from './static-routes';

describe('static provider routes', () => {
  test('registers each environment-backed provider', () => {
    expect(STATIC_PROVIDER_IDS).toEqual(['openai', 'openrouter', 'aws-bedrock', 'aws-bedrock-mantle', 'aws-polly']);
    expect(isStaticProvider('aws-bedrock')).toBe(true);
    expect(isStaticProvider('aws-bedrock-mantle')).toBe(true);
    expect(isStaticProvider('openai')).toBe(true);
  });

  test('does not create an adapter for a non-static provider', () => {
    expect(createStaticProviderAdapter('anthropic')).toBeUndefined();
  });

  test('resolves the static OpenAI configuration from environment variables', () => {
    expect(resolveStaticOpenAIConfig({
      OPENAI_API_KEY: 'key',
      OPENAI_BASE_URL: 'https://example.com/v1',
      OPENAI_ORGANIZATION: 'org',
      OPENAI_PROJECT: 'project',
    })).toEqual({
      apiKey: 'key',
      baseUrl: 'https://example.com/v1',
      organization: 'org',
      project: 'project',
    });
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

  test('uses a supported Polly region and the deployed AWS credentials', () => {
    expect(resolveStaticPollyEnvironment({
      BEDROCK_REGION: 'eu-north-1',
      BEDROCK_AWS_ACCESS_KEY_ID: 'bedrock-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
    })).toEqual({
      AWS_REGION: 'eu-central-1',
      AWS_ACCESS_KEY_ID: 'bedrock-key',
      AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
    });
    expect(resolveStaticPollyEnvironment({
      POLLY_REGION: 'us-east-1',
      POLLY_AWS_ACCESS_KEY_ID: 'polly-key',
      POLLY_AWS_SECRET_ACCESS_KEY: 'polly-secret',
      BEDROCK_AWS_ACCESS_KEY_ID: 'bedrock-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'bedrock-secret',
    })).toEqual({
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'polly-key',
      AWS_SECRET_ACCESS_KEY: 'polly-secret',
    });
  });
});
