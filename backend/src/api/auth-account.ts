import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserById } from '@/lib/db/users.node';
import { getAuthIdentity } from './security';
import { revokeRefreshSession, revokeSession } from './auth';
import { clearSessionCookies, getSelectedRefreshToken, REFRESH_COOKIE } from './middleware';

export function buildAuthAccountResponse(
  user: NonNullable<Awaited<ReturnType<typeof getUserById>>>,
  context: NonNullable<Awaited<ReturnType<typeof getPersonalAuthContext>>>,
) {
  return {
    user: {
      key: user.key,
      email: user.email,
      name: user.name,
      profile_url: user.profileUrl,
      alias: user.alias,
      alias_slug: user.alias_slug,
      country_code: user.countryCode,
    },
    organization: {
      key: context.organization.key,
      name: context.organization.name,
      slug: context.organization.slug,
      role: context.membership.orgRole,
      membership_key: context.membership.key,
    },
    main_scope: {
      key: context.scope.key,
      name: context.scope.name,
      slug: context.scope.slug,
      role: context.scopeMembership.role,
      membership_key: context.scopeMembership.key,
    },
  };
}

export async function getAuthAccount(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ error: 'authentication required' }, 401);
  const user = await getUserById(identity.key);
  if (!user?.isVerified) return c.json({ error: 'verified authentication required' }, 403);
  const context = await getPersonalAuthContext(user.key);
  if (!context) return c.json({ error: 'personal organization is unavailable' }, 503);
  return c.json(buildAuthAccountResponse(user, context));
}

export async function logoutAuthAccount(c: Context) {
  const identity = await getAuthIdentity(c);
  const refreshToken = getSelectedRefreshToken(c) ?? c.req.header('x-refresh-token') ?? getCookie(c, REFRESH_COOKIE);
  if (identity) await revokeSession(identity, refreshToken);
  else if (refreshToken) await revokeRefreshSession(refreshToken);
  clearSessionCookies(c);
  return c.json({ ok: true });
}
