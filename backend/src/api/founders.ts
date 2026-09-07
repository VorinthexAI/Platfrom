import type { Context } from 'hono';
import { z } from 'zod';
import {
  FoundersAccessError,
  listAccessibleTeams,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireTeamAccess,
  requireScopeAccess,
  type FoundersGateAccess,
} from '@/lib/founders/access';
import { getAuthIdentity } from './security';
import { getOrchestratorById } from '@/lib/db/orchestrators.node';

/**
 * Founders Gate: the founder-facing surface. Every handler independently
 * re-resolves the authenticated user and verifies root-team,
 * team, and scope access from canonical database state — the
 * frontend's route guard is presentation only. Client payloads may name an
 * team, a scope, and a message; user, agent, model, provider, role,
 * and permission resolution is exclusively server-side.
 */

export const foundersTeamKeyParamSchema = z.string().trim().min(1).max(160);


export type FounderContext = FoundersGateAccess & { identityType: 'user' | 'member' | 'superAdmin' };

export function hasFounderAssurance(
  identity: { founderAssured?: boolean; teamMembershipKey?: string; teamMfaVersion?: number } | null,
  membership?: { key: string; isMfaEnabled: boolean; teamMfaVersion: number },
) {
  if (identity?.founderAssured !== true) return false;
  if (!membership) return true;
  return membership.isMfaEnabled
    && identity.teamMembershipKey === membership.key
    && identity.teamMfaVersion === membership.teamMfaVersion;
}

export async function requireFounder(c: Context): Promise<{ founder: FounderContext } | { error: Response }> {
  const identity = await getAuthIdentity(c);
  if (!identity) return { error: c.json({ error: 'authentication required' }, 401) };
  try {
    const access = await requireFoundersGateAccess(identity.key);
    if (!hasFounderAssurance(identity, access.rootMembership)) {
      return { error: c.json({ error: 'founder MFA authentication required' }, 403) };
    }
    return { founder: { ...access, identityType: identity.identityType } };
  } catch (error) {
    if (error instanceof FoundersAccessError) {
      return { error: c.json({ error: 'founders gate access required' }, 403) };
    }
    throw error;
  }
}

export function forbidden(c: Context, error: unknown): Response {
  if (error instanceof FoundersAccessError) {
    const message = error.code === 'scope_forbidden' ? 'scope access denied' : 'team access denied';
    return c.json({ error: message }, 403);
  }
  throw error;
}

/** GET /founders/me — identity and role data for the account surface. */
export async function getFoundersAccount(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const { user, rootTeam, rootMembership, identityType } = auth.founder;
  const orchestrator = rootMembership.orchestratorKey
    ? await getOrchestratorById(rootMembership.orchestratorKey)
    : null;
  return c.json({
    user: {
      key: user.key,
      name: user.name,
      alias: user.alias,
      email: user.email,
      countryCode: user.countryCode,
    },
    rootTeam: {
      key: rootTeam.key,
      name: rootTeam.name,
      alias: rootTeam.slug ?? null,
    },
    rootMembership: {
      role: rootMembership.teamRole,
      title: rootMembership.teamTitle,
      orchestrator: orchestrator ? { key: orchestrator.key, slug: orchestrator.name.toLowerCase() } : null,
    },
    applicationRole: identityType,
  });
}

/** GET /founders/teams — teams the founder already belongs to. */
export async function listFoundersTeams(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const teams = await listAccessibleTeams(auth.founder.user.key);
  return c.json({ teams });
}

/** GET /founders/teams/:teamKey/scopes — accessible scopes inside one team. */
export async function listFoundersTeamScopes(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const parsedKey = foundersTeamKeyParamSchema.safeParse(c.req.param('teamKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid team key' }, 400);
  try {
    const { membership } = await requireTeamAccess(auth.founder.user.key, parsedKey.data);
    const scopes = await listAccessibleScopes(membership);
    return c.json({ scopes });
  } catch (error) {
    return forbidden(c, error);
  }
}
