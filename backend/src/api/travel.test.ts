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
    const service = { overview: async () => ({ places: [] }) } as never;
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

  test('registers only the read-only overview', async () => {
    const app = new Hono();
    registerRoutes(app);
    const overview = await app.request('/travel/overview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(overview.status).toBe(401);
    const creation = await app.request('/travel/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(creation.status).toBe(404);
  });
});
