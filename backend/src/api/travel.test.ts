import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
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

  test('routes place.find to the canonical service with trusted user identity and cancellation', async () => {
    const calls: unknown[][] = [];
    const service = { findPlace: async (...args: unknown[]) => { calls.push(args); return { place: { title: 'Japan' } }; } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlace);
    const body = { organizationKey: 'organization', scopeKey: newId(), query: 'Japan', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } };
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { place: { title: 'Japan' } } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual([body, 'trusted-user']);
    expect((calls[0]?.[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  test('maps transient place lookup failures to retryable HTTP responses', async () => {
    const service = { findPlace: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'timeout', message: 'timed out' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlace);
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT' } });
  });

  test('keeps transient place images behind the authenticated strict HTTP protocol boundary', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { generatePlaceImages: async (...args: unknown[]) => { calls.push(args); return { status: 'ready', images: [], durationMs: 1, costUsd: null }; } } as never;
    const app = new Hono();
    app.post('/travel/places/images', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).generatePlaceImages);
    const place = { imageRequestToken: 'opaque-token' };
    const response = await app.request('/travel/places/images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...place }) });
    expect(response.status).toBe(200);
    expect(calls[0]?.slice(0, 2)).toEqual([{ organizationKey, scopeKey, ...place }, userKey]);
    expect((calls[0]?.[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    const invalid = await app.request('/travel/places/images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...place, prompts: ['untrusted'] }) });
    expect(invalid.status).toBe(400);
  });

  test('registers only overview and transient country-sheet routes', async () => {
    const app = new Hono();
    registerRoutes(app);
    const requests: Array<[string, string]> = [
      ['POST', '/travel/overview'], ['POST', '/travel/places/find'], ['POST', '/travel/places/images'],
    ];
    for (const [method, path] of requests) {
      const response = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
    for (const [method, path] of [['POST', '/travel/places'], ['POST', `/travel/places/${newId()}/visits`], ['POST', '/travel/trips']] as const) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    }
  });
});
