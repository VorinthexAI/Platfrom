import { describe, expect, test } from 'bun:test';
import { countryCodeSchema, userSchema } from './users.node';

const baseUser = {
  key: 'usr_test',
  organizationId: 'org_root',
  email: 'user@example.com',
  emailHash: 'a'.repeat(64),
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
};

describe('user node schema', () => {
  test('accepts ISO alpha-2 country codes and rejects arbitrary values', () => {
    expect(countryCodeSchema.parse('SE')).toBe('SE');
    expect(() => countryCodeSchema.parse('SWE')).toThrow();
    expect(() => countryCodeSchema.parse('ZZ')).toThrow();
  });

  test('keeps organization role and MFA fields off ordinary users', () => {
    const user = userSchema.parse(baseUser);

    expect(user.refreshTokenExpiresAt).toBeNull();

    expect('organization_role' in user).toBe(false);
    expect('organization_title' in user).toBe(false);
    expect('isMfaEnabled' in user).toBe(false);
    expect('has_request_mfa_reset_link' in user).toBe(false);
    expect('totpSecret' in user).toBe(false);
    expect('lastTotpTimeStep' in user).toBe(false);
    expect('requested_mfa_reset_link_at' in user).toBe(false);
  });

  test('strips legacy organization and MFA fields', () => {
    const user = userSchema.parse({
      ...baseUser,
      organization_role: 'viewer',
      organization_title: 'Operator',
      isMfaEnabled: true,
      totpSecret: 'secret',
      lastTotpTimeStep: 123,
      is_platform_member: true,
      is_platform_owner: true,
    });

    expect('organization_role' in user).toBe(false);
    expect('organization_title' in user).toBe(false);
    expect('isMfaEnabled' in user).toBe(false);
    expect('totpSecret' in user).toBe(false);
    expect('lastTotpTimeStep' in user).toBe(false);
    expect('is_platform_member' in user).toBe(false);
    expect('is_platform_owner' in user).toBe(false);
  });
});
