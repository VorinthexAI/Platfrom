import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { teamSchema } from '@/lib/db/teams.node';
import { userTeamSchema } from '@/lib/db/user-team.node';
import { scopeSchema } from '@/lib/ai/scopes/schema';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createTotpChallengeForIdentity, loginIdentityTypeForMembership } from '@/api/auth';

const keySchema = z.string().trim().min(1).max(160);
export const teamListInputSchema = z.object({}).strict();
export const teamSelectInputSchema = z.object({
  targetTeamKey: keySchema,
  targetScopeKey: z.string().cuid().optional(),
}).strict();

export class TeamServiceError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'MFA_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'TeamServiceError';
  }
}

type TeamOption = {
  key: string;
  name: string;
  slug: string | null;
  role: string;
  teamMembershipKey: string;
  mfaEnabled: boolean;
  membershipMfaEnabled: boolean;
  teamMfaVersion: number;
  isRoot: boolean;
  currentScopeKey: string | null;
  defaultScopeKey: string | null;
  scopes: Array<{ key: string; name: string; slug: string; isCurrent: boolean; isDefault: boolean }>;
};

type Selection = {
  team: ReturnType<typeof teamSchema.parse>;
  membership: ReturnType<typeof userTeamSchema.parse>;
  scope: ReturnType<typeof scopeSchema.parse>;
};

export interface TeamServiceDependencies {
  list?: (userKey: string) => Promise<{ enabled: boolean; teams: TeamOption[] }>;
  select?: (userKey: string, teamKey: string, scopeKey?: string) => Promise<Selection>;
  challenge?: typeof createTotpChallengeForIdentity;
}

function actor(context: ToolContext) {
  if (context.principal.kind !== 'member' || context.principal.userTeam.userId !== context.principal.user.key) {
    throw new TeamServiceError('FORBIDDEN', 'Authenticated user context is required.');
  }
  return context.principal.user;
}

async function defaultList(userKey: string): Promise<{ enabled: boolean; teams: TeamOption[] }> {
  const cursor = await db.query<Record<string, unknown>>(`
    LET user = DOCUMENT(users, @userKey)
    LET memberships = user == null ? [] : (
      FOR membership IN userTeams
        FILTER membership.userId == @userKey && membership.status == "active"
        LET team = DOCUMENT(teams, membership.teamKey)
        FILTER team != null && team.isActive == true
        LET accessibleScopes = (
          FOR scope IN scopes
            FILTER scope.teamKey == team._key
            LET direct = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == scope._key && item.userTeamKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
            FILTER membership.teamRole IN ["owner", "admin"] || direct != null
            SORT scope.slug == "main" DESC, scope.position ASC, scope.name ASC, scope._key ASC
            RETURN scope
        )
        LET current = FIRST(FOR scope IN accessibleScopes FILTER scope._key == user.currentScopeKey LIMIT 1 RETURN scope._key)
        RETURN { team, membership, scopes: accessibleScopes, currentScopeKey: current }
    )
    RETURN {
      enabled: LENGTH(FOR membership IN memberships FILTER membership.membership.environmentSeeded == true LIMIT 1 RETURN 1) > 0,
      memberships
    }
  `, { userKey });
  const result = await cursor.next() as { enabled?: boolean; memberships?: Array<any> } | undefined;
  const teams = (result?.memberships ?? []).map(({ team, membership, scopes, currentScopeKey }) => {
    const defaultScopeKey = (scopes[0]?._key as string | undefined) ?? null;
    return {
      key: team._key,
      name: team.name,
      slug: team.slug ?? null,
      role: membership.teamRole,
      teamMembershipKey: membership._key,
      mfaEnabled: team.mfa_enabled === true,
      membershipMfaEnabled: membership.isMfaEnabled === true,
      teamMfaVersion: Number(membership.teamMfaVersion ?? 0),
      isRoot: team.is_root === true,
      currentScopeKey: currentScopeKey ?? null,
      defaultScopeKey,
      scopes: scopes.map((scope: any) => ({
        key: scope._key,
        name: scope.name,
        slug: scope.slug,
        isCurrent: scope._key === currentScopeKey,
        isDefault: scope._key === defaultScopeKey,
      })),
    };
  });
  teams.sort((left, right) => left.name.localeCompare(right.name) || left.key.localeCompare(right.key));
  return { enabled: result?.enabled === true, teams };
}

async function defaultSelect(userKey: string, teamKey: string, scopeKey?: string): Promise<Selection> {
  return withTransaction({ read: ['teams', 'userTeams', 'scopes', 'scopeMembers'], write: ['users'] }, async (transaction) => {
    const cursor = await transaction.query(`
      LET user = DOCUMENT(users, @userKey)
      LET selectorEnabled = user != null && LENGTH(
        FOR seeded IN userTeams
          FILTER seeded.userId == @userKey && seeded.status == "active" && seeded.environmentSeeded == true
          LET seededTeam = DOCUMENT(teams, seeded.teamKey)
          FILTER seededTeam != null && seededTeam.isActive == true
          LIMIT 1 RETURN 1
      ) > 0
      LET membership = FIRST(FOR item IN userTeams FILTER item.userId == @userKey && item.teamKey == @teamKey && item.status == "active" LIMIT 1 RETURN item)
      LET team = membership == null ? null : DOCUMENT(teams, @teamKey)
      LET candidates = team == null ? [] : (
        FOR scope IN scopes
          FILTER scope.teamKey == team._key
          LET direct = membership == null ? null : FIRST(FOR item IN scopeMembers FILTER item.scopeKey == scope._key && item.userTeamKey == membership._key && item.status == "active" LIMIT 1 RETURN item)
          FILTER membership.teamRole IN ["owner", "admin"] || direct != null
          SORT scope.slug == "main" DESC, scope.position ASC, scope.name ASC, scope._key ASC
          RETURN scope
      )
      LET selected = @scopeKey == null ? FIRST(candidates) : FIRST(FOR scope IN candidates FILTER scope._key == @scopeKey LIMIT 1 RETURN scope)
      FILTER selectorEnabled && team != null && team.isActive == true && selected != null
      UPDATE user WITH { currentScopeKey: selected._key, updatedAt: @now } IN users
      RETURN { team, membership, scope: selected }
    `, { userKey, teamKey, scopeKey: scopeKey ?? null, now: new Date().toISOString() });
    const result = await cursor.next() as { team?: Record<string, unknown>; membership?: Record<string, unknown>; scope?: Record<string, unknown> } | undefined;
    if (!result?.team || !result.membership || !result.scope) throw new TeamServiceError('FORBIDDEN', 'Active team and scope membership are required.');
    return {
      team: teamSchema.parse({ ...result.team, key: result.team._key }),
      membership: userTeamSchema.parse({ ...result.membership, key: result.membership._key }),
      scope: scopeSchema.parse({ ...result.scope, key: result.scope._key }),
    };
  });
}

export function createTeamService(dependencies: TeamServiceDependencies = {}) {
  const list = dependencies.list ?? defaultList;
  const select = dependencies.select ?? defaultSelect;
  const challenge = dependencies.challenge ?? createTotpChallengeForIdentity;
  return {
    async list(rawInput: unknown, context: ToolContext) {
      teamListInputSchema.parse(rawInput);
      const result = await list(actor(context).key);
      if (!result.enabled) throw new TeamServiceError('FORBIDDEN', 'Team selection is not enabled for this account.');
      return { teams: result.teams.map(({ membershipMfaEnabled: _membershipMfaEnabled, teamMfaVersion: _teamMfaVersion, isRoot: _isRoot, ...team }) => team) };
    },

    async select(rawInput: unknown, context: ToolContext) {
      const input = teamSelectInputSchema.parse(rawInput);
      const user = actor(context);
      const listed = await list(user.key);
      if (!listed.enabled) throw new TeamServiceError('FORBIDDEN', 'Team selection is not enabled for this account.');
      const option = listed.teams.find(({ key }) => key === input.targetTeamKey);
      if (!option) throw new TeamServiceError('FORBIDDEN', 'Active team membership is required.');
      const targetScopeKey = input.targetScopeKey ?? option.currentScopeKey ?? option.defaultScopeKey;
      if (!targetScopeKey) throw new TeamServiceError('FORBIDDEN', 'Active target scope membership is required.');
      if (!option.scopes.some(({ key }) => key === targetScopeKey)) throw new TeamServiceError('FORBIDDEN', 'Active target scope membership is required.');
      const assured = context.teamAssurance?.teamMembershipKey === option.teamMembershipKey;
      const assuranceCurrent = assured && context.teamAssurance?.teamMfaVersion === option.teamMfaVersion;
      if (option.mfaEnabled && !assuranceCurrent) {
        const result = await challenge(
          loginIdentityTypeForMembership(option.role as z.infer<typeof userTeamSchema>['teamRole'], option.isRoot),
          user.key,
          option.teamMembershipKey,
          option.isRoot && option.membershipMfaEnabled ? 'founder_totp' : option.isRoot ? 'founder_setup' : 'totp',
          targetScopeKey,
        );
        if (!result) throw new TeamServiceError('MFA_UNAVAILABLE', 'Team MFA challenge could not be created.');
        return {
          status: result.status === 'totp_setup_required' ? 'setup_required' as const : 'totp_required' as const,
          teamKey: option.key,
          scopeKey: targetScopeKey,
          challengeToken: result.totpChallengeToken,
          expiresAt: result.expiresAt.toISOString(),
        };
      }
      const selected = await select(user.key, option.key, targetScopeKey);
      return {
        status: 'selected' as const,
        team: { key: selected.team.key, name: selected.team.name, slug: selected.team.slug, role: selected.membership.teamRole, mfaEnabled: selected.team.mfa_enabled },
        scope: { key: selected.scope.key, name: selected.scope.name, slug: selected.scope.slug },
      };
    },
  };
}

export type TeamService = ReturnType<typeof createTeamService>;
export const teamService = createTeamService();
