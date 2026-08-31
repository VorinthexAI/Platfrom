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
    expect(user.refreshFounderMembershipKey).toBeNull();
    expect(user.refreshFounderMfaVersion).toBeNull();
    expect(user.isOnboarded).toBe(false);
    expect('settings' in user).toBe(false);

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

  test('strips the retired settings blob', () => {
    expect(userSchema.parse({ ...baseUser, settings: { archive: { showOnlyFavorites: true } } })).not.toHaveProperty('settings');
  });

  test('hard deletion atomically removes user generation history', async () => {
    const source = await Bun.file(new URL('./users.node.ts', import.meta.url)).text();
    expect(source).toContain("withTransaction(['users', 'userHiddens', 'userGenerations']");
    expect(source).toContain('FOR generation IN userGenerations FILTER generation.userKey == @userKey REMOVE generation IN userGenerations');
    expect(source.indexOf('REMOVE generation IN userGenerations')).toBeLessThan(source.indexOf('REMOVE @userKey IN users'));
  });
});
