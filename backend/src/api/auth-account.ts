import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { getPersonalAuthContext, provisionPersonalAuthContext } from '@/lib/db/personal-auth-context.node';
import { getUserByEmailHash, getUserById, updateUser } from '@/lib/db/users.node';
import { sha256, timingSafeEqual } from '@/lib/crypto';
import { getAuthIdentity } from './security';
import { issueUserTokens, revokeRefreshSession, revokeSession } from './auth';
import { hashUserEmail, upsertUserByEmail } from './users';
import { camelSessionTokenPayload, clearSessionCookies, getSelectedRefreshToken, REFRESH_COOKIE, setSessionForRequest } from './middleware';
import { parseJson, strictObject } from './validation';
import { z } from 'zod';

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
      is_onboarded: user.isOnboarded,
      settings: user.settings,
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
    content_execution: {
      agent_key: context.agent.key,
    },
  };
}

export const guestBootstrapSchema = strictObject({
  distinctId: z.string().trim().min(20).max(80).regex(/^app_[A-Za-z0-9_-]+$/),
  bootstrapSecret: z.string().min(40).max(160).regex(/^guest_[A-Za-z0-9_-]+$/),
});

export async function bootstrapGuestAuth(c: Context) {
  const { distinctId, bootstrapSecret } = await parseJson(c, guestBootstrapSchema);
  const identityHash = await sha256(distinctId);
  const email = `guest.${identityHash.slice(0, 32)}@guest.vorinthex.com`;
  const bootstrapSecretHash = await sha256(bootstrapSecret);
  const existing = await getUserByEmailHash(await hashUserEmail(email));
  if (existing?.guestBootstrapSecretHash && !timingSafeEqual(existing.guestBootstrapSecretHash, bootstrapSecretHash)) {
    return c.json({ error: 'guest installation authentication failed' }, 401);
  }
  const user = existing
    ? existing.guestBootstrapSecretHash ? existing : await updateUser(existing.key, { guestBootstrapSecretHash: bootstrapSecretHash, updatedAt: new Date().toISOString() })
    : await upsertUserByEmail(email, {
      name: 'Vorinthex User', isVerified: true, is_subscribed_to_updates: false, guestBootstrapSecretHash: bootstrapSecretHash,
    });
  if (!user.guestBootstrapSecretHash || !timingSafeEqual(user.guestBootstrapSecretHash, bootstrapSecretHash)) {
    return c.json({ error: 'guest installation authentication failed' }, 401);
  }
  const context = await provisionPersonalAuthContext(user);
  const tokens = await issueUserTokens(user);
  setSessionForRequest(c, tokens);
  return c.json({
    ...buildAuthAccountResponse(user, context),
    ...camelSessionTokenPayload(c, tokens),
  }, 201);
}

export async function patchAuthAccount(c: Context) {
  const body = await parseJson(c, patchAuthAccountSchema);
  const identity = await getAuthIdentity(c);
  if (!identity || identity.identityType !== 'user') return c.json({ error: 'user authentication required' }, 401);
  const existing = await getUserById(identity.key);
  if (!existing?.isVerified) return c.json({ error: 'verified authentication required' }, 403);
  const context = await getPersonalAuthContext(existing.key) ?? await provisionPersonalAuthContext(existing);
  const user = existing.isOnboarded ? existing : await updateUser(existing.key, {
    isOnboarded: body.isOnboarded,
    updatedAt: new Date().toISOString(),
  });
  return c.json(buildAuthAccountResponse(user, context));
}

export const patchAuthAccountSchema = strictObject({ isOnboarded: z.literal(true) });

export async function getAuthAccount(c: Context) {
  const identity = await getAuthIdentity(c);
  if (!identity) return c.json({ error: 'authentication required' }, 401);
  const user = await getUserById(identity.key);
  if (!user?.isVerified) return c.json({ error: 'verified authentication required' }, 403);
  const context = await getPersonalAuthContext(user.key) ?? await provisionPersonalAuthContext(user);
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
