import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createUserHiddenHandlers } from './user-hiddens';

const userKey = newId(), organizationKey = newId(), membershipKey = newId(), sourceKey = newId();
const authContext = { organization: { key: organizationKey }, membership: { key: membershipKey, userId: userKey, organizationId: organizationKey, status: 'active' } } as any;

function appWith(options: Parameters<typeof createUserHiddenHandlers>[0]) {
  const handlers = createUserHiddenHandlers(options);
  const app = new Hono();
  app.get('/auth/me/hiddens', handlers.list);
  app.post('/auth/me/hiddens', handlers.hide);
  app.delete('/auth/me/hiddens', handlers.reveal);
  return app;
}

describe('user hidden HTTP handlers', () => {
  test('injects authenticated identity and uses strict schemas', async () => {
    const calls: unknown[] = [];
    const service = {
      list: async (...args: unknown[]) => { calls.push(['list', ...args]); return []; },
      hide: async (...args: unknown[]) => { calls.push(['hide', ...args]); return { source: 'image', sourceKey }; },
      reveal: async (...args: unknown[]) => { calls.push(['reveal', ...args]); return null; },
    } as any;
    const app = appWith({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }), getContext: async () => authContext });
    expect((await app.request('/auth/me/hiddens?extra=1')).status).toBe(400);
    expect((await app.request('/auth/me/hiddens')).status).toBe(200);
    expect((await app.request('/auth/me/hiddens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'image', sourceKey, userKey }) })).status).toBe(400);
    expect((await app.request('/auth/me/hiddens', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'image', sourceKey }) })).status).toBe(200);
    expect((await app.request(`/auth/me/hiddens?source=image&sourceKey=${sourceKey}`, { method: 'DELETE' })).status).toBe(200);
    expect(calls.map((call) => (call as any[])[0])).toEqual(['list', 'hide', 'reveal']);
    expect(JSON.stringify(calls)).toContain(userKey);
    expect(calls[0]).toEqual(['list', { userKey, organizationKey, membershipKey, service }]);
  });

  test('requires a user identity', async () => {
    const service = {} as any;
    expect((await appWith({ service, getIdentity: async () => null }).request('/auth/me/hiddens')).status).toBe(401);
    expect((await appWith({ service, getIdentity: async () => ({ key: membershipKey, identityType: 'member' }) }).request('/auth/me/hiddens')).status).toBe(403);
  });
});
