import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { foundersBeaconAskSchema, foundersBeaconDelegateSchema, foundersOrganizationKeyParamSchema } from './founders';

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

  test('accepts only strict Beacon core.delegate requests', () => {
    const input = { organizationKey: 'vorinthex-root', scopeKey: newId(), input: { request: 'Create an agent architecture for organization administration.' } };
    expect(foundersBeaconDelegateSchema.parse(input).input.sourceRefs).toEqual([]);
    expect(foundersBeaconDelegateSchema.safeParse({ ...input, agentKey: newId() }).success).toBe(false);
    expect(foundersBeaconDelegateSchema.safeParse({ ...input, input: { ...input.input, profile: 'special-agent' } }).success).toBe(false);
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
});
