import { describe, expect, test } from 'bun:test';
import { userOrganizationRoleSchema, userOrganizationSchema, userOrganizationStatusSchema } from './user-organization.node';

const baseLink = {
  key: 'uorg_1',
  organizationId: 'org_acme',
  userId: 'usr_1',
  orgRole: 'member',
  joinedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('user organization node schema', () => {
  test('links a user into an organization with MFA fields on the link', () => {
    const link = userOrganizationSchema.parse(baseLink);

    expect(link.organizationId).toBe('org_acme');
    expect(link.userId).toBe('usr_1');
    expect(link.orgRole).toBe('member');
    expect(link.status).toBe('active');
    expect(link.orgTitle).toBeNull();
    expect(link.isMfaEnabled).toBe(false);
    expect(link.totpSecret).toBeNull();
    expect(link.lastTotpTimeStep).toBeNull();
  });

  test('accepts only organization roles', () => {
    for (const role of ['owner', 'admin', 'moderator', 'member', 'viewer'] as const) {
      expect(userOrganizationRoleSchema.parse(role)).toBe(role);
    }
    expect(() => userOrganizationRoleSchema.parse('superAdmin')).toThrow();
    expect(() => userOrganizationSchema.parse({ ...baseLink, orgRole: 'boss' })).toThrow();
  });

  test('supports inactive memberships for explicit reactivation', () => {
    expect(userOrganizationStatusSchema.parse('inactive')).toBe('inactive');
    expect(userOrganizationSchema.parse({ ...baseLink, status: 'inactive' }).status).toBe('inactive');
  });

  test('never carries retired member or team fields', () => {
    const link = userOrganizationSchema.parse({
      ...baseLink,
      role: 'owner',
      teamId: 'team_legacy',
      invitedByUserId: 'usr_inviter',
    });

    expect('role' in link).toBe(false);
    expect('teamId' in link).toBe(false);
    expect('invitedByUserId' in link).toBe(false);
  });
});
