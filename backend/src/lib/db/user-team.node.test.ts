import { describe, expect, test } from 'bun:test';
import { userTeamRoleSchema, userTeamSchema, userTeamStatusSchema } from './user-team.node';

const baseLink = {
  key: 'uteam_1',
  teamKey: 'team_acme',
  userId: 'usr_1',
  teamRole: 'member',
  joinedAt: '2026-07-10T00:00:00.000Z',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('user team node schema', () => {
  test('links a user into a team with MFA fields on the link', () => {
    const link = userTeamSchema.parse(baseLink);

    expect(link.teamKey).toBe('team_acme');
    expect(link.userId).toBe('usr_1');
    expect(link.teamRole).toBe('member');
    expect(link.status).toBe('active');
    expect(link.environmentSeeded).toBe(false);
    expect(link.teamTitle).toBeNull();
    expect(link.orchestratorKey).toBeNull();
    expect(link.isMfaEnabled).toBe(false);
    expect(link.totpSecret).toBeNull();
    expect(link.lastTotpTimeStep).toBeNull();
    expect(link.teamMfaVersion).toBe(0);
    expect(link.teamMfaRecoveryPending).toBe(false);
  });

  test('accepts only team roles', () => {
    for (const role of ['owner', 'admin', 'moderator', 'member', 'viewer'] as const) {
      expect(userTeamRoleSchema.parse(role)).toBe(role);
    }
    expect(() => userTeamRoleSchema.parse('superAdmin')).toThrow();
    expect(() => userTeamSchema.parse({ ...baseLink, teamRole: 'boss' })).toThrow();
  });

  test('supports inactive memberships for explicit reactivation', () => {
    expect(userTeamStatusSchema.parse('inactive')).toBe('inactive');
    expect(userTeamSchema.parse({ ...baseLink, status: 'inactive' }).status).toBe('inactive');
  });

  test('supports an optional assigned orchestrator', () => {
    expect(userTeamSchema.parse({ ...baseLink, orchestratorKey: 'orch_atlas' }).orchestratorKey).toBe('orch_atlas');
  });

});
