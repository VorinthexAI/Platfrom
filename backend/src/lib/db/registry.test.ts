import { describe, expect, test } from 'bun:test';
import { NODE_NAMES } from './registry';
import { organizationSchema } from './organizations.node';
import { userOrganizationSchema } from './user-organization.node';
import { userSchema } from './users.node';

describe('node registry schema contracts', () => {
  test('registry serves organizations and user links, never the retired team/platform nodes', () => {
    expect(NODE_NAMES).toContain('users');
    expect(NODE_NAMES).toContain('organizations');
    expect(NODE_NAMES).toContain('user_organization');
    expect(NODE_NAMES).not.toContain('organizationMembers');
    expect(NODE_NAMES).not.toContain('platforms');
    expect(NODE_NAMES).not.toContain('teams');
    expect(NODE_NAMES).not.toContain('teamMembers');
    expect(NODE_NAMES).not.toContain('teamMemberInvites');
    expect(NODE_NAMES).not.toContain('members');
    expect(NODE_NAMES).not.toContain('superAdmins');
  });

  test('new and changed node schemas carry embedding fields', () => {
    expect(userSchema.shape).toHaveProperty('embedding');
    expect(organizationSchema.shape).toHaveProperty('embedding');
    expect(userOrganizationSchema.shape).toHaveProperty('embedding');
  });
});
