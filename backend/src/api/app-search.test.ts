import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { runTool } from '@/lib/ai/tools';
import { createAppSearchHandler } from './app-search';
import { registerRoutes } from './routes';

const organizationKey = newId(), scopeKey = newId(), userKey = newId();
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;

function request(dependencies: Parameters<typeof createAppSearchHandler>[0], body: unknown) {
  const app = new Hono();
  app.post('/app/search', createAppSearchHandler(dependencies));
  return app.request('/app/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('app search HTTP API', () => {
  test('requires a user session and strictly validates trusted selectors', async () => {
    expect((await request({ getIdentity: async () => null }, {})).status).toBe(401);
    expect((await request({ getIdentity: async () => ({ key: userKey, identityType: 'member' }) }, {})).status).toBe(403);
    const dependencies = { getIdentity: async () => ({ key: userKey, identityType: 'user' as const }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service: { search: async () => ({ query: 'ok', groups: [] }) } as never };
    expect((await request(dependencies, { organizationKey, scopeKey, query: 'ok', collectionSlugs: ['folders'], membershipKey: newId() })).status).toBe(400);
    expect((await request(dependencies, { organizationKey, scopeKey, query: 'ok', collectionSlugs: ['folders'], embedding: [1] })).status).toBe(400);
  });

  test('is registered at POST /app/search', async () => {
    const app = new Hono();
    registerRoutes(app);
    const response = await app.request('/app/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(401);
  });

  test('authorizes selectors and invokes the canonical service with the trusted context', async () => {
    const calls: unknown[][] = [];
    const response = await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async (...args: any[]) => { calls.push(['authorize', ...args]); return { input: { organizationKey, scopeKey }, context }; },
      service: { search: async (...args: any[]) => { calls.push(['search', ...args]); return { query: 'roadmap', groups: [] }; } } as never,
    }, { organizationKey, scopeKey, query: 'roadmap', collectionSlugs: ['folders'], recordHistory: false });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { query: 'roadmap', groups: [], retrieval: null } });
    expect(calls[0]?.[1]).toEqual({ organizationKey, scopeKey });
    expect((calls[0]?.[2] as any).authenticatedUserKey).toBe(userKey);
    expect(calls[1]?.[1]).toMatchObject({ query: 'roadmap', collectionSlugs: ['folders'], recordHistory: false, limit: 10 });
    expect(calls[1]?.[1]).not.toHaveProperty('minimumScore');
    expect(calls[1]?.[2]).toBe(context);
  });

  test('accepts query-free operations and returns operation-specific results without retrieval metadata', async () => {
    const response = await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service: { search: async () => ({ operation: 'count', groups: [{ collectionSlug: 'books', count: 4 }] }) } as never,
    }, { organizationKey, scopeKey, operation: 'count', collectionSlugs: ['books'] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { operation: 'count', groups: [{ collectionSlug: 'books', count: 4 }], retrieval: null } });
  });

  test('strictly forwards exact sums through HTTP and returns no retrieval metadata', async () => {
    const calls: unknown[] = [];
    const output = { operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 1_500_000_000, unit: 'bytes', matchedCount: 20, valueCount: 20 }] };
    const dependencies = { getIdentity: async () => ({ key: userKey, identityType: 'user' as const }), authorize: async () => ({ input: { organizationKey, scopeKey }, context }), service: { search: async (input: unknown) => { calls.push(input); return output; } } as never };
    const response = await request(dependencies, { organizationKey, scopeKey, operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { ...output, retrieval: null } });
    expect(calls).toEqual([{ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', recordHistory: true, limit: 10 }]);
    expect((await request(dependencies, { organizationKey, scopeKey, operation: 'sum', collectionSlugs: ['images'], field: 'width' })).status).toBe(400);
  });

  test('preserves strict field filters when invoking exact count operations', async () => {
    const calls: unknown[] = [];
    const response = await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service: { search: async (input: unknown) => { calls.push(input); return { operation: 'count', groups: [{ collectionSlug: 'trips', count: 2 }] }; } } as never,
    }, { organizationKey, scopeKey, operation: 'count', collectionSlugs: ['trips'], filters: { status: 'completed', isFavorite: true, createdFrom: '2026-01-01T00:00:00.000Z' } });
    expect(response.status).toBe(200);
    expect(calls).toEqual([{ operation: 'count', collectionSlugs: ['trips'], recordHistory: true, limit: 10, filters: { status: 'completed', isFavorite: true, createdFrom: '2026-01-01T00:00:00.000Z' } }]);

    const invalid = await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service: { search: async () => { throw new Error('must not execute'); } } as never,
    }, { organizationKey, scopeKey, operation: 'count', collectionSlugs: ['trips'], filters: { status: 'ready' } });
    expect(invalid.status).toBe(400);
  });

  test('rejects query-free email operations without a connector before authorization', async () => {
    let authorizations = 0; let executions = 0;
    const response = await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => { authorizations += 1; return { input: { organizationKey, scopeKey }, context }; },
      service: { search: async () => { executions += 1; return { operation: 'count', groups: [] }; } } as never,
    }, { organizationKey, scopeKey, operation: 'count', collectionSlugs: ['email-messages'] });
    expect(response.status).toBe(400);
    expect({ authorizations, executions }).toEqual({ authorizations: 0, executions: 0 });
  });

  test('normalizes timestamped collection ranges and rejects country date filters before authorization', async () => {
    const calls: unknown[] = [];
    const dependencies = {
      getIdentity: async () => ({ key: userKey, identityType: 'user' as const }),
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service: { search: async (input: unknown) => { calls.push(input); return { query: 'recent', groups: [] }; } } as never,
    };
    const valid = await request(dependencies, { organizationKey, scopeKey, query: 'recent', collectionSlugs: ['folders'], filters: { createdFrom: '2026-08-01T02:00:00+02:00' } });
    expect(valid.status).toBe(200);
    expect(calls[0]).toMatchObject({ filters: { createdFrom: '2026-08-01T00:00:00.000Z' } });

    let authorizations = 0;
    const invalid = await request({ ...dependencies, authorize: async () => { authorizations += 1; return { input: { organizationKey, scopeKey }, context }; } }, { organizationKey, scopeKey, query: 'recent', collectionSlugs: ['countries'], filters: { createdFrom: '2026-08-01T00:00:00.000Z' } });
    expect(invalid.status).toBe(400);
    expect(authorizations).toBe(0);
  });

  test('returns list, get, and summarize responses without retrieval metadata', async () => {
    const key = newId();
    for (const [body, output] of [
      [{ organizationKey, scopeKey, operation: 'list', collectionSlugs: ['books'] }, { operation: 'list', groups: [{ collectionSlug: 'books', results: [] }] }],
      [{ organizationKey, scopeKey, operation: 'get', collectionSlugs: ['books'], key }, { operation: 'get', groups: [{ collectionSlug: 'books', results: [{ key, title: 'Systems' }] }] }],
      [{ organizationKey, scopeKey, operation: 'summarize', collectionSlugs: ['documents'], key, summary: { style: 'technical' } }, { operation: 'summarize', collectionSlug: 'documents', key, summary: 'Summary' }],
    ] as const) {
      const response = await request({
        getIdentity: async () => ({ key: userKey, identityType: 'user' }),
        authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
        service: { search: async () => output } as never,
      }, body);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, data: { ...output, retrieval: null } });
    }
  });

  test('HTTP and Core converge on the same canonical service method', async () => {
    const calls: unknown[][] = [];
    const service = { search: async (...args: any[]) => { calls.push(args); return { query: 'roadmap', groups: [] }; } } as never;
    const input = { query: 'roadmap', collectionSlugs: ['folders'] as const, recordHistory: false };
    await runTool('app.search', '', input, { contentContext: context, appSearchService: service });
    await request({
      getIdentity: async () => ({ key: userKey, identityType: 'user' }),
      authorize: async () => ({ input: { organizationKey, scopeKey }, context }),
      service,
    }, { organizationKey, scopeKey, ...input });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
    expect(calls[0]?.[1]).toBe(context);
    expect(calls[1]?.[1]).toBe(context);
  });
});
