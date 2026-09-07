import { describe, expect, test } from 'bun:test';
import { getRootTeamKey, teamSchema } from './teams.node';
import { userSchema } from './users.node';
import { visitorSchema } from './visitors.node';

const baseTeam = {
  key: 'team_root',
  name: 'Founders',
  createdAt: '2026-07-10T00:00:00.000Z',
  updatedAt: '2026-07-10T00:00:00.000Z',
};

describe('team node schema', () => {
  test('defaults to a non-root team with empty metadata', () => {
    const team = teamSchema.parse(baseTeam);

    expect(team.is_root).toBe(false);
    expect(team.mfa_enabled).toBe(false);
    expect(team.metadata).toEqual({});
    expect(team.embedding).toEqual([]);
  });

  test('accepts the root Founders team', () => {
    const team = teamSchema.parse({
      ...baseTeam,
      is_root: true,
    });

    expect(team.is_root).toBe(true);
    expect(team.name).toBe('Founders');
  });

  test('non-user owning nodes link through teamKey', () => {
    const linked = {
      user: userSchema.parse({
        key: 'usr_1',
        currentScopeKey: 'cm1234567890123456789012345',
        email: 'user@example.com',
        emailHash: 'a'.repeat(64),
        createdAt: baseTeam.createdAt,
        updatedAt: baseTeam.updatedAt,
      }),
      visitor: visitorSchema.parse({
        key: 'vis_1',
        teamKey: 'team_root',
        distinctId: 'device-1',
        alias: 'Quiet Comet',
        lastSeenAt: baseTeam.createdAt,
        createdAt: baseTeam.createdAt,
        updatedAt: baseTeam.updatedAt,
      }),
    };

    expect(linked.user).not.toHaveProperty('teamKey');
    expect(linked.visitor.teamKey).toBe('team_root');
  });

});

describe('getRootTeamKey', () => {
  test('creates a root team with MFA enforcement enabled', async () => {
    const inserted: Record<string, unknown>[] = [];
    const key = await getRootTeamKey({
      getRootTeam: async () => null,
      createId: () => 'team-created',
      now: () => baseTeam.createdAt,
      insertTeam: async (team) => {
        inserted.push(team);
        return teamSchema.parse({ ...team, embedding: [] });
      },
    });

    expect(key).toBe('team-created');
    expect(inserted).toEqual([expect.objectContaining({
      key: 'team-created',
      is_root: true,
      mfa_enabled: true,
    })]);
  });

  test('does not replace an existing root team', async () => {
    let insertions = 0;
    const existing = teamSchema.parse({ ...baseTeam, is_root: true, mfa_enabled: true });
    const key = await getRootTeamKey({
      getRootTeam: async () => existing,
      insertTeam: async () => {
        insertions += 1;
        return existing;
      },
    });

    expect(key).toBe(existing.key);
    expect(insertions).toBe(0);
  });
});

describe('user team ownership', () => {
  test('derives team ownership through scope and membership rather than the user document', () => {
    expect(Object.keys(userSchema.shape)).not.toContain('teamKey');
  });
});
