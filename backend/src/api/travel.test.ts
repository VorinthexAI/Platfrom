import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { ProviderExecutionError } from '@/lib/ai/router/errors';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { GuideGenerationError } from '@/lib/travel/service';
import { TravelRepositoryError } from '@/lib/travel/repository';
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
    const service = { findPlaces: async (...args: unknown[]) => { calls.push(args); return { results: [{ name: 'Japan' }] }; } } as never;
    const app = new Hono();
    app.post('/travel/places/find', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlaces);
    const body = { organizationKey: 'organization', scopeKey: newId(), query: 'Japan' };
    const response = await app.request('/travel/places/find', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { results: [{ name: 'Japan' }] } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual([body, 'trusted-user']);
    expect((calls[0]?.[2] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  test('keeps HTTP and Core place.guide.find adapters on the renamed canonical guide service', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { findPlaceGuide: async (...args: unknown[]) => { calls.push(args); return { place: { title: 'Japan' } }; } } as never;
    const app = new Hono();
    app.post('/travel/places/guide', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).findPlaceGuide);
    const body = { organizationKey, scopeKey, query: 'Japan' };
    expect((await app.request('/travel/places/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await runTool('place.guide.find', '', { query: 'Japan' }, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([[body, userKey], [body, userKey]]);
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

  test('keeps strict HTTP and Core search and trip adapters on the same canonical services', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), placeKey = newId();
    const calls: unknown[][] = [];
    const service = {
      findPlaces: async (...args: unknown[]) => { calls.push(['find', ...args]); return { results: [] }; },
      searchPlaces: async (...args: unknown[]) => { calls.push(['search', ...args]); return { results: [] }; },
      listTrips: async (...args: unknown[]) => { calls.push(['list', ...args]); return { trips: [] }; },
      searchTrips: async (...args: unknown[]) => { calls.push(['trip-search', ...args]); return { trips: [] }; },
      createTrip: async (...args: unknown[]) => { calls.push(['create', ...args]); return { trip: {} }; },
      updateTrip: async (...args: unknown[]) => { calls.push(['update', ...args]); return { trip: {} }; },
      deleteTrip: async (...args: unknown[]) => { calls.push(['delete', ...args]); return { tripKey: placeKey }; },
      setTripAttachments: async (...args: unknown[]) => { calls.push(['attachments', ...args]); return { trip: {} }; },
      updatePlace: async (...args: unknown[]) => { calls.push(['place-update', ...args]); return { place: {} }; },
      deletePlace: async (...args: unknown[]) => { calls.push(['place-delete', ...args]); return { placeKey }; },
    } as never;
    const handlers = createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) });
    const app = new Hono();
    app.post('/travel/places/find', handlers.findPlaces);
    app.post('/travel/places/search', handlers.searchPlaces);
    app.post('/travel/trips/list', handlers.listTrips);
    app.post('/travel/trips/search', handlers.searchTrips);
    app.post('/travel/trips', handlers.createTrip);
    app.post('/travel/trips/update', handlers.updateTrip);
    app.post('/travel/trips/delete', handlers.deleteTrip);
    app.post('/travel/trips/attachments/set', handlers.setTripAttachments);
    app.post('/travel/places/update', handlers.updatePlace);
    app.post('/travel/places/delete', handlers.deletePlace);
    const headers = { 'content-type': 'application/json' };
    const search = { organizationKey, scopeKey, query: 'warm coast' };
    const recordedSearch = { ...search, recordHistory: true };
    const create = { organizationKey, scopeKey, name: 'Coast', placeKeys: [placeKey], idempotencyKey: 'http-request-1' };
    expect((await app.request('/travel/places/find', { method: 'POST', headers, body: JSON.stringify(search) })).status).toBe(200);
    expect((await app.request('/travel/places/search', { method: 'POST', headers, body: JSON.stringify({ ...search, userKey }) })).status).toBe(400);
    expect((await app.request('/travel/places/search', { method: 'POST', headers, body: JSON.stringify(search) })).status).toBe(200);
    expect((await app.request('/travel/trips/list', { method: 'POST', headers, body: JSON.stringify({ organizationKey, scopeKey }) })).status).toBe(200);
    expect((await app.request('/travel/trips/search', { method: 'POST', headers, body: JSON.stringify(search) })).status).toBe(200);
    expect((await app.request('/travel/trips', { method: 'POST', headers, body: JSON.stringify(create) })).status).toBe(200);
    const update = { organizationKey, scopeKey, tripKey: placeKey, description: null, status: 'completed', isFavorite: true, placeKeys: [placeKey] };
    expect((await app.request('/travel/trips/update', { method: 'POST', headers, body: JSON.stringify({ ...update, position: 0 }) })).status).toBe(400);
    expect((await app.request('/travel/trips/update', { method: 'POST', headers, body: JSON.stringify(update) })).status).toBe(200);
    const remove = { organizationKey, scopeKey, tripKey: placeKey };
    expect((await app.request('/travel/trips/delete', { method: 'POST', headers, body: JSON.stringify(remove) })).status).toBe(200);
    const attachmentInput = { organizationKey, scopeKey, tripKey: placeKey, attachments: [{ type: 'collection', key: placeKey }] };
    expect((await app.request('/travel/trips/attachments/set', { method: 'POST', headers, body: JSON.stringify({ ...attachmentInput, userKey }) })).status).toBe(400);
    expect((await app.request('/travel/trips/attachments/set', { method: 'POST', headers, body: JSON.stringify(attachmentInput) })).status).toBe(200);
    const placeUpdate = { organizationKey, scopeKey, placeKey, status: 'visited', isFavorite: true };
    expect((await app.request('/travel/places/update', { method: 'POST', headers, body: JSON.stringify({ ...placeUpdate, userKey }) })).status).toBe(400);
    expect((await app.request('/travel/places/update', { method: 'POST', headers, body: JSON.stringify(placeUpdate) })).status).toBe(200);
    const placeDelete = { organizationKey, scopeKey, placeKey };
    expect((await app.request('/travel/places/delete', { method: 'POST', headers, body: JSON.stringify({ ...placeDelete, userKey }) })).status).toBe(400);
    expect((await app.request('/travel/places/delete', { method: 'POST', headers, body: JSON.stringify(placeDelete) })).status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await runTool('place.find', '', { query: search.query }, { contentContext: context, travelService: service });
    await runTool('place.search', '', { query: search.query }, { contentContext: context, travelService: service });
    await runTool('trip.list', '', {}, { contentContext: context, travelService: service });
    await runTool('trip.search', '', { query: search.query }, { contentContext: context, travelService: service });
    await runTool('trip.create', '', { name: create.name, placeKeys: create.placeKeys }, { contentContext: context, travelService: service, requestKey: 'core-request-1' });
    await runTool('trip.update', '', { tripKey: placeKey, description: null, status: 'completed', isFavorite: true, placeKeys: [placeKey] }, { contentContext: context, travelService: service });
    await runTool('trip.delete', '', { tripKey: placeKey }, { contentContext: context, travelService: service });
    await runTool('trip.attachment.set', '', { tripKey: placeKey, attachments: attachmentInput.attachments }, { contentContext: context, travelService: service });
    await expect(runTool('place.update', '', { placeKey, status: 'visited', scopeKey }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.update', '', { placeKey, status: 'visited', isFavorite: true }, { contentContext: context, travelService: service });
    await expect(runTool('place.delete', '', { placeKey, scopeKey }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.delete', '', { placeKey }, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 3))).toEqual([
      ['find', search, userKey], ['search', recordedSearch, userKey], ['list', { organizationKey, scopeKey }, userKey], ['trip-search', recordedSearch, userKey], ['create', create, userKey], ['update', update, userKey], ['delete', remove, userKey], ['attachments', attachmentInput, userKey], ['place-update', placeUpdate, userKey], ['place-delete', placeDelete, userKey],
      ['find', search, userKey], ['search', recordedSearch, userKey], ['list', { organizationKey, scopeKey }, userKey], ['trip-search', recordedSearch, userKey], ['create', { organizationKey, scopeKey, name: create.name, placeKeys: create.placeKeys, idempotencyKey: 'core-request-1:trip.create' }, userKey], ['update', update, userKey], ['delete', remove, userKey], ['attachments', attachmentInput, userKey], ['place-update', placeUpdate, userKey], ['place-delete', placeDelete, userKey],
    ]);
  });

  test('keeps strict HTTP and Core trip guide adapters on the canonical service with injected idempotency', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), tripKey = newId();
    const calls: unknown[][] = [];
    const service = {
      generateTripGuide: async (...args: unknown[]) => { calls.push(['generate', ...args]); return { guide: {} }; },
      listTripGuides: async (...args: unknown[]) => { calls.push(['list', ...args]); return { guides: [] }; },
    } as never;
    const handlers = createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) });
    const app = new Hono();
    app.post('/travel/trips/guides/generate', handlers.generateTripGuide);
    app.post('/travel/trips/guides/list', handlers.listTripGuides);
    const headers = { 'content-type': 'application/json' };
    const generate = { organizationKey, scopeKey, tripKey, idempotencyKey: 'http-guide-1' };
    expect((await app.request('/travel/trips/guides/generate', { method: 'POST', headers, body: JSON.stringify({ ...generate, userKey }) })).status).toBe(400);
    expect((await app.request('/travel/trips/guides/generate', { method: 'POST', headers, body: JSON.stringify(generate) })).status).toBe(200);
    expect((await app.request('/travel/trips/guides/list', { method: 'POST', headers, body: JSON.stringify({ organizationKey, scopeKey, tripKey }) })).status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(runTool('trip.guide.generate', '', { tripKey, idempotencyKey: 'untrusted' }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('trip.guide.generate', '', { tripKey }, { contentContext: context, travelService: service, requestKey: 'core-guide-1' });
    await runTool('trip.guide.list', '', { tripKey }, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 3))).toEqual([
      ['generate', generate, userKey],
      ['list', { organizationKey, scopeKey, tripKey }, userKey],
      ['generate', { organizationKey, scopeKey, tripKey, idempotencyKey: 'core-guide-1:trip.guide.generate' }, userKey],
      ['list', { organizationKey, scopeKey, tripKey }, userKey],
    ]);
  });

  test('keeps strict HTTP and Core place reference adapters on the canonical service with trusted idempotency', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), placeKey = newId();
    const calls: unknown[][] = [];
    const service = {
      generatePlaceReference: async (...args: unknown[]) => { calls.push(['generate', ...args]); return { reference: {} }; },
      listPlaceReferences: async (...args: unknown[]) => { calls.push(['list', ...args]); return { references: [] }; },
    } as never;
    const handlers = createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) });
    const app = new Hono();
    app.post('/travel/places/references/generate', handlers.generatePlaceReference);
    app.post('/travel/places/references/list', handlers.listPlaceReferences);
    const headers = { 'content-type': 'application/json' };
    const generate = { organizationKey, scopeKey, placeKey, kind: 'brief', idempotencyKey: 'http-reference-1' };
    expect((await app.request('/travel/places/references/generate', { method: 'POST', headers, body: JSON.stringify({ ...generate, kind: 'country' }) })).status).toBe(400);
    expect((await app.request('/travel/places/references/generate', { method: 'POST', headers, body: JSON.stringify(generate) })).status).toBe(200);
    expect((await app.request('/travel/places/references/list', { method: 'POST', headers, body: JSON.stringify({ organizationKey, scopeKey, placeKey, kind: 'brief' }) })).status).toBe(200);
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await expect(runTool('place.reference.generate', '', { placeKey, kind: 'brief', idempotencyKey: 'untrusted' }, { contentContext: context, travelService: service })).rejects.toThrow('Unrecognized key');
    await runTool('place.reference.generate', '', { placeKey, kind: 'brief' }, { contentContext: context, travelService: service, requestKey: 'core-reference-1' });
    await runTool('place.reference.list', '', { placeKey, kind: 'brief' }, { contentContext: context, travelService: service });
    expect(calls.map((call) => call.slice(0, 3))).toEqual([
      ['generate', generate, userKey],
      ['list', { organizationKey, scopeKey, placeKey, kind: 'brief' }, userKey],
      ['generate', { organizationKey, scopeKey, placeKey, kind: 'brief', idempotencyKey: 'core-reference-1:place.reference.generate' }, userKey],
      ['list', { organizationKey, scopeKey, placeKey, kind: 'brief' }, userKey],
    ]);
  });

  test('returns conflict when a trip idempotency key is reused for different data', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId(), placeKey = newId();
    const service = { createTrip: async () => { throw new TravelRepositoryError('conflict'); } } as never;
    const app = new Hono();
    app.post('/travel/trips', createTravelHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).createTrip);
    const response = await app.request('/travel/trips', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, scopeKey, name: 'Route', placeKeys: [placeKey], idempotencyKey: 'request-1' }) });
    expect(response.status).toBe(409);
    const body = await response.json() as any;
    expect(body.error.message).toBe('This request key was already used for different data.');
    expect(body).toMatchObject({ success: false, error: { code: 'TRAVEL_IDEMPOTENCY_CONFLICT' } });
  });

  test('returns a distinct conflict when deleting a favorite trip', async () => {
    const service = { deleteTrip: async () => { throw new TravelRepositoryError('favorite'); } } as never;
    const app = new Hono();
    app.post('/travel/trips/delete', createTravelHandlers({ service, getIdentity: async () => ({ key: newId(), identityType: 'user' }) }).deleteTrip);
    const response = await app.request('/travel/trips/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: newId(), scopeKey: newId(), tripKey: newId() }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: 'TRAVEL_FAVORITE_TRIP', message: 'Favorite trips must be unfavorited before deletion.' } });
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
    const service = { findPlaceGuide: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'timeout', message: 'timed out' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/guide', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlaceGuide);
    const response = await app.request('/travel/places/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ success: false, error: { code: 'TRAVEL_LOOKUP_TIMEOUT' } });
  });

  test('maps malformed provider recommendations to an upstream response error', async () => {
    const service = { findPlaceGuide: async () => { throw new GuideGenerationError('country', 'invalid provider output'); } } as never;
    const app = new Hono();
    app.post('/travel/places/guide', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlaceGuide);
    const response = await app.request('/travel/places/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
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
    const service = { findPlaceGuide: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'provider_unavailable', message: 'offline' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/guide', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlaceGuide);
    const response = await app.request('/travel/places/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(await response.json()).toMatchObject({ error: { message: 'Country generation is temporarily unavailable.' } });
  });

  test('identifies provider credential failures instead of reporting an outage', async () => {
    const service = { findPlaceGuide: async () => { throw new ProviderExecutionError('ask', [{ modelId: 'model', providerId: 'openai', externalModelId: 'model', code: 'authentication_failed', message: 'failed with status 401' }]); } } as never;
    const app = new Hono();
    app.post('/travel/places/guide', createTravelHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).findPlaceGuide);
    const response = await app.request('/travel/places/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey: 'organization', scopeKey: newId(), query: 'Japan' }) });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'TRAVEL_PROVIDER_CONFIGURATION_REQUIRED', message: 'Country generation is unavailable because the AI service is not configured.' } });
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
       ['POST', '/travel/overview'], ['POST', '/travel/places'], ['POST', '/travel/places/update'], ['POST', '/travel/places/delete'], ['POST', '/travel/places/open'], ['POST', '/travel/places/find'], ['POST', '/travel/places/guide'], ['POST', '/travel/places/children/find'], ['POST', '/travel/cities/find'], ['POST', '/travel/places/image'], ['POST', '/travel/places/search'], ['POST', '/travel/places/references/generate'], ['POST', '/travel/places/references/list'], ['POST', '/travel/trips/list'], ['POST', '/travel/trips/search'], ['POST', '/travel/trips'], ['POST', '/travel/trips/update'], ['POST', '/travel/trips/delete'], ['POST', '/travel/trips/attachments/set'],
    ];
    for (const [method, path] of requests) {
      const response = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(response.status).toBe(401);
    }
    for (const [method, path] of [['POST', `/travel/places/${newId()}/visits`]] as const) {
      expect((await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404);
    }
  });
});
