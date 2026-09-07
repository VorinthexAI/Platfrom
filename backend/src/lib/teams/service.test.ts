import { describe, expect, test } from 'bun:test';
import { createTeamService, TeamServiceError } from './service';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

const user = { key: 'user-1' };
const membership = { key: 'membership-1', userId: user.key, teamKey: 'team-1', status: 'active', teamMfaVersion: 3 };
const context = (assured = false) => ({
  teamKey: 'team-1',
  runtimeScopeKey: 'cm1234567890123456789012345',
  principal: { kind: 'member', user, userTeam: membership, scopeMember: null },
  ...(assured ? { teamAssurance: { teamMembershipKey: membership.key, teamMfaVersion: membership.teamMfaVersion } } : {}),
}) as ToolContext;

const option = (mfaEnabled: boolean) => ({
  key: 'team-1', name: 'Team', slug: 'team', role: 'owner', teamMembershipKey: membership.key,
  mfaEnabled, currentScopeKey: null, defaultScopeKey: 'cm1234567890123456789012345',
  membershipMfaEnabled: mfaEnabled, teamMfaVersion: 3, isRoot: false,
  scopes: [{ key: 'cm1234567890123456789012345', name: 'Main', slug: 'main', isCurrent: false, isDefault: true }],
});

const selected = {
  team: { key: 'team-1', name: 'Team', slug: 'team', mfa_enabled: false },
  membership: { teamRole: 'owner' },
  scope: { key: 'cm1234567890123456789012345', name: 'Main', slug: 'main' },
} as never;

describe('team selection service', () => {
  test('enables selection only from durable environment-seeded eligibility', async () => {
    const disabled = createTeamService({ list: async () => ({ enabled: false, teams: [option(false)] }) });
    await expect(disabled.list({}, context())).rejects.toBeInstanceOf(TeamServiceError);
    await expect(disabled.select({ targetTeamKey: 'team-1' }, context())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('lists all active options without provenance or email data', async () => {
    const service = createTeamService({ list: async () => ({ enabled: true, teams: [option(false)] }) });
    const result = await service.list({}, context());
    expect(result.teams).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('environmentSeeded');
    expect(JSON.stringify(result)).not.toContain('@');
  });

  test('selects an MFA-disabled team and its authorized default scope immediately', async () => {
    const calls: unknown[] = [];
    const service = createTeamService({
      list: async () => ({ enabled: true, teams: [option(false)] }),
      select: async (...input) => { calls.push(input); return selected; },
    });
    await expect(service.select({ targetTeamKey: 'team-1' }, context())).resolves.toMatchObject({ status: 'selected', scope: { slug: 'main' } });
    expect(calls[0]).toEqual(['user-1', 'team-1', 'cm1234567890123456789012345']);
  });

  test('returns a membership- and scope-bound setup challenge when exact assurance is absent', async () => {
    const service = createTeamService({
      list: async () => ({ enabled: true, teams: [option(true)] }),
      challenge: async (_type, userKey, teamMembershipKey, kind, scopeKey) => {
        expect({ userKey, teamMembershipKey, kind, scopeKey }).toEqual({ userKey: 'user-1', teamMembershipKey: 'membership-1', kind: 'totp', scopeKey: 'cm1234567890123456789012345' });
        return { status: 'totp_setup_required', totpChallengeToken: 'a'.repeat(64), expiresAt: new Date('2026-09-06T00:15:00.000Z') };
      },
    });
    await expect(service.select({ targetTeamKey: 'team-1' }, context())).resolves.toMatchObject({ status: 'setup_required', challengeToken: 'a'.repeat(64), teamKey: 'team-1' });
  });

  test('accepts only exact membership and MFA-version assurance', async () => {
    let selectedCount = 0;
    const service = createTeamService({
      list: async () => ({ enabled: true, teams: [option(true)] }),
      select: async () => { selectedCount += 1; return selected; },
      challenge: async () => { throw new Error('challenge should not be created'); },
    });
    await expect(service.select({ targetTeamKey: 'team-1' }, context(true))).resolves.toMatchObject({ status: 'selected' });
    expect(selectedCount).toBe(1);
    const stale = { ...context(true), teamAssurance: { teamMembershipKey: membership.key, teamMfaVersion: 2 } };
    const challenged = createTeamService({ list: async () => ({ enabled: true, teams: [option(true)] }), challenge: async () => ({ status: 'totp_required', totpChallengeToken: 'b'.repeat(64), expiresAt: new Date() }) });
    await expect(challenged.select({ targetTeamKey: 'team-1' }, stale)).resolves.toMatchObject({ status: 'totp_required' });
  });
});
