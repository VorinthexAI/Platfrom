import type { Context } from 'hono';
import { verifyAccessToken } from './auth';

export async function getUserId(c: Context) {
  const refreshedUserId = c.get('userId');
  if (typeof refreshedUserId === 'string') return refreshedUserId;

  const auth = c.req.header('authorization');
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  return verifyAccessToken(token);
}
