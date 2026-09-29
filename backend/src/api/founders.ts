import type { Context } from 'hono';
import { z } from 'zod';
import {
  FoundersAccessError,
  listAccessibleTeams,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireTeamAccess,
  type FoundersGateAccess,
} from '@/lib/founders/access';
import { getAuthIdentity } from './security';

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
    if (!hasFounderAssurance(identity)) {
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

export async function getFoundersAccount(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  return c.json({ applicationRole: auth.founder.identityType });
}

export async function listFoundersTeams(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  return c.json({ teams: await listAccessibleTeams() });
}

export async function listFoundersTeamScopes(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const parsedKey = foundersTeamKeyParamSchema.safeParse(c.req.param('teamKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid team key' }, 400);
  try {
    await requireTeamAccess();
    return c.json({ scopes: await listAccessibleScopes() });
  } catch (error) {
    return forbidden(c, error);
  }
}
