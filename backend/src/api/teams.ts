import type { Context } from 'hono';
import { ZodError } from 'zod';
import { getPersonalAuthContext, provisionPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserById } from '@/lib/db/users.node';
import { teamListInputSchema, teamSelectInputSchema, teamService, TeamServiceError, type TeamService } from '@/lib/teams';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { getAuthIdentity } from './security';
import { teamAssurance, type AuthIdentity } from './auth';
import { parseJson, strictObject } from './validation';

export const teamHttpListInputSchema = strictObject({});
export const teamHttpSelectInputSchema = strictObject({ ...teamSelectInputSchema.shape });

export interface TeamHandlerDependencies {
  service?: TeamService;
  getIdentity?: typeof getAuthIdentity;
  resolveContext?: (identity: AuthIdentity) => Promise<ToolContext>;
}

async function defaultContext(identity: AuthIdentity): Promise<ToolContext> {
  const user = await getUserById(identity.key);
  if (!user?.isVerified) throw new TeamServiceError('FORBIDDEN', 'Verified authentication is required.');
  const selected = await getPersonalAuthContext(user.key) ?? await provisionPersonalAuthContext(user);
  return {
    teamKey: selected.team.key,
    runtimeScopeKey: selected.scope.key,
    principal: { kind: 'member', user, userTeam: selected.membership, scopeMember: selected.scopeMembership },
    teamAssurance: teamAssurance(identity),
  };
}

export function createTeamHandlers(dependencies: TeamHandlerDependencies = {}) {
  const service = dependencies.service ?? teamService;
  const invoke = (operation: 'list' | 'select') => async (c: Context) => {
    const identity = await (dependencies.getIdentity ?? getAuthIdentity)(c);
    if (!identity) return c.json({ success: false, error: { code: 'TEAM_UNAUTHORIZED', message: 'Authentication required.' } }, 401);
    try {
      const input = await parseJson(c, operation === 'list' ? teamHttpListInputSchema : teamHttpSelectInputSchema);
      const context = await (dependencies.resolveContext ?? defaultContext)(identity);
      const result = operation === 'list'
        ? await service.list(teamListInputSchema.parse(input), context)
        : await service.select(teamSelectInputSchema.parse(input), context);
      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof TeamServiceError) {
        const status = error.code === 'MFA_UNAVAILABLE' ? 503 : error.code === 'NOT_FOUND' ? 404 : 403;
        return c.json({ success: false, error: { code: `TEAM_${error.code}`, message: error.message } }, status);
      }
      if (error instanceof ZodError || error instanceof SyntaxError) return c.json({ success: false, error: { code: 'TEAM_INVALID_INPUT', message: 'Team request input was invalid.' } }, 400);
      throw error;
    }
  };
  return { list: invoke('list'), select: invoke('select') };
}

export const teamHandlers = createTeamHandlers();
