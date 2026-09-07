import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { errorHandler } from './errors';
import { createAnalyticsEventHandler } from './event-ingestion';
import { bindEventIdentifier } from './middleware';
import { registerRoutes } from './routes';

const identifier = 'a'.repeat(128);
const appScopeKey = 'cmrnlzf640001qc7kazsr96k5';

function testApp(dependencies: Parameters<typeof createAnalyticsEventHandler>[0]) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use('*', bindEventIdentifier);
  app.post('/events', createAnalyticsEventHandler(dependencies));
  return app;
}

function postEvent(app: Pick<Hono<any>, 'request'>, body: unknown, eventIdentifier: string | null = identifier, path = '/events') {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(eventIdentifier === null ? {} : { 'x-vorinthex-event-identifier': eventIdentifier }),
    },
    body: JSON.stringify(body),
  });
}

describe('analytics event ingestion HTTP API', () => {
  test('records anonymous callers with nullable attribution', async () => {
    const calls: unknown[] = [];
    const response = await postEvent(testApp({ getIdentity: async () => null, getAppScopeKey: () => appScopeKey, record: async (input) => { calls.push(input); } }), { slug: 'navigation.sidebar-opened' });
    expect(response.status).toBe(201);
    expect(calls).toEqual([{ userId: null, scopeKey: null, eventIdentifier: identifier, slug: 'navigation.sidebar-opened', appScopeKey }]);
  });

  test('rejects invalid presented credentials instead of downgrading them to anonymous attribution', async () => {
    const calls: unknown[] = [];
    const app = new Hono<{ Variables: { authCredentialsPresented: boolean } }>();
    app.onError(errorHandler);
    app.use('*', bindEventIdentifier);
    app.use('*', async (c, next) => {
      c.set('authCredentialsPresented', true);
      return next();
    });
    app.post('/events', createAnalyticsEventHandler({
      getIdentity: async () => null,
      getAppScopeKey: () => appScopeKey,
      record: async (input) => { calls.push(input); },
    }));

    const response = await postEvent(app, { slug: 'navigation.sidebar-opened' });
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(calls).toEqual([]);
  });

  test('records trusted user and scope attribution for user identities', async () => {
    const userId = newId();
    const calls: unknown[] = [];
    const app = testApp({
      getIdentity: async () => ({ key: userId, identityType: 'user' }),
      getAppScopeKey: () => appScopeKey,
      getUser: async () => ({ currentScopeKey: 'scope-main' }) as never,
      record: async (input) => { calls.push(input); },
    });
    const response = await postEvent(app, { slug: ' navigation.sidebar-opened ' });
    expect(response.status).toBe(201);
    expect(calls).toEqual([{ userId, scopeKey: 'scope-main', eventIdentifier: identifier, slug: 'navigation.sidebar-opened', appScopeKey }]);
  });

  test('does not attribute non-user identities as users', async () => {
    const calls: unknown[] = [];
    let userReads = 0;
    const app = testApp({
      getIdentity: async () => ({ key: 'member-1', identityType: 'member' }),
      getAppScopeKey: () => appScopeKey,
      getUser: async () => { userReads += 1; return null; },
      record: async (input) => { calls.push(input); },
    });
    expect((await postEvent(app, { slug: 'navigation.opened' })).status).toBe(201);
    expect(userReads).toBe(0);
    expect(calls).toEqual([expect.objectContaining({ userId: null, scopeKey: null })]);
  });

  test('requires the header and rejects malformed identifiers before recording', async () => {
    const calls: unknown[] = [];
    const app = testApp({ getIdentity: async () => null, getAppScopeKey: () => appScopeKey, record: async (input) => { calls.push(input); } });
    expect((await postEvent(app, { slug: 'navigation.opened' }, null)).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened' }, 'A'.repeat(128))).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('keeps the body strict and never accepts caller attribution', async () => {
    const calls: unknown[] = [];
    const app = testApp({ getIdentity: async () => null, getAppScopeKey: () => appScopeKey, record: async (input) => { calls.push(input); } });
    expect((await postEvent(app, { slug: '' })).status).toBe(400);
    expect((await postEvent(app, { slug: 'x'.repeat(201) })).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened', userId: newId() })).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened', scopeKey: 'forged' })).status).toBe(400);
    expect((await postEvent(app, { slug: 'navigation.opened', eventIdentifier: 'b'.repeat(128) })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('accepts arbitrary bounded event slugs without an allowlist or dotted-name requirement', async () => {
    const calls: unknown[] = [];
    const app = testApp({ getIdentity: async () => null, getAppScopeKey: () => appScopeKey, record: async (input) => { calls.push(input); } });
    for (const slug of ['opened', 'Onboarding Step 1', 'custom:event/value']) {
      expect((await postEvent(app, { slug })).status).toBe(201);
    }
    expect(calls).toEqual([
      expect.objectContaining({ slug: 'opened' }),
      expect.objectContaining({ slug: 'Onboarding Step 1' }),
      expect.objectContaining({ slug: 'custom:event/value' }),
    ]);
  });

  test('registers POST /events separately from the event stream', async () => {
    const app = new Hono();
    app.use('*', bindEventIdentifier);
    registerRoutes(app);
    expect((await postEvent(app, { slug: 'navigation.sidebar-opened' }, null)).status).toBe(400);
  });
});
