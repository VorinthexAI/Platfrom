import { describe, expect, test } from 'bun:test';
import { Webhook } from 'svix';
import { createPolarProvider, PolarProviderError, polarConfiguration, verifyPolarWebhookSignature } from './polar';

describe('Polar provider adapter', () => {
  const product = (overrides: Record<string, unknown> = {}) => ({ id: 'remote-1', name: 'topup.small', metadata: { productId: 'topup.small' }, recurring_interval: null, is_archived: false, prices: [{ id: 'price-1', amount_type: 'fixed', price_currency: 'usd', price_amount: 999, tax_behavior: 'exclusive', is_archived: false }], ...overrides });
  const timestamp = '2026-09-05T10:00:00.000Z';
  const customer = { id: 'customer-1', external_id: 'user-1' };
  const productReference = { id: 'product-1', metadata: { productId: 'topup.small' } };
  const paidOrder = (overrides: Record<string, unknown> = {}) => ({ id: 'order-1', status: 'paid', paid: true, billing_reason: 'purchase', subtotal_amount: 999, discount_amount: 0, net_amount: 999, tax_amount: 0, total_amount: 999, refunded_amount: 0, refunded_tax_amount: 0, currency: 'usd', created_at: timestamp, modified_at: timestamp, customer, product: productReference, subscription_id: null, metadata: { source: 'checkout' }, ...overrides });
  const subscription = (overrides: Record<string, unknown> = {}) => ({ id: 'subscription-1', status: 'active', amount: 799, currency: 'usd', recurring_interval: 'month', cancel_at_period_end: false, created_at: timestamp, modified_at: timestamp, started_at: timestamp, current_period_start: timestamp, current_period_end: '2026-10-05T10:00:00.000Z', trial_start: null, trial_end: null, canceled_at: null, ends_at: null, ended_at: null, customer, product: productReference, metadata: { source: 'checkout' }, ...overrides });

  test('selects sandbox and sends trusted checkout metadata and idempotency', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const provider = createPolarProvider({ environment: 'sandbox', accessToken: 'token', timeoutMs: 100 }, async (url, init) => {
      request = { url: String(url), init: init! };
      return new Response(JSON.stringify({ id: 'checkout-1', url: 'https://sandbox.polar.sh/checkout/1', status: 'open', ignored: true }), { status: 200 });
    });
    await expect(provider.createCheckout({ providerProductId: 'remote-1', userKey: 'user-1', productId: 'topup.small', idempotencyKey: 'request-1', successUrl: 'https://vorinthex.com/checkout/success', returnUrl: 'https://vorinthex.com/checkout/error', customerIpAddress: '203.0.113.7' })).resolves.toMatchObject({ id: 'checkout-1' });
    expect(request?.url).toBe('https://sandbox-api.polar.sh/v1/checkouts/');
    expect((request?.init.headers as Record<string, string>)['Idempotency-Key']).toBe('request-1');
    expect(JSON.parse(String(request?.init.body))).toMatchObject({ products: ['remote-1'], external_customer_id: 'user-1', success_url: 'https://vorinthex.com/checkout/success', return_url: 'https://vorinthex.com/checkout/error', allow_discount_codes: false, customer_ip_address: '203.0.113.7', metadata: { userKey: 'user-1', productId: 'topup.small' } });
  });

  test('uses current product collection URLs, paginates, and omits prices from metadata-only updates', async () => {
    const requests: { url: string; init: RequestInit }[] = [];
    const provider = createPolarProvider({ environment: 'production', accessToken: 'token' }, async (url, init) => {
      requests.push({ url: String(url), init: init! });
      if (String(url).includes('/products/?')) {
        const page = String(url).endsWith('page=1') ? 1 : 2;
        return Response.json({ items: [product({ id: `remote-${page}` })], pagination: { max_page: 2 } });
      }
      return Response.json(product());
    });
    await expect(provider.listProducts()).resolves.toHaveLength(2);
    await provider.createProduct({ name: 'topup.small', productId: 'topup.small', priceCents: 999, billingPeriod: null });
    await provider.updateProduct('remote-1', { archived: true });
    expect(requests[0]?.url).toBe('https://api.polar.sh/v1/products/?limit=100&page=1');
    expect(requests[1]?.url).toBe('https://api.polar.sh/v1/products/?limit=100&page=2');
    expect(requests[2]?.url).toBe('https://api.polar.sh/v1/products/');
    expect(JSON.parse(String(requests[2]?.init.body)).prices).toEqual([{ amount_type: 'fixed', price_currency: 'usd', price_amount: 999, tax_behavior: 'exclusive' }]);
    expect(JSON.parse(String(requests[3]?.init.body))).toEqual({ is_archived: true });
  });

  test('lists paid orders with one fixed cutoff and follows max_page', async () => {
    const urls: string[] = [];
    const provider = createPolarProvider({ environment: 'production', accessToken: 'token' }, async (url) => {
      urls.push(String(url));
      const page = urls.length;
      return Response.json({ items: [paidOrder({ id: `order-${page}` })], pagination: { max_page: 2 } });
    });
    await expect(provider.listOrders(timestamp)).resolves.toMatchObject([{ id: 'order-1' }, { id: 'order-2' }]);
    expect(urls).toEqual([
      'https://api.polar.sh/v1/orders/?limit=100&page=1&created_before=2026-09-05T10%3A00%3A00.000Z',
      'https://api.polar.sh/v1/orders/?limit=100&page=2&created_before=2026-09-05T10%3A00%3A00.000Z',
    ]);
  });

  test('lists subscriptions from the official sandbox URL and follows max_page', async () => {
    const urls: string[] = [];
    const provider = createPolarProvider({ environment: 'sandbox', accessToken: 'token' }, async (url) => {
      urls.push(String(url));
      return Response.json({ items: [subscription({ id: `subscription-${urls.length}` })], pagination: { max_page: 2 } });
    });
    await expect(provider.listSubscriptions()).resolves.toMatchObject([{ id: 'subscription-1' }, { id: 'subscription-2' }]);
    expect(urls).toEqual([
      'https://sandbox-api.polar.sh/v1/subscriptions/?limit=100&page=1',
      'https://sandbox-api.polar.sh/v1/subscriptions/?limit=100&page=2',
    ]);
  });

  test('rejects invalid reconciliation input, pagination, and provider records', async () => {
    const provider = createPolarProvider({ environment: 'production', accessToken: 'token' }, async (url) => {
      if (String(url).includes('/orders/')) return Response.json({ items: [paidOrder({ net_amount: -1 })], pagination: { max_page: 1 } });
      return Response.json({ items: [subscription({ customer: {} })], pagination: { max_page: 1 } });
    });
    expect(() => provider.listOrders('not-a-timestamp')).toThrow();
    await expect(provider.listOrders(timestamp)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    await expect(provider.listSubscriptions()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });

    const invalidPagination = createPolarProvider({ environment: 'production', accessToken: 'token' }, async () => Response.json({ items: [], pagination: { max_page: 0 } }));
    await expect(invalidPagination.listSubscriptions()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  test('accepts nullable modified timestamps and exposes meter-cycle orders for deliberate service rejection', async () => {
    const provider = createPolarProvider({ environment: 'production', accessToken: 'token' }, async (url) => String(url).includes('/orders/')
      ? Response.json({ items: [paidOrder({ billing_reason: 'subscription_meter_cycle', modified_at: null })], pagination: { max_page: 1 } })
      : Response.json({ items: [subscription({ modified_at: null })], pagination: { max_page: 1 } }));
    await expect(provider.listOrders(timestamp)).resolves.toMatchObject([{ billing_reason: 'subscription_meter_cycle', modified_at: null }]);
    await expect(provider.listSubscriptions()).resolves.toMatchObject([{ modified_at: null }]);
  });

  test('accepts an irrelevant order whose product snapshot has been removed', async () => {
    const provider = createPolarProvider({ environment: 'production', accessToken: 'token' }, async () => Response.json({ items: [paidOrder({ status: 'void', paid: false, product: null })], pagination: { max_page: 1 } }));
    await expect(provider.listOrders(timestamp)).resolves.toMatchObject([{ status: 'void', product: null }]);
  });

  test('fails closed on missing config and normalizes rejection and invalid responses', async () => {
    expect(() => polarConfiguration({})).toThrow(PolarProviderError);
    expect(() => polarConfiguration({ POLAR_SERVER: 'sandbox', POLAR_ACCESS_TOKEN: 'token' })).toThrow(PolarProviderError);
    expect(() => polarConfiguration({ POLAR_ENV: 'Sandbox', POLAR_ACCESS_TOKEN: 'token' })).toThrow(PolarProviderError);
    expect(polarConfiguration({ NODE_ENV: 'production', POLAR_ENV: 'sandbox', POLAR_ACCESS_TOKEN: 'token' })).toMatchObject({ environment: 'sandbox', accessToken: 'token' });
    expect(polarConfiguration({ POLAR_ENV: 'sandbox', POLAR_ACCESS_TOKEN: ' token ' })).toMatchObject({ environment: 'sandbox', accessToken: 'token' });
    let attempts = 0;
    const rejected = createPolarProvider({ environment: 'production', accessToken: 'token' }, async () => { attempts += 1; return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } }); });
    await expect(rejected.createProduct({ name: 'x', productId: 'topup.small', priceCents: 999, billingPeriod: null })).rejects.toMatchObject({ code: 'REJECTED', retryable: true, status: 429 });
    expect(attempts).toBe(1);
    const invalid = createPolarProvider({ environment: 'production', accessToken: 'token' }, async () => new Response('{}', { status: 200 }));
    await expect(invalid.createProduct({ name: 'x', productId: 'topup.small', priceCents: 999, billingPeriod: null })).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  test('aborts provider requests at the configured timeout', async () => {
    const provider = createPolarProvider({ environment: 'sandbox', accessToken: 'token', timeoutMs: 1 }, (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(provider.createProduct({ name: 'x', productId: 'topup.small', priceCents: 999, billingPeriod: null })).rejects.toMatchObject({ code: 'TIMEOUT', retryable: true });
  });

  test('treats missing subscriptions as idempotent but fails closed on forbidden revocation', async () => {
    const urls: string[] = [];
    const missing = createPolarProvider({ environment: 'production', accessToken: 'token' }, async (url) => { urls.push(String(url)); return new Response('{}', { status: 404 }); });
    await expect(missing.revokeSubscription('subscription-1')).resolves.toBeNull();
    const forbidden = createPolarProvider({ environment: 'production', accessToken: 'token' }, async () => new Response('{}', { status: 403 }));
    await expect(forbidden.revokeSubscription('subscription-1')).rejects.toMatchObject({ code: 'REJECTED', status: 403 });
  });

  test('verifies current Standard Webhooks signatures over the exact raw body and headers', () => {
    const secret = `whsec_${Buffer.from('polar-current-secret').toString('base64')}`;
    const webhook = new Webhook(secret);
    const rawBody = '{ "type": "order.paid", "data": { "label": "caf\\u00e9", "id": "order-1" } }';
    const at = new Date();
    const headers = { webhookId: 'event-1', webhookTimestamp: String(Math.floor(at.getTime() / 1000)), webhookSignature: webhook.sign('event-1', at, rawBody) };
    expect(verifyPolarWebhookSignature({ rawBody, ...headers, secret })).toEqual(JSON.parse(rawBody));
    expect(() => verifyPolarWebhookSignature({ rawBody: rawBody.replace('order-1', 'order-2'), ...headers, secret })).toThrow();
    expect(verifyPolarWebhookSignature({ rawBody, secret })).toBeNull();
  });

  test('verifies legacy Polar HMAC signatures using the full whsec_ secret bytes', () => {
    const secret = `whsec_${Buffer.from('polar-legacy-secret').toString('base64')}`;
    const legacyStandardWebhooksSecret = Buffer.from(secret, 'utf8').toString('base64');
    const webhook = new Webhook(legacyStandardWebhooksSecret);
    const rawBody = JSON.stringify({ type: 'order.paid', data: { id: 'legacy-order' } });
    const at = new Date();
    expect(verifyPolarWebhookSignature({ rawBody, webhookId: 'legacy-event', webhookTimestamp: String(Math.floor(at.getTime() / 1000)), webhookSignature: webhook.sign('legacy-event', at, rawBody), secret })).toEqual(JSON.parse(rawBody));
  });
});
