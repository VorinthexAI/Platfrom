import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { APP_KEYS } from '@/lib/apps/registry';
import { newId } from '@/lib/ids';
import { errorHandler } from './errors';
import { createAnalyticsEventHandler } from './event-ingestion';
import { registerRoutes } from './routes';

function testApp(dependencies: Parameters<typeof createAnalyticsEventHandler>[0]) {
  const app = new Hono();
  app.onError(errorHandler);
  app.post('/events', createAnalyticsEventHandler(dependencies));
  return app;
}

function postEvent(app: Hono, body: unknown) {
  return app.request('/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('analytics event ingestion HTTP API', () => {
  test('requires an authenticated user', async () => {
    const app = testApp({ getIdentity: async () => null });
    const response = await postEvent(app, { slug: 'navigation.sidebar-opened' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  test('records a custom slug with trusted user and app attribution', async () => {
    const userId = newId();
    const calls: unknown[] = [];
    const app = testApp({
      getIdentity: async () => ({ key: userId, identityType: 'user' }),
      getAppKey: () => APP_KEYS.GALLERY,
      getUser: async () => ({ currentScopeKey: 'scope-main' }) as never,
      record: async (input) => { calls.push(input); },
    });

    const response = await postEvent(app, { slug: ' navigation.sidebar-opened ' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ success: true });
    expect(calls).toEqual([{
      userId,
      scopeKey: 'scope-main',
      slug: 'navigation.sidebar-opened',
      appKey: APP_KEYS.GALLERY,
    }]);
  });

  test('rejects invalid slugs and caller-supplied attribution', async () => {
    const userId = newId();
    const calls: unknown[] = [];
    const app = testApp({
      getIdentity: async () => ({ key: userId, identityType: 'user' }),
      getUser: async () => ({ currentScopeKey: 'scope-main' }) as never,
      record: async (input) => { calls.push(input); },
    });

    expect((await postEvent(app, { slug: 'opened' })).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened', userId: newId() })).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened', appKey: APP_KEYS.GALLERY })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('registers POST /events separately from the event stream', async () => {
    const app = new Hono();
    registerRoutes(app);
    expect((await postEvent(app, { slug: 'navigation.sidebar-opened' })).status).toBe(401);
  });
});
