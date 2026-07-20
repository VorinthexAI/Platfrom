import { describe, expect, test } from 'bun:test';
import { foundersOrganizationKeyParamSchema, foundersProviderCredentialsBodySchema, foundersProviderCredentialsSchemas } from './founders';

describe('founders request schemas', () => {
  test('accepts legacy organization keys', () => {
    const organizationKey = 'vorinthex-root';
    expect(foundersOrganizationKeyParamSchema.parse(organizationKey)).toBe(organizationKey);
  });
  test('rejects empty organization keys', () => {
    expect(foundersOrganizationKeyParamSchema.safeParse('   ').success).toBe(false);
  });

  test('uses strict native schemas for provider credentials', () => {
    expect(foundersProviderCredentialsBodySchema.safeParse({ credentials: { apiKey: 'secret' }, extra: true }).success).toBe(false);
    expect(foundersProviderCredentialsSchemas.openai.safeParse({ apiKey: 'secret' }).success).toBe(true);
    expect(foundersProviderCredentialsSchemas.openai.safeParse({ apiKey: 'secret', region: 'us-east-1' }).success).toBe(false);
    expect(foundersProviderCredentialsSchemas['aws-bedrock'].safeParse({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' }).success).toBe(true);
    expect(foundersProviderCredentialsSchemas['aws-bedrock'].safeParse({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret', temporaryToken: 'removed' }).success).toBe(false);
  });
});
