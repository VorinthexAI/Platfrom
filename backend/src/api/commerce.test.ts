import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { COMMERCE_CATALOG } from '@/lib/commerce/catalog';
import type { CommerceService } from '@/lib/commerce/service';
import { createCommerceHandlers } from './commerce';
import { errorHandler } from './errors';
import { defaultAssistantCapabilityRegistry } from '@/lib/ai/personal-assistant/capabilities';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import type { CheckoutHandoffService } from '@/lib/commerce/checkout-handoffs';
import { requireEnvApiKey } from './middleware';

function service(overrides: Partial<CommerceService> = {}) {
  return { listProducts: async () => [], getCheckoutProduct: async () => COMMERCE_CATALOG[3], createCheckout: async () => ({ key: newId(), status: 'open' as const, url: 'https://polar.sh/x' }), getCurrentSubscription: async () => null, setCancellation: async () => null, processWebhook: async () => ({ ignored: true }), ...overrides } as CommerceService;
}

describe('commerce HTTP transport', () => {
  test('serves public active safe catalog in deterministic order with cache headers', async () => {
    const app = new Hono();
    const products = COMMERCE_CATALOG.filter((item) => item.active).map(({ providerProductId: _providerProductId, ...item }) => item);
    app.get('/products', createCommerceHandlers({ service: service({ listProducts: async () => products }) }).listProducts);
    const response = await app.request('/products');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('s-maxage=300');
    const body = await response.json();
    expect(body.data.map((item: { productId: string }) => item.productId)).toEqual(['nova.weekly', 'nova.monthly.discounted', 'topup.small']);
    expect(JSON.stringify(body)).not.toContain('providerProductId');
  });

  test('requires trusted auth and idempotency and rejects unknown body fields', async () => {
    let calls = 0; const userKey = newId();
    const commerce = service({ createCheckout: async () => { calls += 1; return { key: newId(), status: 'open', url: 'https://polar.sh/x' }; } });
    const unauthenticated = new Hono(); unauthenticated.post('/checkouts', createCommerceHandlers({ service: commerce, getIdentity: async () => null }).createCheckout);
    expect((await unauthenticated.request('/checkouts', { method: 'POST', body: '{}' })).status).toBe(401);
    const app = new Hono(); app.onError(errorHandler); app.post('/checkouts', createCommerceHandlers({ service: commerce, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).createCheckout);
    expect((await app.request('/checkouts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'topup.small' }) })).status).toBe(400);
    expect((await app.request('/checkouts', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'idem' }, body: JSON.stringify({ productId: 'topup.small', providerProductId: 'forged' }) })).status).toBe(400);
    expect((await app.request('/checkouts', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'idem' }, body: JSON.stringify({ productId: 'topup.small' }) })).status).toBe(201);
    expect(calls).toBe(1);
  });

  test('HTTP and Core checkout adapters call the same canonical service with trusted identity', async () => {
    const userKey = newId(), teamKey = newId(); const calls: unknown[][] = [];
    const commerce = service({ createCheckout: async (...args) => { calls.push(args); return { key: newId(), status: 'open', url: 'https://polar.sh/x' }; } });
    const app = new Hono(); app.onError(errorHandler);
    app.post('/checkouts', createCommerceHandlers({ service: commerce, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).createCheckout);
    expect((await app.request('/checkouts', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'http-request', 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ productId: 'topup.small' }) })).status).toBe(201);
    const domain = { teamKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey: teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'payment.checkout.create')!;
    expect(capability.executionEffect).toBe('write');
    await capability.execute({ productId: 'topup.small' }, { domain, requestKey: 'core-request', commerce } as never);
    expect(calls).toEqual([
      [{ productId: 'topup.small' }, userKey, 'http-request', '203.0.113.7'],
      [{ productId: 'topup.small' }, userKey, 'core-request:payment.checkout.create'],
    ]);
  });

  test('HTTP and Core schedule the selected subscription through the same trusted service', async () => {
    const userKey = newId(), teamKey = newId(); const calls: unknown[][] = [];
    const commerce = service({ scheduleSubscriptionProduct: async (...args) => { calls.push(args); return { status: 'active', cancelAtPeriodEnd: false, pendingProductKey: COMMERCE_CATALOG[2].key } as never; } });
    const handler = createCommerceHandlers({ service: commerce, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).scheduleSubscription;
    const app = new Hono(); app.onError(errorHandler); app.post('/subscriptions/current/schedule', handler);
    const request = (body: unknown) => app.request('/subscriptions/current/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const anonymous = new Hono(); anonymous.post('/subscriptions/current/schedule', createCommerceHandlers({ service: commerce, getIdentity: async () => null }).scheduleSubscription);
    expect((await anonymous.request('/subscriptions/current/schedule', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'nova.monthly.discounted' }) })).status).toBe(401);
    expect((await request({ productId: 'nova.monthly.discounted', userKey })).status).toBe(400);
    expect((await (await request({ productId: 'nova.monthly.discounted' })).json()).data).not.toHaveProperty('pendingProductKey');
    const optedIn = await app.request('/subscriptions/current/schedule?includeScheduled=true', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'nova.monthly.discounted' }) });
    expect((await optedIn.json()).data).toHaveProperty('pendingProductKey', COMMERCE_CATALOG[2].key);
    expect((await app.request('/subscriptions/current/schedule?includeScheduled=false', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'nova.monthly.discounted' }) })).status).toBe(400);
    const domain = { teamKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'subscription.current.schedule')!;
    expect(capability.executionEffect).toBe('write');
    expect(() => capability.inputSchema.parse({ productId: 'nova.monthly.discounted', userKey })).toThrow();
    await capability.execute({ productId: 'nova.monthly.discounted' }, { domain, commerce } as never);
    expect(calls).toEqual([[userKey, { productId: 'nova.monthly.discounted' }], [userKey, { productId: 'nova.monthly.discounted' }], [userKey, { productId: 'nova.monthly.discounted' }]]);
  });

  test('an opted-in HTTP read includes pending plan data while legacy HTTP and Core reads retain their contract', async () => {
    const userKey = newId(), teamKey = newId(), calls: unknown[][] = [];
    const base = { key: newId(), userKey, productKey: COMMERCE_CATALOG[2].key, status: 'active', cancelAtPeriodEnd: false, currentPeriodStart: '2026-09-05T10:00:00.000Z', currentPeriodEnd: '2026-10-05T10:00:00.000Z', createdAt: '2026-09-05T10:00:00.000Z', updatedAt: '2026-09-05T10:00:00.000Z' } as const;
    const commerce = service({ getCurrentSubscription: async (...args) => { calls.push(args); return { ...base, ...(args[1]?.includeScheduled ? { pendingProductKey: COMMERCE_CATALOG[0].key } : {}) }; } });
    const app = new Hono(); app.onError(errorHandler);
    app.get('/subscriptions/current', createCommerceHandlers({ service: commerce, getIdentity: async () => ({ key: userKey, identityType: 'user' }) }).currentSubscription);
    expect((await (await app.request('/subscriptions/current')).json()).data).not.toHaveProperty('pendingProductKey');
    expect((await (await app.request('/subscriptions/current?includeScheduled=true')).json()).data).toHaveProperty('pendingProductKey', COMMERCE_CATALOG[0].key);
    expect((await app.request('/subscriptions/current?includeScheduled=false')).status).toBe(400);
    const domain = { teamKey, runtimeScopeKey: newId(), principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const capability = defaultAssistantCapabilityRegistry.resolve('knowledge-workspace').find(({ definition }) => definition.name === 'subscription.current.read')!;
    await capability.execute({}, { domain, commerce } as never);
    expect(calls).toEqual([[userKey], [userKey, { includeScheduled: true }], [userKey]]);
  });

  test('issues authenticated handoffs and keeps resolve/continue sessionless with strict token-only bodies', async () => {
    const userKey = newId(); const token = `vch_${'A'.repeat(43)}`; const calls: unknown[][] = [];
    const handoffs = {
      issue: async (...args: unknown[]) => { calls.push(['issue', ...args]); return { url: `https://vorinthex.com/checkout#handoff=${token}`, expiresAt: '2026-09-05T11:00:00.000Z' }; },
      inspect: async (...args: unknown[]) => { calls.push(['inspect', ...args]); return { product: COMMERCE_CATALOG[3], expiresAt: '2026-09-05T11:00:00.000Z' }; },
      continue: async (...args: unknown[]) => { calls.push(['continue', ...args]); return { url: 'https://checkout.polar.sh/session' }; },
    } as CheckoutHandoffService;
    const handlers = createCommerceHandlers({ service: service(), handoffs, getIdentity: async () => ({ key: userKey, identityType: 'user' }) });
    const app = new Hono(); app.onError(errorHandler); app.post('/handoffs', handlers.issueCheckoutHandoff); app.post('/handoffs/resolve', handlers.inspectCheckoutHandoff); app.post('/handoffs/continue', handlers.continueCheckoutHandoff);
    expect((await app.request('/handoffs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ productId: 'topup.small' }) })).status).toBe(400);
    expect((await app.request('/handoffs', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'issue-1' }, body: JSON.stringify({ productId: 'topup.small', callback: 'https://evil.example' }) })).status).toBe(400);
    expect((await app.request('/handoffs', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'issue-1' }, body: JSON.stringify({ productId: 'topup.small' }) })).status).toBe(201);
    expect((await app.request('/handoffs/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, userKey }) })).status).toBe(400);
    expect((await app.request('/handoffs/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) })).status).toBe(200);
    expect((await app.request('/handoffs/continue', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vorinthex-customer-ip': '2001:db8::1' }, body: JSON.stringify({ token }) })).status).toBe(200);
    expect(calls).toEqual([['issue', { productId: 'topup.small' }, userKey, 'issue-1'], ['inspect', { token }], ['continue', { token }, '2001:db8::1']]);
  });

  test('requires the environment API key for sessionless handoff protocol routes', async () => {
    const previous = process.env.API_KEY; process.env.API_KEY = 'server-key';
    try {
      const app = new Hono(); app.use('*', requireEnvApiKey); app.post('/api/v1/payments/checkout-handoffs/resolve', (c) => c.json({ ok: true }));
      expect((await app.request('/api/v1/payments/checkout-handoffs/resolve', { method: 'POST' })).status).toBe(401);
      expect((await app.request('/api/v1/payments/checkout-handoffs/resolve', { method: 'POST', headers: { 'x-api-key': 'server-key' } })).status).toBe(200);
    } finally { if (previous === undefined) delete process.env.API_KEY; else process.env.API_KEY = previous; }
  });
});
