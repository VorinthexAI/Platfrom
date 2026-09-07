import { describe, expect, test } from 'bun:test';
import { assertAppLogoSeedEnvironment } from './seed-app-logo-assets';

describe('app logo asset seed environment', () => {
  test('accepts only the dedicated local LocalStack bucket in local mode', () => {
    expect(() => assertAppLogoSeedEnvironment('--local', { S3_ENDPOINT_URL: 'http://localhost:4566', S3_BUCKET: 'vorinthex-dev' })).not.toThrow();
    expect(() => assertAppLogoSeedEnvironment('--local', { S3_ENDPOINT_URL: 'https://s3.amazonaws.com', S3_BUCKET: 'vorinthex-dev' })).toThrow('LocalStack');
    expect(() => assertAppLogoSeedEnvironment('--local', { S3_ENDPOINT_URL: 'http://localhost:4566', S3_BUCKET: 'production' })).toThrow('vorinthex-dev');
  });

  test('accepts production only in CI without a custom endpoint', () => {
    expect(() => assertAppLogoSeedEnvironment('--production-ci', { CI: 'true', S3_BUCKET: 'production' })).not.toThrow();
    expect(() => assertAppLogoSeedEnvironment('--production-ci', { CI: 'true', S3_BUCKET: 'production', AWS_ENDPOINT_URL: 'http://localhost:4566' })).toThrow('forbids');
    expect(() => assertAppLogoSeedEnvironment('--production-ci', { S3_BUCKET: 'production' })).toThrow('CI');
    expect(() => assertAppLogoSeedEnvironment(undefined, {})).toThrow('exactly one');
  });
});
