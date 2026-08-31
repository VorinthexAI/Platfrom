import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { timingSafeEqual } from '@/lib/crypto';
import { isResendWebhookPath } from './resend';
import { isGmailWebhookPath } from './email-webhook';
import { strictObject } from './validation';
import { refreshAccessToken, refreshTokenMatchesIdentity, verifyAccessToken, type AuthIdentity, type SessionTokens } from './auth';

export const ACCESS_COOKIE = 'vorinthex_access';
export const REFRESH_COOKIE = 'vorinthex_refresh';
export const HEADER_SESSION_TRANSPORT = 'header';

const PUBLIC_AUTH_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/guest',
  '/api/v1/auth/founders-gate',
  '/api/v1/auth/magic/validate',
  '/api/v1/auth/handoff/stream',
  '/api/v1/auth/handoff/status',
  '/api/v1/auth/handoff/claim',
  '/api/v1/auth/oauth/start',
  '/api/v1/auth/oauth/callback',
  '/api/v1/auth/mobile/oauth/exchange',
  '/api/v1/auth/mobile/google',
  '/api/v1/auth/mobile/apple',
  '/api/v1/auth/totp/reset/request',
  '/api/v1/auth/totp/setup/start',
  '/api/v1/auth/totp/setup/complete',
  '/api/v1/auth/totp/verify',
]);
const isProviderWebhookPath = (path: string) => isResendWebhookPath(path) || isGmailWebhookPath(path);
export const isPublicBookSharePath = (path: string) => /^\/api\/v1\/public\/books\/shares\/(read|stream)\/?$/.test(path);

export function isPublicFounderAuthPath(path: string) {
  return PUBLIC_AUTH_PATHS.has(path.replace(/\/$/, ''))
    || /^\/api\/v1\/auth\/mobile\/oauth\/(google|apple)(?:\/callback)?$/.test(path.replace(/\/$/, ''));
}

function getClientIp(c: Parameters<MiddlewareHandler>[0]) {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'unknown';
}

function getRequestApiKey(c: Parameters<MiddlewareHandler>[0]) {
  return c.req.header('x-vorinthex-api-key')
    ?? c.req.header('x-api-key');
}

function getBearerToken(c: Parameters<MiddlewareHandler>[0]) {
  return c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

function setAuthIdentity(c: Parameters<MiddlewareHandler>[0], identity: AuthIdentity) {
  c.set('authIdentity', identity);
  c.set('userId', identity.key);
}

function cookieOptions(maxAge: number) {
  // Root-scope sessions keep authentication available across the apex site.
  // The web bridge uses the same production fallback when it persists a rotation.
  const domain = process.env.COOKIE_DOMAIN ?? (process.env.NODE_ENV === 'production' ? 'vorinthex.com' : undefined);
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: process.env.NODE_ENV === 'production' || Boolean(domain),
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

function usesHeaderSessionTransport(c: Context) {
  return c.get('authSessionTransport') === HEADER_SESSION_TRANSPORT
    || (c.req.header('x-vorinthex-session-transport') === HEADER_SESSION_TRANSPORT && !c.req.header('origin'));
}

export function setSessionForRequest(c: Context, tokens: SessionTokens) {
  if (usesHeaderSessionTransport(c)) setSessionTokenHeaders(c, tokens);
  else setSessionCookies(c, tokens);
}

export function sessionTokenPayload(c: Context, tokens: SessionTokens) {
  return usesHeaderSessionTransport(c) ? {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    access_token_max_age_seconds: tokens.accessTokenMaxAgeSeconds,
    refresh_token_max_age_seconds: tokens.refreshTokenMaxAgeSeconds,
    session_expires_at: tokens.sessionExpiresAt,
  } : {};
}

export function camelSessionTokenPayload(c: Context, tokens: SessionTokens) {
  return usesHeaderSessionTransport(c) ? {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accessTokenMaxAgeSeconds: tokens.accessTokenMaxAgeSeconds,
    refreshTokenMaxAgeSeconds: tokens.refreshTokenMaxAgeSeconds,
    sessionExpiresAt: tokens.sessionExpiresAt,
  } : {};
}

export function getSelectedRefreshToken(c: Context) {
  const selected = c.get('authRefreshToken');
  return typeof selected === 'string' ? selected : null;
}

export function clearSessionCookies(c: Context) {
  const options = cookieOptions(0);
  deleteCookie(c, ACCESS_COOKIE, options);
  deleteCookie(c, REFRESH_COOKIE, options);
}

function querySchemaForPath(path: string, method: string) {
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
  if (apiPath === '/auth/handoff/stream' || apiPath === '/auth/handoff/status') {
    return strictObject({ handoff: z.string().regex(/^[a-f0-9]{64}$/) });
  }
  if (apiPath === '/auth/oauth/start') {
    return strictObject({
      provider: z.enum(['google', 'apple']),
      redirect_uri: z.string().url(),
    });
  }
  if (/^\/auth\/mobile\/oauth\/(google|apple)$/.test(apiPath)) {
    return strictObject({ redirect_uri: z.string().url() });
  }
  if (/^\/auth\/mobile\/oauth\/(google|apple)\/callback$/.test(apiPath)) {
    return strictObject({
      code: z.string().min(1).optional(), state: z.string().min(1).optional(), error: z.string().optional(), scope: z.string().optional(), authuser: z.string().optional(), prompt: z.string().optional(), hd: z.string().optional(), error_description: z.string().optional(), error_subtype: z.string().optional(),
    });
  }
  if (apiPath === '/email/connectors/gmail/callback') {
    return strictObject({ code: z.string().min(1).optional(), state: z.string().min(1), error: z.string().optional(), scope: z.string().optional(), authuser: z.string().optional(), prompt: z.string().optional(), hd: z.string().optional(), error_description: z.string().optional(), error_subtype: z.string().optional(), session_state: z.string().optional() });
  }
  if (/^\/founders\/organizations\/[^/]+\/communication\/channels\/[^/]+\/messages$/.test(apiPath)) {
    return strictObject({ limit: z.string().regex(/^\d+$/).optional() });
  }
  if (method === 'DELETE' && apiPath === '/auth/me/hiddens') return strictObject({ source: z.enum(['collection', 'document', 'image', 'folder']), sourceKey: z.string().cuid() });
  if (method === 'GET' && apiPath === '/gallery/highlights') return strictObject({ organizationKey: z.string(), scopeKey: z.string(), collectionKey: z.string() });
  if (method === 'GET' && apiPath === '/gallery/memories') return strictObject({ organizationKey: z.string(), scopeKey: z.string(), collectionKey: z.string() });
  if (method === 'GET' && apiPath === '/images/generation-history') return strictObject({ organizationKey: z.string().trim().min(1), scopeKey: z.string().cuid(), limit: z.string().regex(/^\d+$/).optional() });
  if (/^\/content\/tools\/[^/]+$/.test(apiPath)) return strictObject({});
  if (method === 'GET' && apiPath === '/public/books/shares/stream') return strictObject({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) });
  if (apiPath === '/books' || apiPath === '/books/overview' || apiPath === '/books/topic-suggestions' || apiPath === '/books/goal-suggestions' || /^\/books\/[^/]+(?:\/detail|\/(?:retry|cancel|favorite)|\/share\/(?:detail|update))?$/.test(apiPath) || /^\/books\/[^/]+\/chapters\/[^/]+\/progress$/.test(apiPath)) return strictObject({});
  return strictObject({});
}

export const validateQueryParams: MiddlewareHandler = async (c, next) => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams);
  querySchemaForPath(c.req.path, c.req.method).parse(query);
  return next();
};

export const requireEnvApiKey: MiddlewareHandler = async (c, next) => {
  // Provider webhooks authenticate via signature verification, not our API key.
  if (isProviderWebhookPath(c.req.path)) return next();
  // Health checks are hit by Docker/Caddy probes that can't carry the API key.
  if (c.req.path === '/api/v1/health') return next();
  // Guest bootstrap creates a revocable per-install session and is protected by
  // the public-auth Redis rate limit rather than an extractable mobile secret.
  if (c.req.path.replace(/\/$/, '') === '/api/v1/auth/guest') return next();
  // OAuth providers redirect here directly and cannot attach application headers.
  if (/^\/api\/v1\/auth\/mobile\/oauth\/(google|apple)\/callback\/?$/.test(c.req.path)) return next();
  if (/^\/api\/v1\/email\/connectors\/gmail\/callback\/?$/.test(c.req.path)) return next();
  if (isPublicBookSharePath(c.req.path)) return next();
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

interface AutoRefreshDependencies {
  verifyAccessToken: typeof verifyAccessToken;
  refreshAccessToken: typeof refreshAccessToken;
  refreshTokenMatchesIdentity?: typeof refreshTokenMatchesIdentity;
}

export function createAutoRefreshAuthTokens(dependencies: AutoRefreshDependencies = {
  verifyAccessToken,
  refreshAccessToken,
  refreshTokenMatchesIdentity,
}): MiddlewareHandler {
  return async (c, next) => {
    const bearerToken = getBearerToken(c);
    const headerRefreshToken = c.req.header('x-refresh-token');
    const cookieAccessToken = getCookie(c, ACCESS_COOKIE);
    const cookieRefreshToken = getCookie(c, REFRESH_COOKIE);
    const browserOrigin = Boolean(c.req.header('origin'));
    const explicitHeaderTransport = c.req.header('x-vorinthex-session-transport') === HEADER_SESSION_TRANSPORT && !browserOrigin;
    const hasHeaderCredentials = Boolean(bearerToken || headerRefreshToken);
    const hasCookieCredentials = Boolean(cookieAccessToken || cookieRefreshToken);
    if (!browserOrigin && !explicitHeaderTransport && hasHeaderCredentials && hasCookieCredentials) {
      return c.json({ error: 'ambiguous authentication credentials', code: 'AUTH_TRANSPORT_AMBIGUOUS' }, 400);
    }
    const headerTransport = !browserOrigin && (explicitHeaderTransport || (hasHeaderCredentials && !hasCookieCredentials));
    const accessToken = headerTransport ? bearerToken : cookieAccessToken;
    const refreshToken = headerTransport ? headerRefreshToken : cookieRefreshToken;
    const hadSessionCredentials = Boolean(accessToken || refreshToken);
    c.set('authSessionTransport', headerTransport ? HEADER_SESSION_TRANSPORT : 'cookie');
    if (refreshToken) c.set('authRefreshToken', refreshToken);

    // Public authentication handlers issue their own session and only need the
    // selected response transport; stale credentials must not block sign-in.
    if (isPublicFounderAuthPath(c.req.path) || isPublicBookSharePath(c.req.path) || c.req.path === '/api/v1/health' || isProviderWebhookPath(c.req.path)) {
      return next();
    }

    const identity = accessToken ? await dependencies.verifyAccessToken(accessToken) : null;
    if (identity) {
      if (refreshToken && dependencies.refreshTokenMatchesIdentity
        && !await dependencies.refreshTokenMatchesIdentity(refreshToken, identity)) {
        if (!headerTransport) clearSessionCookies(c);
        c.header('WWW-Authenticate', 'Bearer');
        return c.json({ error: 'session credentials do not match', code: 'AUTH_SESSION_MISMATCH' }, 401);
      }
      setAuthIdentity(c, identity);
      return next();
    }

    const continueWithoutIdentity = async () => {
      await next();
      if (hadSessionCredentials && c.res.status === 401) {
        if (!headerTransport) clearSessionCookies(c);
        c.header('WWW-Authenticate', 'Bearer');
      }
    };
    if (!refreshToken) return continueWithoutIdentity();

    const tokens = await dependencies.refreshAccessToken(refreshToken);
    if (!tokens) return continueWithoutIdentity();

    const refreshedIdentity = await dependencies.verifyAccessToken(tokens.accessToken);
    if (!refreshedIdentity) return continueWithoutIdentity();
    setAuthIdentity(c, refreshedIdentity);

    if (!/^\/api\/v1\/auth\/logout\/?$/.test(c.req.path)) setSessionForRequest(c, tokens);

    return next();
  };
}

export const autoRefreshAuthTokens = createAutoRefreshAuthTokens();

export const rateLimitByIp: MiddlewareHandler = async (c, next) => {
  // Provider webhook retries burst from a small IP pool; rate-limiting them
  // would drop or delay deliveries. The endpoint is protected by signatures.
  if (isProviderWebhookPath(c.req.path)) return next();

  const authPath = isPublicFounderAuthPath(c.req.path);
  const publicBookShare = isPublicBookSharePath(c.req.path);
  if (!authPath && !publicBookShare && process.env.RATE_LIMIT_ENABLED !== 'true') return next();
  const handoffRead = /^\/api\/v1\/auth\/handoff\/(stream|status)\/?$/.test(c.req.path);

  const limit = publicBookShare
    ? 60
    : handoffRead
    ? 120
    : authPath
      ? 20
    : Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? process.env.RATE_LIMIT_REQ_PER_MIN ?? 60);
  const windowSeconds = authPath
    ? 5 * 60
    : Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60);
  if (!Number.isInteger(limit) || limit < 1) {
    return c.json({ error: 'RATE_LIMIT_MAX_REQUESTS must be a positive integer' }, 500);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    return c.json({ error: 'RATE_LIMIT_WINDOW_SECONDS must be a positive integer' }, 500);
  }

  const ip = getClientIp(c);
  const bucket = publicBookShare ? 'public-book-share' : handoffRead ? 'auth-handoff-read' : authPath ? 'auth' : 'global';
  const key = `rate-limit:${bucket}:${ip}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;

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
    if (authPath || publicBookShare) return c.json({ error: 'service temporarily unavailable' }, 503);
  }

  return next();
};
