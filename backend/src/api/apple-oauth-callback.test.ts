import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { buildMobileOAuthAuthorizationUrl } from './auth';
import { errorHandler } from './errors';
import { registerRoutes } from './routes';

describe('mobile Apple OAuth callback', () => {
  test('returns an exchange failure to the signed app instead of exposing a raw 500 page', async () => {
    const keys = ['ACCESS_TOKEN_SECRET', 'APPLE_OAUTH_CLIENT_ID', 'APPLE_OAUTH_KEY_ID', 'APPLE_OAUTH_TEAM_ID', 'BACKEND_PUBLIC_URL'] as const;
    const previous = keys.map((key) => process.env[key]);
    try {
      process.env.ACCESS_TOKEN_SECRET = 'test-access-secret';
      process.env.APPLE_OAUTH_CLIENT_ID = 'com.example.service';
      process.env.APPLE_OAUTH_KEY_ID = 'TESTKEY123';
      delete process.env.APPLE_OAUTH_TEAM_ID;
      process.env.BACKEND_PUBLIC_URL = 'https://vorinthex.com';
      const authorization = new URL(await buildMobileOAuthAuthorizationUrl('apple', 'vorinthexcore://auth/oauth-complete'));
      const state = authorization.searchParams.get('state')!;
      const app = new Hono();
      app.onError(errorHandler);
      registerRoutes(app.basePath('/api/v1'));

      const response = await app.request('https://vorinthex.com/api/v1/auth/mobile/oauth/apple/callback', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code: 'apple-code', state }).toString(),
      });
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe('vorinthexcore://auth/oauth-complete?error=oauth_failed');
      expect(response.headers.get('location')).not.toContain(state);
    } finally {
      keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    }
  });
});
