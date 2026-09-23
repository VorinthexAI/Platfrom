import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createEmailHandlers } from './email-inbox';
import { errorHandler } from './errors';
import { validateQueryParams } from './middleware';
import { emailOAuthCallbackSchema, googleSignInCallbackSchema } from './oauth-callback-schemas';

describe('Google authorization callback transport', () => {
  test('accepts issuer metadata through middleware and Gmail callback on both entry paths', async () => {
    const calls: unknown[] = [];
    const handler = createEmailHandlers({ service: {} as never, oauth: { callback: async (input: unknown) => { calls.push(input); return 'vorinthexcore://capability/signal?email_connection_code=grant'; } } as never }).callback;
    const app = new Hono();
    app.use('*', validateQueryParams);
    app.onError(errorHandler);
    for (const path of ['/api/v1/email/connectors/gmail/callback', '/api/v1/auth/mobile/oauth/google/callback']) app.get(path, handler);
    for (const path of ['/api/v1/email/connectors/gmail/callback', '/api/v1/auth/mobile/oauth/google/callback']) {
      const query = new URLSearchParams({ code: 'test-code', state: 'vrtx_email_state_test', iss: 'https://accounts.google.com', scope: 'openid email https://mail.google.com/', authuser: '0', prompt: 'consent' });
      const response = await app.request(`${path}?${query}`);
      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toStartWith('vorinthexcore://capability/signal?email_connection_code=');
      query.set('iss', 'https://attacker.example');
      expect((await app.request(`${path}?${query}`)).status).toBe(400);
      query.set('iss', 'https://accounts.google.com');
      query.set('unexpected', 'field');
      expect((await app.request(`${path}?${query}`)).status).toBe(400);
    }
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ iss: 'https://accounts.google.com', code: 'test-code', state: 'vrtx_email_state_test' });
  });

  test('accepts missing issuer and denied email grants, while preserving strict sign-in requirements', () => {
    expect(emailOAuthCallbackSchema.parse({ state: 'vrtx_email_state_test', error: 'access_denied', iss: 'https://accounts.google.com' })).toMatchObject({ error: 'access_denied' });
    expect(emailOAuthCallbackSchema.parse({ state: 'vrtx_email_state_test', code: 'test' })).toMatchObject({ code: 'test' });
    expect(() => emailOAuthCallbackSchema.parse({ state: 'untrusted', code: 'test' })).toThrow();
    expect(googleSignInCallbackSchema.parse({ state: 'sign-in-state', code: 'test', iss: 'https://accounts.google.com', scope: 'openid email' })).toMatchObject({ code: 'test' });
    expect(() => googleSignInCallbackSchema.parse({ state: 'sign-in-state', iss: 'https://accounts.google.com' })).toThrow();
  });
});
