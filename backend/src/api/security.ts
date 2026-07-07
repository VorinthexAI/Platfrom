import type { Context } from 'hono';
import { verifyAccessToken, type AuthIdentity } from './auth';

export function getAuthIdentityFromContext(c: Context): AuthIdentity | null {
  const identity = c.get('authIdentity');
  if (identity && typeof identity === 'object' && 'key' in identity && 'identityType' in identity) {
    return identity as AuthIdentity;
  }
  const refreshedUserId = c.get('userId');
  if (typeof refreshedUserId === 'string') return { key: refreshedUserId, identityType: 'user' };
  return null;
}

export async function getAuthIdentity(c: Context): Promise<AuthIdentity | null> {
  const contextIdentity = getAuthIdentityFromContext(c);
  if (contextIdentity) return contextIdentity;
  const auth = c.req.header('authorization');
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return verifyAccessToken(token);
}

export async function getUserId(c: Context) {
  const identity = await getAuthIdentity(c);
  return identity?.identityType === 'user' ? identity.key : null;
}
