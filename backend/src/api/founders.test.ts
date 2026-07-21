import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { foundersBeaconAskSchema, foundersOrganizationKeyParamSchema, foundersProviderCredentialsBodySchema, foundersProviderCredentialsSchemas } from './founders';

describe('founders request schemas', () => {
  test('accepts legacy organization keys in both scope-list and Beacon requests', () => {
    const organizationKey = 'vorinthex-root';
    expect(foundersOrganizationKeyParamSchema.parse(organizationKey)).toBe(organizationKey);
    expect(foundersBeaconAskSchema.parse({
      organizationKey,
      scopeKey: newId(),
      message: 'Hello Beacon',
    }).organizationKey).toBe(organizationKey);
  });

  test('rejects empty organization keys and unknown Beacon request fields', () => {
    expect(foundersOrganizationKeyParamSchema.safeParse('   ').success).toBe(false);
    expect(foundersBeaconAskSchema.safeParse({
      organizationKey: 'vorinthex-root',
      scopeKey: newId(),
      message: 'Hello Beacon',
      agentKey: newId(),
    }).success).toBe(false);
  });

  test('uses strict native schemas for provider credentials', () => {
    expect(foundersProviderCredentialsBodySchema.safeParse({ credentials: { apiKey: 'secret' }, extra: true }).success).toBe(false);
    expect(foundersProviderCredentialsSchemas.openai.safeParse({ apiKey: 'secret' }).success).toBe(true);
    expect(foundersProviderCredentialsSchemas.openai.safeParse({ apiKey: 'secret', region: 'us-east-1' }).success).toBe(false);
    expect(foundersProviderCredentialsSchemas['aws-bedrock'].safeParse({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' }).success).toBe(true);
    expect(foundersProviderCredentialsSchemas['aws-bedrock'].safeParse({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret', temporaryToken: 'removed' }).success).toBe(false);
  });
});
