import type { Context } from 'hono';
import { z } from 'zod';
import {
  FoundersAccessError,
  listAccessibleOrganizations,
  listAccessibleScopes,
  requireFoundersGateAccess,
  requireOrganizationAccess,
  requireScopeAccess,
  type FoundersGateAccess,
} from '@/lib/founders/access';
import { getAuthIdentity } from './security';
import { getOrchestratorById } from '@/lib/db/orchestrators.node';

/**
 * Founders Gate: the founder-facing surface. Every handler independently
 * re-resolves the authenticated user and verifies root-organization,
 * organization, and scope access from canonical database state — the
 * frontend's route guard is presentation only. Client payloads may name an
 * organization, a scope, and a message; user, agent, model, provider, role,
 * and permission resolution is exclusively server-side.
 */

export const foundersOrganizationKeyParamSchema = z.string().trim().min(1).max(160);


export type FounderContext = FoundersGateAccess & { identityType: 'user' | 'member' | 'superAdmin' };

export function hasFounderAssurance(
  identity: { founderAssured?: boolean; founderMembershipKey?: string; founderMfaVersion?: number } | null,
  membership?: { key: string; isMfaEnabled: boolean; mfaVersion: number },
) {
  if (identity?.founderAssured !== true) return false;
  if (!membership) return true;
  return membership.isMfaEnabled
    && identity.founderMembershipKey === membership.key
    && identity.founderMfaVersion === membership.mfaVersion;
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
    const message = error.code === 'scope_forbidden' ? 'scope access denied' : 'organization access denied';
    return c.json({ error: message }, 403);
  }
  throw error;
}

/** GET /founders/me — identity and role data for the account surface. */
export async function getFoundersAccount(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const { user, rootOrganization, rootMembership, identityType } = auth.founder;
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
    rootOrganization: {
      key: rootOrganization.key,
      name: rootOrganization.name,
      alias: rootOrganization.slug ?? null,
    },
    rootMembership: {
      role: rootMembership.orgRole,
      title: rootMembership.orgTitle,
      orchestrator: orchestrator ? { key: orchestrator.key, slug: orchestrator.name.toLowerCase() } : null,
    },
    applicationRole: identityType,
  });
}

/** GET /founders/organizations — organizations the founder already belongs to. */
export async function listFoundersOrganizations(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const organizations = await listAccessibleOrganizations(auth.founder.user.key);
  return c.json({ organizations });
}

/** GET /founders/organizations/:organizationKey/scopes — accessible scopes inside one organization. */
export async function listFoundersOrganizationScopes(c: Context) {
  const auth = await requireFounder(c);
  if ('error' in auth) return auth.error;
  const parsedKey = foundersOrganizationKeyParamSchema.safeParse(c.req.param('organizationKey'));
  if (!parsedKey.success) return c.json({ error: 'invalid organization key' }, 400);
  try {
    const { membership } = await requireOrganizationAccess(auth.founder.user.key, parsedKey.data);
    const scopes = await listAccessibleScopes(membership);
    return c.json({ scopes });
  } catch (error) {
    return forbidden(c, error);
  }
}
