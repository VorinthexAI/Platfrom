import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { timingSafeEqual } from '@/lib/crypto';
import { isPolarWebhookPath } from './payments';
import { isResendWebhookPath } from './resend';
import { strictObject } from './validation';
import { rotateRefreshToken, verifyAccessToken, type AuthIdentity, type SessionTokens } from './auth';

export const ACCESS_COOKIE = 'vorinthex_access';
export const REFRESH_COOKIE = 'vorinthex_refresh';

function getClientIp(c: Parameters<MiddlewareHandler>[0]) {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
}

function getRequestApiKey(c: Parameters<MiddlewareHandler>[0]) {
  return c.req.header('x-vorinthex-api-key')
    ?? c.req.header('x-api-key')
    ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    // A browser's native WebSocket API cannot set custom headers on the
    // handshake, so the orchestrator chat socket accepts the same key via
    // a query param instead. Scoped to this one route only — every other
    // endpoint still requires the header.
    ?? (c.req.path === '/api/v1/orchestrators/chat/stream' ? c.req.query('api_key') : undefined);
}

function getBearerToken(c: Parameters<MiddlewareHandler>[0]) {
  return c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

function setAuthIdentity(c: Parameters<MiddlewareHandler>[0], identity: AuthIdentity) {
  c.set('authIdentity', identity);
  c.set('userId', identity.key);
}

function cookieOptions(maxAge: number) {
  const domain = process.env.COOKIE_DOMAIN;
  const crossSite = Boolean(domain);
  return {
    httpOnly: true,
    path: '/',
    sameSite: crossSite ? 'None' : 'Lax',
    secure: process.env.NODE_ENV === 'production' || crossSite,
    domain,
    maxAge,
  } as const;
}

export function setSessionCookies(c: Context, tokens: SessionTokens) {
  setCookie(c, ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.accessTokenMaxAgeSeconds));
  setCookie(c, REFRESH_COOKIE, tokens.refreshToken, cookieOptions(tokens.refreshTokenMaxAgeSeconds));
}

export function setSessionTokenHeaders(c: Context, tokens: SessionTokens) {
  c.header('X-Access-Token', tokens.accessToken);
  c.header('X-Refresh-Token', tokens.refreshToken);
  c.header('X-Access-Token-Max-Age', String(tokens.accessTokenMaxAgeSeconds));
  c.header('X-Refresh-Token-Max-Age', String(tokens.refreshTokenMaxAgeSeconds));
}

function querySchemaForPath(path: string) {
  const apiPath = path.replace(/^\/api\/v1(?=\/|$)/, '');
  if (apiPath === '/nodes') {
    return strictObject({
      node: z.string().optional(),
      limit: z.string().optional(),
      after: z.string().optional(),
    });
  }
  if (apiPath === '/updates/unsubscribe') {
    return strictObject({ token_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() });
  }
  if (apiPath === '/waitlist/verify') {
    return strictObject({
      token_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
      explorer_id: z.string().min(8).max(80).optional(),
    });
  }
  if (apiPath === '/auth/handoff/stream' || apiPath === '/auth/handoff/status') {
    return strictObject({ handoff: z.string().regex(/^[a-f0-9]{64}$/) });
  }
  if (apiPath === '/auth/oauth/start') {
    return strictObject({
      provider: z.enum(['google', 'apple']),
      redirect_uri: z.string().url(),
    });
  }
  if (apiPath === '/founders/events/stream') {
    return strictObject({ organizationKey: z.string().trim().min(1) });
  }
  if (apiPath === '/founders/artifacts' || apiPath === '/founders/artifacts/stream' || /^\/founders\/artifacts\/[^/]+$/.test(apiPath)) {
    return strictObject({ organizationKey: z.string().trim().min(1).optional(), scopeKey: z.string().cuid().optional() });
  }
  if (apiPath === '/fragments/summary') {
    return strictObject({
      explorer_id: z.string().optional(),
      format: z.string().optional(),
    });
  }
  if (apiPath === '/fragments/standing') {
    return strictObject({
      explorer_id: z.string().optional(),
    });
  }
  if (apiPath === '/orchestrators/chat/stream') {
    // A browser WebSocket handshake can't carry a header, so the API key
    // rides in here instead — see getRequestApiKey.
    return strictObject({ api_key: z.string().optional() });
  }
  return strictObject({});
}

export const validateQueryParams: MiddlewareHandler = async (c, next) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  querySchemaForPath(c.req.path).parse(query);
  return next();
};

export const requireEnvApiKey: MiddlewareHandler = async (c, next) => {
  // Provider webhooks authenticate via signature verification, not our API key.
  if (isPolarWebhookPath(c.req.path) || isResendWebhookPath(c.req.path)) return next();
  // Health checks are hit by Docker/Caddy probes that can't carry the API key.
  if (c.req.path === '/api/v1/health') return next();
  // Public frontend telemetry endpoint; still protected by CORS and IP rate limiting.
  if (c.req.path === '/api/v1/platform/events') return next();
  // Public waitlist event ingestion supports either auth or email_hash lookup in the route.
  if (c.req.path === '/api/v1/users/events') return next();
  // Public checkout creation supports either auth or email_hash lookup in the route.
  if (c.req.path === '/api/v1/payments/checkout') return next();
  // Public email verification must be callable from the frontend verification page.
  if (c.req.path === '/api/v1/waitlist/verify') return next();

  const expected = process.env.API_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return c.json({ error: 'API_KEY is not configured' }, 500);
    }
    return next();
  }

  const provided = getRequestApiKey(c);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return c.json({ error: 'api key required' }, 401);
  }

  return next();
};

export const requestLogger: MiddlewareHandler = async (c, next) => {
  if (c.req.path === '/api/v1/health') return next();

  const startedAt = Date.now();
  try {
    await next();
  } finally {
    console.info('request', {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      duration_ms: Date.now() - startedAt,
    });
  }
};

export const autoRefreshAuthTokens: MiddlewareHandler = async (c, next) => {
  const bearerToken = getBearerToken(c);
  const accessToken = bearerToken?.startsWith('vrtx_access_')
    ? bearerToken
    : getCookie(c, ACCESS_COOKIE);

  if (accessToken) {
    const identity = await verifyAccessToken(accessToken);
    if (identity) {
      setAuthIdentity(c, identity);
      return next();
    }
  }

  const cookieRefreshToken = getCookie(c, REFRESH_COOKIE);
  const headerRefreshToken = c.req.header('x-refresh-token');
  const refreshToken = cookieRefreshToken ?? headerRefreshToken;
  if (!refreshToken) return next();

  const tokens = await rotateRefreshToken(refreshToken);
  if (!tokens) return next();

  const refreshedIdentity = await verifyAccessToken(tokens.accessToken);
  if (refreshedIdentity) setAuthIdentity(c, refreshedIdentity);

  setSessionTokenHeaders(c, tokens);

  if (cookieRefreshToken) {
    setSessionCookies(c, tokens);
  }

  return next();
};

export const rateLimitByIp: MiddlewareHandler = async (c, next) => {
  // Provider webhook retries burst from a small IP pool; rate-limiting them
  // would drop or delay deliveries. The endpoint is protected by signatures.
  if (isPolarWebhookPath(c.req.path) || isResendWebhookPath(c.req.path)) return next();

  if (process.env.RATE_LIMIT_ENABLED !== 'true') return next();

  const limit = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? process.env.RATE_LIMIT_REQ_PER_MIN ?? 60);
  const windowSeconds = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
  if (!Number.isInteger(limit) || limit < 1) {
    return c.json({ error: 'RATE_LIMIT_MAX_REQUESTS must be a positive integer' }, 500);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return c.json({ error: 'RATE_LIMIT_WINDOW_SECONDS must be a positive integer' }, 500);
  }

  const ip = getClientIp(c);
  const key = `rate-limit:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

  try {
    const { redisConnection } = await import('@/lib/redis');
    const count = await redisConnection.incr(key);
    if (count === 1) await redisConnection.expire(key, windowSeconds + 10);

    c.header('X-RateLimit-Limit', String(limit));
    c.header('X-RateLimit-Remaining', String(Math.max(limit - count, 0)));

    if (count > limit) {
      c.header('Retry-After', String(windowSeconds));
      return c.json({ error: 'rate limit exceeded' }, 429);
    }
  } catch (error) {
    console.warn('rate limit check failed', error);
  }

  return next();
};
