import { describe, expect, test } from 'bun:test';
import { resolvePublicS3ClientConfig, resolveS3ClientConfig } from './s3';

describe('S3 client configuration', () => {
  test('prefers storage credentials over generic credentials', () => {
    const config = resolveS3ClientConfig({
      S3_REGION: 'storage-region',
      AWS_REGION: 'generic-region',
      S3_AWS_ACCESS_KEY_ID: 'storage-key',
      S3_AWS_SECRET_ACCESS_KEY: 'storage-secret',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
    });

    expect(config.region).toBe('storage-region');
    expect(config.credentials).toEqual({ accessKeyId: 'storage-key', secretAccessKey: 'storage-secret', sessionToken: undefined });
  });

  test('falls back to generic AWS credentials', () => {
    const config = resolveS3ClientConfig({
      AWS_REGION: 'generic-region',
      AWS_ACCESS_KEY_ID: 'generic-key',
      AWS_SECRET_ACCESS_KEY: 'generic-secret',
    });

    expect(config.region).toBe('generic-region');
    expect(config.credentials).toEqual({ accessKeyId: 'generic-key', secretAccessKey: 'generic-secret', sessionToken: undefined });
  });

  test('uses the default AWS credential chain when no complete static pair exists', () => {
    const config = resolveS3ClientConfig({ AWS_ACCESS_KEY_ID: 'incomplete-key' });

    expect(config.credentials).toBeUndefined();
  });

  test('uses a browser-reachable endpoint for presigned URLs', () => {
    const config = resolvePublicS3ClientConfig({
      S3_ENDPOINT_URL: 'http://localstack:4566',
      S3_PUBLIC_ENDPOINT_URL: 'http://localhost:4566',
      S3_REGION: 'us-east-1',
    });

    expect(config.endpoint).toBe('http://localhost:4566');
    expect(config.forcePathStyle).toBe(true);
    expect(config.requestChecksumCalculation).toBe('WHEN_REQUIRED');
  });
});
