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
    expect(await response.json()).toEqual({ success: true, data: { query: 'roadmap', groups: [] } });
    expect(calls[0]?.[1]).toEqual({ organizationKey, scopeKey });
    expect((calls[0]?.[2] as any).authenticatedUserKey).toBe(userKey);
    expect(calls[1]?.[1]).toMatchObject({ query: 'roadmap', collectionSlugs: ['folders'], recordHistory: false, limit: 10, minimumScore: 0.55 });
    expect(calls[1]?.[2]).toBe(context);
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
