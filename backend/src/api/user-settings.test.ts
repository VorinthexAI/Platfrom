import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { createUserSettingsHandlers } from './user-settings';

function appWith(handlers: ReturnType<typeof createUserSettingsHandlers>) {
  const app = new Hono();
  app.get('/auth/me/settings', handlers.read);
  app.patch('/auth/me/settings', handlers.update);
  return app;
}

describe('user settings HTTP handlers', () => {
  test('injects user identity and supports strict reads and updates', async () => {
    const calls: unknown[] = [];
    const service: any = {
      read: async (userKey: string) => { calls.push(['read', userKey]); return { archive: { showOnlyFavorites: false } }; },
      update: async (userKey: string, input: unknown) => { calls.push(['update', userKey, input]); return input; },
    };
    const app = appWith(createUserSettingsHandlers({ service, getIdentity: async () => ({ key: 'user-1', identityType: 'user' }) }));
    expect(await (await app.request('/auth/me/settings')).json()).toEqual({ archive: { showOnlyFavorites: false } });
    expect((await app.request('/auth/me/settings?unexpected=true')).status).toBe(400);
    const response = await app.request('/auth/me/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archive: { showOnlyFavorites: true } }) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([['read', 'user-1'], ['update', 'user-1', { archive: { showOnlyFavorites: true } }]]);
  });

  test('requires a user session and rejects unknown patch fields', async () => {
    const service = { read: async () => ({}), update: async () => ({}) } as any;
    expect((await appWith(createUserSettingsHandlers({ service, getIdentity: async () => null })).request('/auth/me/settings')).status).toBe(401);
    expect((await appWith(createUserSettingsHandlers({ service, getIdentity: async () => ({ key: 'member-1', identityType: 'member' }) })).request('/auth/me/settings')).status).toBe(403);
    const app = appWith(createUserSettingsHandlers({ service, getIdentity: async () => ({ key: 'user-1', identityType: 'user' }) }));
    const response = await app.request('/auth/me/settings', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archive: { showOnlyFavorites: false }, extra: true }) });
    expect(response.status).toBe(400);
  });
});
