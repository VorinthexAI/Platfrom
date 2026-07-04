import { timingSafeEqual } from './crypto';

type PolarServer = 'sandbox' | 'production';

export interface PolarCheckoutRequest {
  productId: string;
  customerEmail: string;
  externalCustomerId: string;
  customerIpAddress?: string;
  successUrl: string;
  returnUrl: string;
  metadata: Record<string, string>;
}

export interface PolarCheckout {
  id: string;
  url: string;
}

export interface PolarProductRequest {
  name: string;
  type: 'subscription' | 'one_time';
  priceCents: number;
  billingPeriod: string | null;
  metadata: Record<string, string>;
}

export interface PolarProduct {
  id: string;
}

function polarBaseUrl(server: PolarServer) {
  return server === 'production' ? 'https://api.polar.sh' : 'https://sandbox-api.polar.sh';
}

function getPolarServer(): PolarServer {
  return process.env.POLAR_SERVER === 'production' ? 'production' : 'sandbox';
}

function requireAccessToken() {
  const token = process.env.POLAR_ACCESS_TOKEN;
  if (!token) throw new Error('POLAR_ACCESS_TOKEN is not configured');
  return token;
}

async function polarRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${polarBaseUrl(getPolarServer())}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${requireAccessToken()}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Polar API request failed (${response.status}): ${text || response.statusText}`);
  }

  return response.json() as Promise<T>;
}

export async function createPolarCheckout(input: PolarCheckoutRequest): Promise<PolarCheckout> {
  const checkout = await polarRequest<{ id: string; url: string }>('/v1/checkouts/', {
    method: 'POST',
    body: JSON.stringify({
      products: [input.productId],
      external_customer_id: input.externalCustomerId,
      customer_email: input.customerEmail,
      customer_ip_address: input.customerIpAddress,
      success_url: input.successUrl,
      return_url: input.returnUrl,
      metadata: input.metadata,
    }),
  });

  return { id: checkout.id, url: checkout.url };
}

export async function listPolarProducts(): Promise<Array<{ id: string; metadata: Record<string, unknown> }>> {
  const limit = 100;
  const items: Array<{ id: string; metadata: Record<string, unknown> }> = [];
  for (let page = 1; ; page += 1) {
    const response = await polarRequest<{
      items: Array<{ id: string; metadata?: Record<string, unknown> }>;
      pagination: { max_page: number };
    }>(`/v1/products/?limit=${limit}&page=${page}&is_archived=false`, { method: 'GET' });
    items.push(...response.items.map((item) => ({ id: item.id, metadata: item.metadata ?? {} })));
    if (page >= response.pagination.max_page) break;
  }
  return items;
}

export async function createPolarProduct(input: PolarProductRequest): Promise<PolarProduct> {
  const price = input.priceCents === 0
    ? { amount_type: 'free' }
    : { amount_type: 'fixed', price_amount: input.priceCents, price_currency: 'usd' };

  const product = await polarRequest<{ id: string }>('/v1/products/', {
    method: 'POST',
    body: JSON.stringify({
      name: input.name,
      prices: [price],
      recurring_interval: input.type === 'subscription' ? input.billingPeriod ?? 'month' : undefined,
      metadata: input.metadata,
    }),
  });

  return { id: product.id };
}

export async function updatePolarProduct(id: string, input: PolarProductRequest): Promise<PolarProduct> {
  const price = input.priceCents === 0
    ? { amount_type: 'free' }
    : { amount_type: 'fixed', price_amount: input.priceCents, price_currency: 'usd' };

  const product = await polarRequest<{ id: string }>(`/v1/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: input.name,
      prices: [price],
      metadata: input.metadata,
    }),
  });

  return { id: product.id };
}

function base64ToBytes(value: string) {
  return Buffer.from(value, 'base64');
}

function webhookSecretKeyCandidates(secret: string) {
  const candidates = [Buffer.from(secret, 'utf8')];
  if (secret.startsWith('whsec_')) candidates.push(base64ToBytes(secret.slice('whsec_'.length)));
  candidates.push(base64ToBytes(secret));
  return candidates;
}

async function hmacSha256Base64(secretBytes: Buffer, payload: string) {
  const keyData = new ArrayBuffer(secretBytes.byteLength);
  new Uint8Array(keyData).set(secretBytes);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Buffer.from(signature).toString('base64');
}

function parseSignatures(header: string) {
  return [...header.matchAll(/v1[,=]([^,\s]+)/g)].map((match) => match[1]);
}

export async function verifyPolarWebhookSignature(input: {
  rawBody: string;
  webhookId: string | undefined;
  webhookTimestamp: string | undefined;
  webhookSignature: string | undefined;
  secret?: string;
  toleranceSeconds?: number;
}) {
  const secret = input.secret ?? process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) {
    // Never accept unsigned webhooks by default; the dev bypass must be opted into explicitly.
    return process.env.NODE_ENV !== 'production'
      && process.env.POLAR_SKIP_WEBHOOK_VERIFICATION === 'true';
  }

  if (!input.webhookId || !input.webhookTimestamp || !input.webhookSignature) return false;

  const timestampSeconds = Number(input.webhookTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;

  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const ageSeconds = Math.abs(Date.now() / 1000 - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return false;

  const signedPayload = `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`;
  const signatures = parseSignatures(input.webhookSignature);
  for (const secretBytes of webhookSecretKeyCandidates(secret)) {
    const expected = await hmacSha256Base64(secretBytes, signedPayload);
    if (signatures.some((signature) => timingSafeEqual(signature, expected))) return true;
  }
  return false;
}
