import { describe, expect, test } from 'bun:test';
import { resolveAwsCredentials } from './aws-sigv4';

describe('AWS credential resolution', () => {
  test('uses explicit credentials before environment values', () => {
    expect(resolveAwsCredentials(
      { region: 'us-east-1', accessKeyId: 'explicit-key', secretAccessKey: 'explicit-secret' },
      { AWS_REGION: 'eu-north-1', AWS_ACCESS_KEY_ID: 'environment-key', AWS_SECRET_ACCESS_KEY: 'environment-secret' },
    )).toEqual({ region: 'us-east-1', accessKeyId: 'explicit-key', secretAccessKey: 'explicit-secret' });
  });

  test('uses standard environment values when credentials are omitted', () => {
    expect(resolveAwsCredentials(undefined, {
      AWS_DEFAULT_REGION: 'eu-north-1',
      AWS_ACCESS_KEY_ID: 'environment-key',
      AWS_SECRET_ACCESS_KEY: 'environment-secret',
    })).toEqual({ region: 'eu-north-1', accessKeyId: 'environment-key', secretAccessKey: 'environment-secret' });
  });
});
