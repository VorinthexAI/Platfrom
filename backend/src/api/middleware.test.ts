import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { FOUNDER_ACCESS_MAX_AGE_SECONDS, FOUNDER_REFRESH_MAX_AGE_SECONDS } from './auth';
import { isResendWebhookPath } from './resend';
import { isGmailWebhookPath } from './email-webhook';
import { createAutoRefreshAuthTokens, createBindEventApp, isPublicBookSharePath, isPublicFounderAuthPath, rateLimitByIp, requireEnvApiKey, sessionTokenPayload, setSessionCookies, setSessionForRequest, setSessionTokenHeaders, validateQueryParams } from './middleware';
import { currentEventAppKey } from '@/lib/ai/events/runtime';
import { APP_KEYS } from '@/lib/apps/registry';

function middlewareContext(path: string, headers: Record<string, string> = {}, search = '', method = 'GET') {
  return {
    req: {
      method,
      path,
      header(name: string) {
        return headers[name.toLowerCase()];
      },
      url: `https://api.example.com${path}${search}`,
    },
    header() {},
    json(payload: unknown, status = 200) {
      return new Response(JSON.stringify(payload), { status });
    },
  } as any;
}

describe('application key middleware', () => {
  const bindEventApp = createBindEventApp(async (key) => key === APP_KEYS.GALLERY || key === APP_KEYS.CORE);
  test('binds a valid app key for the full request', async () => {
    let appKey: string | undefined;
    await bindEventApp(middlewareContext('/api/v1/app/search', { 'x-vorinthex-app-key': ` ${APP_KEYS.GALLERY} ` }), async () => { appKey = currentEventAppKey(); });
    expect(appKey).toBe(APP_KEYS.GALLERY);
  });

  test('defaults missing headers to Core and rejects malformed or unknown keys', async () => {
    let appKey: string | undefined;
    await bindEventApp(middlewareContext('/api/v1/app/search'), async () => { appKey = currentEventAppKey(); });
    expect(appKey).toBe(APP_KEYS.CORE);
    expect((await bindEventApp(middlewareContext('/api/v1/app/search', { 'x-vorinthex-app-key': 'other' }), async () => undefined))?.status).toBe(400);
    expect((await bindEventApp(middlewareContext('/api/v1/app/search', { 'x-vorinthex-app-key': APP_KEYS.ARCHIVE }), async () => undefined))?.status).toBe(400);
    let legacyHeaderAppKey: string | undefined;
    await bindEventApp(middlewareContext('/api/v1/app/search', { 'x-vorinthex-domain': 'gallery' }), async () => { legacyHeaderAppKey = currentEventAppKey(); });
    expect(legacyHeaderAppKey).toBe(APP_KEYS.CORE);
  });

  test('does not query the registry when defaulting trusted and backward clients to Core', async () => {
    const bindDefault = createBindEventApp(async () => { throw new Error('must not query'); });
    let appKey: string | undefined;
    await bindDefault(middlewareContext('/api/v1/app/search'), async () => { appKey = currentEventAppKey(); });
    expect(appKey).toBe(APP_KEYS.CORE);
  });

  test('does not look up apps for health or the public registry', async () => {
    const exempt = createBindEventApp(async () => { throw new Error('must not query'); });
    for (const path of ['/api/v1/health', '/api/v1/apps']) await exempt(middlewareContext(path), async () => undefined);
  });
});

describe('api middleware webhook exemptions', () => {
  test('recognizes only the v1 Resend webhook path', () => {
    expect(isResendWebhookPath('/api/webhooks/resend')).toBe(false);
    expect(isResendWebhookPath('/api/webhooks/resend/')).toBe(false);
    expect(isResendWebhookPath('/api/v1/webhooks/resend')).toBe(true);
    expect(isResendWebhookPath('/api/v1/webhooks/resend/')).toBe(true);
    expect(isResendWebhookPath('/api/webhooks/resend')).toBe(false);
  });

  test('recognizes only the v1 Gmail Pub/Sub path', () => {
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub')).toBe(true);
    expect(isGmailWebhookPath('/api/v1/webhooks/gmail/pubsub/')).toBe(true);
    expect(isGmailWebhookPath('/api/webhooks/gmail/pubsub')).toBe(false);
  });

  test('does not require the global API key for provider webhooks', async () => {
    const previousApiKey = process.env.API_KEY;
    process.env.API_KEY = 'server-key';
    let nextCalls = 0;

    try {
      for (const path of ['/api/v1/webhooks/resend', '/api/v1/webhooks/resend/', '/api/v1/webhooks/gmail/pubsub', '/api/v1/webhooks/gmail/pubsub/']) {
        await requireEnvApiKey(middlewareContext(path), async () => {
          nextCalls += 1;
        });
      }
      expect(nextCalls).toBe(4);
    } finally {
      if (previousApiKey === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = previousApiKey;
    }
  });

  test('does not rate limit provider webhooks', async () => {
    const previousRateLimitEnabled = process.env.RATE_LIMIT_ENABLED;
    process.env.RATE_LIMIT_ENABLED = 'true';

    let nextCalls = 0;

    try {
      for (const path of ['/api/v1/webhooks/resend', '/api/v1/webhooks/gmail/pubsub']) await rateLimitByIp(middlewareContext(path), async () => { nextCalls += 1; });

      expect(nextCalls).toBe(2);
    } finally {
      if (previousRateLimitEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
    }
  });
});

describe('public book share middleware', () => {
  test('exempts only exact read and stream paths from the API key and validates stream query strictly', async () => {
    expect(isPublicBookSharePath('/api/v1/public/books/shares/read')).toBe(true);
    expect(isPublicBookSharePath('/api/v1/public/books/shares/stream/')).toBe(true);
    expect(isPublicBookSharePath('/api/v1/public/books/shares/other')).toBe(false);
    const previousApiKey = process.env.API_KEY; process.env.API_KEY = 'server-key'; let calls = 0;
    try {
      await requireEnvApiKey(middlewareContext('/api/v1/public/books/shares/read', {}, '', 'POST'), async () => { calls += 1; });
      expect(calls).toBe(1);
      await expect(validateQueryParams(middlewareContext('/api/v1/public/books/shares/stream', {}, `?token=${'A'.repeat(43)}&forged=true`), async () => {})).rejects.toBeDefined();
      await expect(validateQueryParams(middlewareContext('/api/v1/public/books/shares/stream', {}, `?token=${'A'.repeat(43)}`), async () => {})).resolves.toBeUndefined();
    } finally { if (previousApiKey === undefined) delete process.env.API_KEY; else process.env.API_KEY = previousApiKey; }
  });

  test('does not let stale user-session credentials block share-token authentication', async () => {
    let verified = 0; let nextCalls = 0;
    const middleware = createAutoRefreshAuthTokens({
      verifyAccessToken: async () => { verified += 1; return null; },
      refreshAccessToken: async () => null,
    });
    const app = new Hono();
    app.use('*', middleware);
    app.post('/api/v1/public/books/shares/read', (c) => { nextCalls += 1; return c.json({ success: true }); });
    expect((await app.request('/api/v1/public/books/shares/read', { method: 'POST', headers: { authorization: 'Bearer stale' } })).status).toBe(200);
    expect(verified).toBe(0);
    expect(nextCalls).toBe(1);
  });
});

describe('mobile auth API-key protection', () => {
  test('classifies rate-limited auth endpoints but still requires their application key', async () => {
    expect(isPublicFounderAuthPath('/api/v1/auth/founders-gate')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/magic/validate/')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/totp/reset/request')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/founders/me')).toBe(false);
    expect(isPublicFounderAuthPath('/api/v1/auth/login')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/guest')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/handoff/claim')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/oauth/callback')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/mobile/oauth/google')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/mobile/google')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/mobile/apple')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/mobile/oauth/apple/callback')).toBe(true);
    expect(isPublicFounderAuthPath('/api/v1/auth/mobile/oauth/github')).toBe(false);

    const previousApiKey = process.env.API_KEY;
    process.env.API_KEY = 'server-key';
    let nextCalls = 0;
    try {
      const authResponse = await requireEnvApiKey(middlewareContext('/api/v1/auth/founders-gate'), async () => { nextCalls += 1; });
      await requireEnvApiKey(middlewareContext('/api/v1/auth/founders-gate', { 'x-vorinthex-api-key': 'server-key' }), async () => { nextCalls += 1; });
      await requireEnvApiKey(middlewareContext('/api/v1/auth/mobile/oauth/google/callback'), async () => { nextCalls += 1; });
      await requireEnvApiKey(middlewareContext('/api/v1/auth/guest'), async () => { nextCalls += 1; });
      const protectedResponse = await requireEnvApiKey(
        middlewareContext('/api/v1/founders/me'),
        async () => { nextCalls += 1; },
      );
      expect(authResponse?.status).toBe(401);
      expect(nextCalls).toBe(3);
      expect(protectedResponse?.status).toBe(401);
    } finally {
      if (previousApiKey === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = previousApiKey;
    }
  });

  test('requires the application key even with a verified user session', async () => {
    const previousApiKey = process.env.API_KEY;
    process.env.API_KEY = 'server-key';
    try {
      const buildApp = () => {
        const app = new Hono();
        app.use('*', requireEnvApiKey);
        app.use('*', createAutoRefreshAuthTokens({
          verifyAccessToken: async (token) => token === 'vrtx_access_valid'
            ? { key: 'user-1', identityType: 'user' as const, sessionId: 'session-1' }
            : null,
          refreshAccessToken: async () => null,
        }));
        app.get('/api/v1/private', (c) => c.json({ ok: true }));
        return app;
      };

      expect((await buildApp().request('/api/v1/private', { headers: { authorization: 'Bearer vrtx_access_valid' } })).status).toBe(401);
      expect((await buildApp().request('/api/v1/private', { headers: { authorization: 'Bearer vrtx_access_valid', 'x-vorinthex-api-key': 'server-key' } })).status).toBe(200);
      expect((await buildApp().request('/api/v1/private', { headers: { authorization: 'Bearer vrtx_access_invalid' } })).status).toBe(401);
      expect((await buildApp().request('/api/v1/private')).status).toBe(401);
    } finally {
      if (previousApiKey === undefined) delete process.env.API_KEY;
      else process.env.API_KEY = previousApiKey;
    }
  });
});

describe('validateQueryParams', () => {
  test('allows the OAuth start query params through the global whitelist', async () => {
    const redirectUri = encodeURIComponent('https://vorinthex.com/api/auth/oauth/google/callback');
    let nextCalls = 0;

    await validateQueryParams(
      middlewareContext('/api/v1/auth/oauth/start', {}, `?provider=google&redirect_uri=${redirectUri}`),
      async () => {
        nextCalls += 1;
      },
    );

    expect(nextCalls).toBe(1);
  });

  test('rejects unknown query params on the OAuth start path', async () => {
    let nextCalls = 0;

    await expect(
      validateQueryParams(
        middlewareContext('/api/v1/auth/oauth/start', {}, '?provider=google&redirect_uri=https%3A%2F%2Fvorinthex.com%2Fcb&extra=1'),
        async () => {
          nextCalls += 1;
        },
      ),
    ).rejects.toThrow();
    expect(nextCalls).toBe(0);
  });

  test('still rejects query params on paths without a whitelist entry', async () => {
    let nextCalls = 0;

    await expect(
      validateQueryParams(
        middlewareContext('/api/v1/auth/login', {}, '?provider=google'),
        async () => {
          nextCalls += 1;
        },
      ),
    ).rejects.toThrow();
    expect(nextCalls).toBe(0);
  });

  test('applies highlight selectors only to GET requests', async () => {
    let nextCalls = 0;
    await validateQueryParams(
      middlewareContext('/api/v1/gallery/highlights', {}, '?organizationKey=organization&scopeKey=scope&collectionKey=collection'),
      async () => { nextCalls += 1; },
    );
    await validateQueryParams(
      middlewareContext('/api/v1/gallery/highlights', {}, '', 'POST'),
      async () => { nextCalls += 1; },
    );
    expect(nextCalls).toBe(2);
  });

  test('allows strict generation-history selectors on GET requests', async () => {
    let nextCalls = 0;
    await validateQueryParams(
      middlewareContext('/api/v1/images/generation-history', {}, '?organizationKey=organization&scopeKey=cm0000000000000000000000&limit=20'),
      async () => { nextCalls += 1; },
    );
    await expect(validateQueryParams(
      middlewareContext('/api/v1/images/generation-history', {}, '?organizationKey=organization&scopeKey=cm0000000000000000000000&limit=20&userKey=forged'),
      async () => { nextCalls += 1; },
    )).rejects.toThrow();
    expect(nextCalls).toBe(1);
  });

  test('allows hidden-content selectors only on reveal requests', async () => {
    let nextCalls = 0;
    await validateQueryParams(
      middlewareContext('/api/v1/auth/me/hiddens', {}, '?source=image&sourceKey=cm0000000000000000000000', 'DELETE'),
      async () => { nextCalls += 1; },
    );
    await validateQueryParams(
      middlewareContext('/api/v1/auth/me/hiddens', {}, '', 'GET'),
      async () => { nextCalls += 1; },
    );
    await expect(validateQueryParams(
      middlewareContext('/api/v1/auth/me/hiddens', {}, '?source=image&sourceKey=cm0000000000000000000000', 'GET'),
      async () => { nextCalls += 1; },
    )).rejects.toThrow();
    expect(nextCalls).toBe(2);
  });

  test('does not retain a query whitelist for the removed orchestrator chat route', async () => {
    let nextCalls = 0;

    await expect(
      validateQueryParams(
        middlewareContext('/api/v1/orchestrators/chat', {}, '?orchestrator_slug=atlas'),
        async () => {
          nextCalls += 1;
        },
      ),
    ).rejects.toThrow();
    expect(nextCalls).toBe(0);
  });
});

describe('backend session cookies', () => {
  test('applies the backend-provided founder cookie lifetimes', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      setSessionCookies(c, { accessToken: 'access-token', refreshToken: 'refresh-token', accessTokenMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS, refreshTokenMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS, sessionExpiresAt: new Date(Date.now() + FOUNDER_REFRESH_MAX_AGE_SECONDS * 1000).toISOString() });
      return c.json({ ok: true });
    });

    const response = await app.request('/');
    const cookies = response.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('vorinthex_access=access-token');
    expect(cookies).toContain('vorinthex_refresh=refresh-token');
    expect(cookies).toContain(`vorinthex_access=access-token; Max-Age=${FOUNDER_ACCESS_MAX_AGE_SECONDS}`);
    expect(cookies).toContain(`vorinthex_refresh=refresh-token; Max-Age=${FOUNDER_REFRESH_MAX_AGE_SECONDS}`);
    expect(cookies).not.toContain('Max-Age=31536000');
  });

  test('returns the rotated token pair and remaining lifetimes to server-side bridges', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      setSessionTokenHeaders(c, {
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
        accessTokenMaxAgeSeconds: 900,
        refreshTokenMaxAgeSeconds: 43_200,
        sessionExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
      });
      return c.json({ ok: true });
    });

    const response = await app.request('/');
    expect(response.headers.get('x-access-token')).toBe('rotated-access');
    expect(response.headers.get('x-refresh-token')).toBe('rotated-refresh');
    expect(response.headers.get('x-access-token-max-age')).toBe('900');
    expect(response.headers.get('x-refresh-token-max-age')).toBe('43200');
  });

  test('refreshes an expired Nexus access token from its forwarded refresh token', async () => {
    const app = new Hono<{ Variables: { authIdentity: { key: string; identityType: 'user' | 'member' | 'superAdmin' }; userId: string } }>();
    const rotatedTokens = {
      accessToken: 'vrtx_access_rotated',
      refreshToken: 'vrtx_refresh_rotated',
      accessTokenMaxAgeSeconds: FOUNDER_ACCESS_MAX_AGE_SECONDS,
      refreshTokenMaxAgeSeconds: FOUNDER_REFRESH_MAX_AGE_SECONDS,
      sessionExpiresAt: new Date(Date.now() + FOUNDER_REFRESH_MAX_AGE_SECONDS * 1000).toISOString(),
    };
    const rotateCalls: string[] = [];

    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async (token) => token === rotatedTokens.accessToken
        ? { key: 'founder', identityType: 'superAdmin', founderAssured: true }
        : null,
      refreshAccessToken: async (token) => {
        rotateCalls.push(token);
        return token === 'vrtx_refresh_valid' ? rotatedTokens : null;
      },
    }));
    app.get('/', (c) => c.json({ identity: c.get('authIdentity') }));

    const response = await app.request('/', {
      headers: {
        authorization: 'Bearer vrtx_access_expired',
        'x-refresh-token': 'vrtx_refresh_valid',
      },
    });

    expect(rotateCalls).toEqual(['vrtx_refresh_valid']);
    expect(await response.json()).toEqual({ identity: { key: 'founder', identityType: 'superAdmin', founderAssured: true } });
    expect(response.headers.get('x-access-token')).toBe(rotatedTokens.accessToken);
    expect(response.headers.get('x-refresh-token')).toBe(rotatedTokens.refreshToken);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  test('does not refresh when the current mobile access token is valid', async () => {
    const app = new Hono();
    const tokens = {
      accessToken: 'vrtx_access_fresh',
      refreshToken: 'vrtx_refresh_same',
      accessTokenMaxAgeSeconds: 900,
      refreshTokenMaxAgeSeconds: 31_536_000,
      sessionExpiresAt: new Date(Date.now() + 31_536_000_000).toISOString(),
    };
    let refreshCalls = 0;
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async (token) => token === 'vrtx_access_current' || token === tokens.accessToken
        ? { key: 'user-1', identityType: 'user' as const, sessionId: 'session-1' }
        : null,
      refreshAccessToken: async (token) => {
        refreshCalls += 1;
        return token === tokens.refreshToken ? tokens : null;
      },
    }));
    app.get('/', (c) => c.json({ ok: true }));

    const response = await app.request('/', { headers: {
      authorization: 'Bearer vrtx_access_current',
      'x-refresh-token': tokens.refreshToken,
    } });
    expect(response.status).toBe(200);
    expect(refreshCalls).toBe(0);
    expect(response.headers.get('x-access-token')).toBeNull();
    expect(response.headers.get('x-refresh-token')).toBeNull();
  });

  test('keeps cookie refresh tokens in HttpOnly cookies', async () => {
    const app = new Hono<{ Variables: { userId: string } }>();
    const tokens = {
      accessToken: 'vrtx_access_cookie_rotated',
      refreshToken: 'vrtx_refresh_cookie_rotated',
      accessTokenMaxAgeSeconds: 900,
      refreshTokenMaxAgeSeconds: 43_200,
      sessionExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
    };
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async (token) => token === tokens.accessToken ? { key: 'cookie-user', identityType: 'user' as const } : null,
      refreshAccessToken: async (token) => token === 'vrtx_refresh_cookie' ? tokens : null,
    }));
    app.get('/', (c) => c.json({ userId: c.get('userId') }));

    const response = await app.request('/', { headers: { cookie: 'vorinthex_access=vrtx_access_expired; vorinthex_refresh=vrtx_refresh_cookie' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('vorinthex_refresh=vrtx_refresh_cookie_rotated');
    expect(response.headers.get('x-refresh-token')).toBeNull();
  });

  test('rejects ambiguous cookie and header credentials unless header transport is explicit', async () => {
    const buildApp = () => {
      const app = new Hono<{ Variables: { userId: string } }>();
      app.use('*', createAutoRefreshAuthTokens({
        verifyAccessToken: async (token) => ({ key: token, identityType: 'user' as const }),
        refreshAccessToken: async () => null,
      }));
      app.get('/', (c) => c.json({ userId: c.get('userId') }));
      return app;
    };
    const headers = {
      authorization: 'Bearer header-user',
      cookie: 'vorinthex_access=cookie-user',
    };
    expect((await buildApp().request('/', { headers })).status).toBe(400);
    const explicit = await buildApp().request('/', { headers: { ...headers, 'x-vorinthex-session-transport': 'header' } });
    expect(await explicit.json()).toEqual({ userId: 'header-user' });
  });

  test('never lets browser origins opt into readable refresh-token transport', async () => {
    const app = new Hono();
    const tokens = {
      accessToken: 'vrtx_access_new',
      refreshToken: 'vrtx_refresh_new',
      accessTokenMaxAgeSeconds: 900,
      refreshTokenMaxAgeSeconds: 43_200,
      sessionExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
    };
    app.use('*', createAutoRefreshAuthTokens({ verifyAccessToken: async () => null, refreshAccessToken: async () => null }));
    app.post('/', (c) => {
      setSessionForRequest(c, tokens);
      return c.json(sessionTokenPayload(c, tokens));
    });

    const response = await app.request('/', { method: 'POST', headers: {
      authorization: 'Bearer deliberately-invalid-browser-token',
      origin: 'https://vorinthex.com',
      'x-vorinthex-session-transport': 'header',
    } });
    expect(await response.json()).toEqual({});
    expect(response.headers.get('set-cookie')).toContain('vorinthex_refresh=vrtx_refresh_new');
    expect(response.headers.get('x-refresh-token')).toBeNull();
  });

  test('marks rejected stale credentials as a bearer authentication failure', async () => {
    const app = new Hono();
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async () => null,
      refreshAccessToken: async () => null,
    }));
    app.get('/', (c) => c.json({ error: 'Authentication required.' }, 401));

    const response = await app.request('/', { headers: { authorization: 'Bearer vrtx_access_revoked' } });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('clears rejected HttpOnly session cookies', async () => {
    const app = new Hono();
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async () => null,
      refreshAccessToken: async () => null,
    }));
    app.get('/', (c) => c.json({ error: 'Authentication required.' }, 401));

    const response = await app.request('/', { headers: {
      cookie: 'vorinthex_access=vrtx_access_expired; vorinthex_refresh=vrtx_refresh_revoked',
    } });
    const cookies = response.headers.get('set-cookie') ?? '';
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(cookies).toContain('vorinthex_access=;');
    expect(cookies).toContain('vorinthex_refresh=;');
    expect(cookies).toContain('Max-Age=0');
  });

  test('rejects access and refresh tokens from different sessions', async () => {
    const app = new Hono();
    let nextCalls = 0;
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async () => ({ key: 'user-1', identityType: 'user', sessionId: 'session-1' }),
      refreshAccessToken: async () => null,
      refreshTokenMatchesIdentity: async () => false,
    }));
    app.get('/', (c) => {
      nextCalls += 1;
      return c.json({ ok: true });
    });

    const response = await app.request('/', { headers: {
      authorization: 'Bearer access-for-session-1',
      'x-refresh-token': 'refresh-for-session-2',
    } });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toEqual({ error: 'session credentials do not match', code: 'AUTH_SESSION_MISMATCH' });
    expect(nextCalls).toBe(0);
  });

  test('ignores stale credentials on public sign-in routes while preserving transport selection', async () => {
    const app = new Hono<{ Variables: { authSessionTransport: string } }>();
    let verifyCalls = 0;
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async () => { verifyCalls += 1; return null; },
      refreshAccessToken: async () => null,
    }));
    app.post('/api/v1/auth/login', (c) => c.json({ transport: c.get('authSessionTransport') }));

    const response = await app.request('/api/v1/auth/login', { method: 'POST', headers: {
      authorization: 'Bearer stale-access',
      'x-refresh-token': 'stale-refresh',
      'x-vorinthex-session-transport': 'header',
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ transport: 'header' });
    expect(verifyCalls).toBe(0);
  });

  test('does not emit replacement tokens while logging out', async () => {
    const app = new Hono();
    const tokens = {
      accessToken: 'vrtx_access_rotated',
      refreshToken: 'vrtx_refresh_rotated',
      accessTokenMaxAgeSeconds: 900,
      refreshTokenMaxAgeSeconds: 43_200,
      sessionExpiresAt: new Date(Date.now() + 43_200_000).toISOString(),
    };
    app.use('*', createAutoRefreshAuthTokens({
      verifyAccessToken: async (token) => token === tokens.accessToken ? { key: 'user', identityType: 'user' as const } : null,
      refreshAccessToken: async () => tokens,
    }));
    app.post('/api/v1/auth/logout', (c) => c.json({ ok: true }));

    const response = await app.request('/api/v1/auth/logout', { method: 'POST', headers: {
      'x-refresh-token': 'vrtx_refresh_valid',
      'x-vorinthex-session-transport': 'header',
    } });
    expect(response.status).toBe(200);
    expect(response.headers.get('x-access-token')).toBeNull();
    expect(response.headers.get('x-refresh-token')).toBeNull();
  });

});
