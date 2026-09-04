import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createBillingSummaryReadTool } from '@/lib/ai/tools/billing-summary-read';
import { createBillingSummaryHandler } from './billing';
import { errorHandler } from './errors';

const transaction = (userKey: string) => ({
  key: newId(), userKey, kind: 'account-grant' as const, deltaMicroSparks: 50_000_000,
  balanceAfterMicroSparks: 50_000_000, idempotencyKey: 'account-grant:v1',
  requestHash: 'account-grant:v1:50-sparks', createdAt: '2026-09-04T10:00:00.000Z',
});

describe('billing summary boundaries', () => {
  test('HTTP and unified tool adapters call the same canonical summary operation with trusted identity', async () => {
    const userKey = newId(), organizationKey = newId(), membershipKey = newId(), scopeKey = newId();
    const calls: Array<{ userKey: string; input: unknown }> = [];
    const getSummary = async (trustedUserKey: string, input = {}) => {
      calls.push({ userKey: trustedUserKey, input });
      return { microSparkBalance: 50_000_000, transactions: [transaction(trustedUserKey)] };
    };
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/billing/summary', createBillingSummaryHandler({ getIdentity: async () => ({ key: userKey, identityType: 'user' }), getSummary }));
    const response = await app.request('/billing/summary?limit=10');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { microSparkBalance: 50_000_000 } });

    const context = {
      organizationKey, runtimeScopeKey: scopeKey,
      principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: membershipKey, organizationId: organizationKey, userId: userKey, status: 'active' } },
    } as unknown as ToolContext;
    await expect(createBillingSummaryReadTool(getSummary).execute({ limit: 10 }, { context })).resolves.toMatchObject({ microSparkBalance: 50_000_000 });
    expect(calls).toEqual([{ userKey, input: { limit: 10 } }, { userKey, input: { limit: 10 } }]);
  });

  test('rejects unauthenticated HTTP requests, forged input, and inactive tool memberships', async () => {
    const app = new Hono();
    app.get('/billing/summary', createBillingSummaryHandler({ getIdentity: async () => null }));
    expect((await app.request('/billing/summary')).status).toBe(401);
    expect((await app.request('/billing/summary?userKey=forged')).status).toBe(401);

    const authenticated = new Hono();
    authenticated.onError(errorHandler);
    authenticated.get('/billing/summary', createBillingSummaryHandler({ getIdentity: async () => ({ key: newId(), identityType: 'user' }), getSummary: async () => ({ microSparkBalance: 0, transactions: [] }) }));
    expect((await authenticated.request('/billing/summary?userKey=forged')).status).toBe(400);

    const userKey = newId(), organizationKey = newId();
    const context = { organizationKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'inactive' } } } as unknown as ToolContext;
    await expect(createBillingSummaryReadTool(async () => ({ microSparkBalance: 0, transactions: [] })).execute({}, { context })).rejects.toThrow('active authenticated user membership');
  });

  test('rejects malformed pagination without invoking the canonical service', async () => {
    let calls = 0;
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/billing/summary', createBillingSummaryHandler({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      getSummary: async () => { calls += 1; return { microSparkBalance: 0, transactions: [] }; },
    }));
    const invalidQueries = [
      'limit=0', 'limit=201', 'limit=1.5', 'limit=NaN', 'limit=%20',
      'beforeCreatedAt=2026-09-04',
      'beforeCreatedAt=2026-09-04T10%3A00%3A00.000Z',
      `beforeKey=${newId()}`,
    ];
    for (const query of invalidQueries) expect((await app.request(`/billing/summary?${query}`)).status).toBe(400);
    expect(calls).toBe(0);
  });

  test('accepts a complete composite cursor and rejects non-user identities', async () => {
    const beforeKey = newId(), beforeCreatedAt = '2026-09-04T10:00:00.000Z'; let received: unknown;
    const app = new Hono();
    app.onError(errorHandler);
    app.get('/billing/summary', createBillingSummaryHandler({
      getIdentity: async () => ({ key: newId(), identityType: 'user' }),
      getSummary: async (_userKey, input) => { received = input; return { microSparkBalance: 0, transactions: [] }; },
    }));
    expect((await app.request(`/billing/summary?limit=1&beforeCreatedAt=${encodeURIComponent(beforeCreatedAt)}&beforeKey=${beforeKey}`)).status).toBe(200);
    expect(received).toEqual({ limit: 1, beforeCreatedAt, beforeKey });

    const memberApp = new Hono();
    memberApp.get('/billing/summary', createBillingSummaryHandler({ getIdentity: async () => ({ key: newId(), identityType: 'member' }) }));
    const response = await memberApp.request('/billing/summary');
    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });
});
