import { describe, expect, test } from 'bun:test';
import { platformRoleSchema, userSchema } from './users.node';

const baseUser = {
  key: 'usr_test',
  platformId: 'plt_this',
  email: 'user@example.com',
  emailHash: 'a'.repeat(64),
  createdAt: '2026-07-08T00:00:00.000Z',
  updatedAt: '2026-07-08T00:00:00.000Z',
};

describe('user node schema', () => {
  test('defaults platform role and platform auth fields for ordinary users', () => {
    const user = userSchema.parse(baseUser);

    expect(user.platform_role).toBeNull();
    expect(user.isMfaEnabled).toBe(false);
    expect(user.has_request_mfa_reset_link).toBe(false);
    expect(user.totpSecret).toBeNull();
    expect(user.lastTotpTimeStep).toBeNull();
    expect(user.requested_mfa_reset_link_at).toBeNull();
  });

  test('accepts only platform roles, not legacy booleans', () => {
    expect(platformRoleSchema.parse('owner')).toBe('owner');
    expect(platformRoleSchema.parse('admin')).toBe('admin');
    expect(platformRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => platformRoleSchema.parse('member')).toThrow();

    const user = userSchema.parse({
      ...baseUser,
      platform_role: 'viewer',
      is_platform_member: true,
      is_platform_owner: true,
    });

    expect(user.platform_role).toBe('viewer');
    expect('is_platform_member' in user).toBe(false);
    expect('is_platform_owner' in user).toBe(false);
  });
});
