import { describe, expect, test } from 'bun:test';
import { NODE_NAMES } from './registry';
import { teamMemberInviteSchema } from './team-member-invites.node';
import { teamMemberSchema } from './team-members.node';
import { teamSchema } from './teams.node';
import { userSchema } from './users.node';

describe('node registry schema contracts', () => {
  test('all public node registry entries use unified users and team nodes', () => {
    expect(NODE_NAMES).toContain('users');
    expect(NODE_NAMES).toContain('teams');
    expect(NODE_NAMES).toContain('teamMembers');
    expect(NODE_NAMES).toContain('teamMemberInvites');
    expect(NODE_NAMES).not.toContain('members');
    expect(NODE_NAMES).not.toContain('superAdmins');
  });

  test('new and changed node schemas carry embedding fields', () => {
    expect(userSchema.shape).toHaveProperty('embedding');
    expect(teamSchema.shape).toHaveProperty('embedding');
    expect(teamMemberSchema.shape).toHaveProperty('embedding');
    expect(teamMemberInviteSchema.shape).toHaveProperty('embedding');
  });
});
