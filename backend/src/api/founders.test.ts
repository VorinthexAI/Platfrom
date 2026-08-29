import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { foundersOrganizationKeyParamSchema, hasFounderAssurance } from './founders';

describe('founders request schemas', () => {
  test('accepts legacy organization keys', () => {
    const organizationKey = 'vorinthex-root';
    expect(foundersOrganizationKeyParamSchema.parse(organizationKey)).toBe(organizationKey);
  });

  test('rejects empty organization keys', () => {
    expect(foundersOrganizationKeyParamSchema.safeParse('   ').success).toBe(false);
  });

  test('requires MFA assurance in addition to root membership', () => {
    const membership = { key: 'uorg_root', isMfaEnabled: true, mfaVersion: 2 };
    expect(hasFounderAssurance({ founderAssured: true, founderMembershipKey: 'uorg_root', founderMfaVersion: 2 }, membership)).toBe(true);
    expect(hasFounderAssurance({ founderAssured: true, founderMembershipKey: 'uorg_other', founderMfaVersion: 2 }, membership)).toBe(false);
    expect(hasFounderAssurance({ founderAssured: true, founderMembershipKey: 'uorg_root', founderMfaVersion: 1 }, membership)).toBe(false);
    expect(hasFounderAssurance({ founderAssured: true, founderMembershipKey: 'uorg_root', founderMfaVersion: 2 }, { ...membership, isMfaEnabled: false })).toBe(false);
    expect(hasFounderAssurance({ founderAssured: false })).toBe(false);
    expect(hasFounderAssurance({})).toBe(false);
    expect(hasFounderAssurance(null)).toBe(false);
  });
});
