import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { createTravelHandlers } from './travel';
import { registerRoutes } from './routes';

function appWith(handler: ReturnType<typeof createTravelHandlers>['overview']) {
  const app = new Hono();
  app.post('/travel/overview', handler);
  return app;
}

describe('travel HTTP handlers', () => {
  test('requires authentication and a user identity', async () => {
    const service = { overview: async () => ({ places: [], trips: [] }) } as never;
    const unauthenticated = appWith(createTravelHandlers({ service, getIdentity: async () => null }).overview);
    expect((await unauthenticated.request('/travel/overview', { method: 'POST', body: '{}' })).status).toBe(401);
    const guest = appWith(createTravelHandlers({ service, getIdentity: async () => ({ key: newId(), identityType: 'member' }) }).overview);
    expect((await guest.request('/travel/overview', { method: 'POST', body: '{}' })).status).toBe(403);
  });

  test('maps strict input failures to a safe 400 response', async () => {
    const service = { overview: async () => { throw new (await import('zod')).ZodError([]); } } as never;
    const app = appWith(createTravelHandlers({ service, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).overview);
    const response = await app.request('/travel/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unknown: true }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'TRAVEL_INVALID_INPUT' } });
  });

  test('registers every travel route', async () => {
    const app = new Hono();
    registerRoutes(app);
    const requests: Array<[string, string]> = [
      ['POST', '/travel/overview'], ['POST', '/travel/places'], ['POST', `/travel/places/${newId()}/visits`], ['POST', '/travel/trips'], ['POST', `/travel/trips/${newId()}/places`], ['DELETE', `/travel/trips/${newId()}/places/${newId()}`],
    ];
    for (const [method, path] of requests) {
      const response = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
  });
});
