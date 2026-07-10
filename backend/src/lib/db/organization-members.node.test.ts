import { describe, expect, test } from 'bun:test';
import { organizationMemberRoleSchema, organizationMemberSchema } from './organization-members.node';

const baseMember = {
  key: 'orgm_1',
  organizationId: 'org_acme',
  userId: 'usr_1',
  role: 'member',
  joinedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('organization member node schema', () => {
  test('links a user into an organization with active status by default', () => {
    const member = organizationMemberSchema.parse(baseMember);

    expect(member.organizationId).toBe('org_acme');
    expect(member.userId).toBe('usr_1');
    expect(member.status).toBe('active');
    expect(member.invitedByUserId).toBeNull();
  });

  test('accepts only the four membership roles', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
      expect(organizationMemberRoleSchema.parse(role)).toBe(role);
    }
    expect(() => organizationMemberRoleSchema.parse('superAdmin')).toThrow();
    expect(() => organizationMemberSchema.parse({ ...baseMember, role: 'boss' })).toThrow();
  });

  test('never carries a teamId — the link is organizationId', () => {
    const member = organizationMemberSchema.parse({
      ...baseMember,
      teamId: 'team_legacy',
    });

    expect('teamId' in member).toBe(false);
    expect(member.organizationId).toBe('org_acme');
  });
});
