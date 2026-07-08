import { describe, expect, test } from 'bun:test';
import { teamMemberInviteSchema } from './team-member-invites.node';
import { teamMemberSchema } from './team-members.node';
import { teamSchema } from './teams.node';

describe('team node schemas', () => {
  test('team has an ownerId and no platform link', () => {
    const team = teamSchema.parse({
      key: 'team_test',
      ownerId: 'usr_owner',
      name: 'Vorinthex',
      slug: 'vorinthex',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
      platformId: 'legacy_platform',
    });

    expect(team.ownerId).toBe('usr_owner');
    expect(team.isActive).toBe(true);
    expect('platformId' in team).toBe(false);
  });

  test('team member stores team-local role and status only', () => {
    const member = teamMemberSchema.parse({
      key: 'tm_test',
      teamId: 'team_test',
      userId: 'usr_test',
      role: 'viewer',
      joinedAt: '2026-07-08T00:00:00.000Z',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });

    expect(member.status).toBe('active');
    expect(member.invitedByUserId).toBeNull();
    expect('platformId' in member).toBe(false);
  });

  test('team invite tracks invite lifecycle without platformId', () => {
    const invite = teamMemberInviteSchema.parse({
      key: 'tmi_test',
      teamId: 'team_test',
      email: 'invite@example.com',
      emailHash: 'b'.repeat(64),
      role: 'admin',
      invitedByUserId: 'usr_owner',
      tokenHash: 'c'.repeat(64),
      expiresAt: '2026-07-15T00:00:00.000Z',
      createdAt: '2026-07-08T00:00:00.000Z',
      updatedAt: '2026-07-08T00:00:00.000Z',
    });

    expect(invite.status).toBe('pending');
    expect(invite.acceptedByUserId).toBeNull();
    expect(invite.acceptedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
    expect('platformId' in invite).toBe(false);
  });
});
