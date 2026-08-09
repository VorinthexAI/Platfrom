import { describe, expect, test } from 'bun:test';
import { resolveS3ClientConfig } from './s3';

describe('S3 client configuration', () => {
  test('prefers storage credentials over generic and provider credentials', () => {
    const config = resolveS3ClientConfig({
      S3_REGION: 'storage-region',
      AWS_REGION: 'generic-region',
      BEDROCK_REGION: 'provider-region',
      S3_AWS_ACCESS_KEY_ID: 'storage-key',
      S3_AWS_SECRET_ACCESS_KEY: 'storage-secret',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
      BEDROCK_AWS_ACCESS_KEY_ID: 'provider-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'provider-secret',
    });

    expect(config.region).toBe('storage-region');
    expect(config.credentials).toEqual({ accessKeyId: 'storage-key', secretAccessKey: 'storage-secret', sessionToken: undefined });
  });

  test('falls back to the deployed provider credentials', () => {
    const config = resolveS3ClientConfig({
      BEDROCK_REGION: 'provider-region',
      BEDROCK_AWS_ACCESS_KEY_ID: 'provider-key',
      BEDROCK_AWS_SECRET_ACCESS_KEY: 'provider-secret',
    });

    expect(config.region).toBe('provider-region');
    expect(config.credentials).toEqual({ accessKeyId: 'provider-key', secretAccessKey: 'provider-secret', sessionToken: undefined });
  });

  test('uses the default AWS credential chain when no complete static pair exists', () => {
    const config = resolveS3ClientConfig({ AWS_ACCESS_KEY_ID: 'incomplete-key' });

    expect(config.credentials).toBeUndefined();
  });
});
