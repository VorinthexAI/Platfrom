import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { GuideGenerationError } from '@/lib/travel/service';
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

  test('routes strict place.create input to the canonical service with trusted identity', async () => {
    const calls: unknown[][] = [];
    const service = { createPlace: async (...args: unknown[]) => { calls.push(args); return { place: { name: 'Japan' } }; } } as never;
    const app = new Hono();
    app.post('/travel/places', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).createPlace);
    const body = { organizationKey: 'organization', scopeKey: newId(), name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' };
    const response = await app.request('/travel/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    expect(calls[0]?.slice(0, 2)).toEqual([body, 'trusted-user']);
    expect((calls[0]?.[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    expect((await app.request('/travel/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, userKey: 'untrusted' }) })).status).toBe(400);
  });

  test('keeps HTTP and Core place.create adapters in parity on the same canonical service', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const input = { name: 'Japan', summary: 'Island country.', countryCode: 'JP', latitude: 36.2, longitude: 138.2, imageRequestToken: 'token' };
    const calls: unknown[][] = [];
    const service = { createPlace: async (...args: unknown[]) => { calls.push(args); return { place: input }; } } as never;
    const app = new Hono();
    app.post('/travel/places', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).createPlace);
    await app.request('/travel/places', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...input }) });
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await runTool('place.create', '', input, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      [{ organizationKey, scopeKey, ...input }, userKey],
      [{ organizationKey, scopeKey, ...input }, userKey],
    ]);
  });

  test('keeps strict HTTP and Core place.open adapters in parity with server-owned time', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { openPlace: async (...args: unknown[]) => { calls.push(args); return { place: { name: 'Japan' } }; } } as never;
    const app = new Hono();
    app.post('/travel/places/open', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).openPlace);
    const input = { name: 'Japan', countryCode: 'JP' };
    const body = { organizationKey, scopeKey, ...input };
    expect((await app.request('/travel/places/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, openedAt: new Date().toISOString() }) })).status).toBe(400);
    expect((await app.request('/travel/places/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(runTool('place.open', '', { ...input, userKey }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.open', '', input, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([[body, userKey], [body, userKey]]);
  });

  test('keeps HTTP and Core place.find-city adapters in parity with strict trusted context', async () => {
    const calls: unknown[][] = [];
    const service = { findCity: async (...args: unknown[]) => { calls.push(args); return { city: { title: 'Tokyo' } }; } } as any;
    const app = new Hono();
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    app.post('/travel/cities/find', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).findCity);
    const input = { city: 'Tokyo', country: { name: 'Japan', code: 'JP', continent: 'Asia', lat: 36.2, lon: 138.2 } };
    const body = { organizationKey, scopeKey, ...input };
    expect((await app.request('/travel/cities/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, userKey: 'untrusted' }) })).status).toBe(400);
    const response = await app.request('/travel/cities/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(runTool('place.find-city', '', { ...input, scopeKey }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-city', '', input, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([[body, userKey], [body, userKey]]);
  });

  test('keeps HTTP and Core place.find-children adapters in parity with strict trusted context', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { findChildren: async (...args: unknown[]) => { calls.push(args); return { cities: [] }; } } as never;
    const app = new Hono();
    app.post('/travel/places/children/find', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).findChildren);
    const body = { organizationKey, scopeKey, childrenRequestToken: 'children-token' };
    expect((await app.request('/travel/places/children/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, userKey: 'untrusted' }) })).status).toBe(400);
    const response = await app.request('/travel/places/children/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(runTool('place.find-children', '', { childrenRequestToken: 'children-token', organizationKey }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.find-children', '', { childrenRequestToken: 'children-token' }, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([[body, userKey], [body, userKey]]);
    expect(calls.every((call) => (call[2] as { signal?: AbortSignal }).signal === undefined || (call[2] as { signal?: AbortSignal }).signal instanceof AbortSignal)).toBe(true);
  });

  test('maps transient place lookup failures to retryable HTTP responses', async () => {
    const service = { findPlace: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'timeout', message: 'timed out' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlace);
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT' } });
  });

  test('maps malformed provider recommendations to an upstream response error', async () => {
    const service = { findPlace: async () => { throw new GuideGenerationError('country', 'invalid provider output'); } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlace);
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'COUNTRY_PROVIDER_INVALID_RESPONSE', message: 'Country generation returned an invalid response. Try again.' } });
  });

  test('identifies malformed city recommendations as city generation failures', async () => {
    const service = { findCity: async () => { throw new GuideGenerationError('city', 'invalid provider output'); } } as never;
    const app = new Hono();
    app.post('/travel/cities/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findCity);
    const response = await app.request('/travel/cities/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), city: 'Toronto', country: { name: 'Canada', code: 'CA', continent: 'North America', lat: 56.1, lon: -106.3 } }) });
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'CITY_PROVIDER_INVALID_RESPONSE', message: 'City generation returned an invalid response. Try again.' } });
  });

  test('uses the place-specific unavailable provider message', async () => {
    const service = { findPlace: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'provider_unavailable', message: 'offline' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlace);
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(await response.json()).toMatchObject({ error: { message: 'Country generation is temporarily unavailable.' } });
  });

  test('keeps transient place hero generation behind the authenticated strict HTTP protocol boundary', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { generatePlaceHeroImage: async (...args: unknown[]) => { calls.push(args); return { status: 'ready', image: { title: 'Japan' }, durationMs: 1, costUsd: null }; } } as never;
    const app = new Hono();
    app.post('/travel/places/image', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).generatePlaceHeroImage);
    const place = { imageRequestToken: 'opaque-token' };
    const response = await app.request('/travel/places/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...place }) });
    expect(response.status).toBe(200);
    expect(calls[0]?.slice(0, 2)).toEqual([{ organizationKey, scopeKey, ...place }, userKey]);
    expect((calls[0]?.[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
    const invalid = await app.request('/travel/places/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, ...place, prompt: 'untrusted' }) });
    expect(invalid.status).toBe(400);
  });

  test('registers the canonical create route and transient country-sheet routes', async () => {
    const app = new Hono();
    registerRoutes(app);
    const requests: Array<[string, string]> = [
       ['POST', '/travel/overview'], ['POST', '/travel/places'], ['POST', '/travel/places/open'], ['POST', '/travel/places/find'], ['POST', '/travel/places/children/find'], ['POST', '/travel/cities/find'], ['POST', '/travel/places/image'],
    ];
    for (const [method, path] of requests) {
      const response = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
    for (const [method, path] of [['POST', `/travel/places/${newId()}/visits`], ['POST', '/travel/trips']] as const) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    }
  });
});
