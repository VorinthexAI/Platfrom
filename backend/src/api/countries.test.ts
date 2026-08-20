import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { runTool } from '@/lib/ai/tools';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createCountryHandlers } from './countries';

describe('country HTTP adapter', () => {
  test('passes strict transport input and trusted identity to the canonical service', async () => {
    const calls: unknown[][] = [];
    const service = { search: async (...args: unknown[]) => { calls.push(args); return { country: { name: 'Portugal', countryCode: 'PT', latitude: 39.61, longitude: -8.27 } }; } } as any;
    const app = new Hono();
    app.post('/travel/countries/search', createCountryHandlers({ service, getIdentity: async () => ({ key: 'trusted-user', identityType: 'user' }) }).search);
    const input = { organizationKey: 'organization', query: 'Portugal' };
    const response = await app.request('/travel/countries/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
    expect(response.status).toBe(200);
    expect(calls).toEqual([[input, 'trusted-user', { signal: expect.any(AbortSignal), timeoutMs: 10_000 }]]);
    expect((await app.request('/travel/countries/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...input, userKey: 'untrusted' }) })).status).toBe(400);
  });

  test('keeps HTTP and Core country.search on the same trusted-user canonical service', async () => {
    const organizationKey = newId(), scopeKey = newId(), userKey = newId();
    const calls: unknown[][] = [];
    const service = { search: async (...args: unknown[]) => { calls.push(args); return { country: null }; } } as any;
    const app = new Hono();
    app.post('/travel/countries/search', createCountryHandlers({ service, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).search);
    await app.request('/travel/countries/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationKey, query: 'Japan' }) });
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    await runTool('country.search', '', { query: 'Japan' }, { contentContext: context, countrySearchService: service });
    expect(calls.map((call) => call.slice(0, 2))).toEqual([
      [{ organizationKey, query: 'Japan' }, userKey],
      [{ organizationKey, query: 'Japan' }, userKey],
    ]);
  });
});
