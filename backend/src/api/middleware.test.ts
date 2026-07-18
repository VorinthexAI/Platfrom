import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { FOUNDER_ACCESS_MAX_AGE_SECONDS, FOUNDER_REFRESH_MAX_AGE_SECONDS } from './auth';
import { isPolarWebhookPath } from './payments';
import { isResendWebhookPath } from './resend';
import { rateLimitByIp, requireEnvApiKey, setSessionCookies, setSessionTokenHeaders, validateQueryParams } from './middleware';

function middlewareContext(path: string, headers: Record<string, string> = {}, search = '') {
  return {
    req: {
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

describe('api middleware webhook exemptions', () => {
  test('recognizes Polar webhook paths with or without the api prefix', () => {
    expect(isPolarWebhookPath('/api/v1/webhooks/polar')).toBe(true);
    expect(isPolarWebhookPath('/api/v1/webhooks/polar/')).toBe(true);
    expect(isPolarWebhookPath('/webhooks/polar')).toBe(true);
    expect(isPolarWebhookPath('/webhooks/polar/')).toBe(true);
    expect(isPolarWebhookPath('/api/v1/payments/checkout')).toBe(false);
  });

  test('recognizes only the v1 Resend webhook path', () => {
    expect(isResendWebhookPath('/api/webhooks/resend')).toBe(false);
    expect(isResendWebhookPath('/api/webhooks/resend/')).toBe(false);
    expect(isResendWebhookPath('/api/v1/webhooks/resend')).toBe(true);
    expect(isResendWebhookPath('/api/v1/webhooks/resend/')).toBe(true);
    expect(isResendWebhookPath('/api/v1/payments/checkout')).toBe(false);
  });

  test('does not require the global API key for provider webhooks', async () => {
    const previousApiKey = process.env.API_KEY;
    process.env.API_KEY = 'server-key';
    let nextCalls = 0;

    try {
      for (const path of [
        '/api/v1/webhooks/polar',
        '/api/v1/webhooks/polar/',
        '/webhooks/polar',
        '/webhooks/polar/',
        '/api/v1/webhooks/resend',
        '/api/v1/webhooks/resend/',
      ]) {
        await requireEnvApiKey(middlewareContext(path), async () => {
          nextCalls += 1;
        });
      }
      expect(nextCalls).toBe(6);
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
      await rateLimitByIp(middlewareContext('/api/v1/webhooks/polar'), async () => {
        nextCalls += 1;
      });
      await rateLimitByIp(middlewareContext('/api/v1/webhooks/resend'), async () => {
        nextCalls += 1;
      });

      expect(nextCalls).toBe(2);
    } finally {
      if (previousRateLimitEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
      else process.env.RATE_LIMIT_ENABLED = previousRateLimitEnabled;
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
});
