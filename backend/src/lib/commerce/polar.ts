import { Webhook } from 'svix';
import { z } from 'zod';
import { polarCheckoutUrlSchema } from './contracts';

const polarId = z.string().trim().min(1).max(200);
const polarTimestamp = z.string().datetime({ offset: true });
const polarCurrency = z.string().regex(/^[a-zA-Z]{3}$/);
const polarAmount = z.number().int().safe().nonnegative();
const polarMetadata = z.record(z.union([z.string(), z.number(), z.boolean()]));
const polarCustomerSchema = z.object({ id: polarId, external_id: z.string().trim().min(1).max(200).nullable() }).passthrough();
const polarProductReferenceSchema = z.object({ id: polarId, metadata: polarMetadata }).passthrough();
const checkoutResponseSchema = z.object({ id: polarId, url: polarCheckoutUrlSchema, status: z.string() }).passthrough();
const subscriptionResponseSchema = z.object({
  id: polarId,
  status: z.enum(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']),
  cancel_at_period_end: z.boolean().default(false),
  current_period_start: z.string().datetime({ offset: true }),
  current_period_end: z.string().datetime({ offset: true }),
  modified_at: polarTimestamp.nullable().optional(),
}).passthrough();
const fixedPriceSchema = z.object({ id: polarId, amount_type: z.literal('fixed'), price_currency: z.string(), price_amount: z.number().int(), tax_behavior: z.enum(['inclusive', 'exclusive']).nullable(), is_archived: z.boolean() }).passthrough();
const productResponseSchema = z.object({
  id: polarId,
  name: z.string(),
  metadata: polarMetadata,
  recurring_interval: z.enum(['day', 'week', 'month', 'year']).nullable(),
  is_archived: z.boolean(),
  prices: z.array(z.object({ id: polarId, amount_type: z.string() }).passthrough()),
}).passthrough();
const polarPaginationSchema = z.object({ max_page: z.number().int().nonnegative() }).passthrough();
const productListResponseSchema = z.object({ items: z.array(productResponseSchema), pagination: polarPaginationSchema }).passthrough();

export const polarOrderSchema = z.object({
  id: polarId,
  status: z.enum(['pending', 'paid', 'partially_refunded', 'refunded', 'draft', 'void']),
  paid: z.boolean(),
  billing_reason: z.enum(['purchase', 'subscription_create', 'subscription_cycle', 'subscription_update', 'subscription_meter_cycle']),
  subtotal_amount: polarAmount,
  discount_amount: polarAmount,
  net_amount: polarAmount,
  tax_amount: polarAmount,
  total_amount: polarAmount,
  refunded_amount: polarAmount,
  refunded_tax_amount: polarAmount,
  currency: polarCurrency,
  created_at: polarTimestamp,
  modified_at: polarTimestamp.nullable(),
  customer: polarCustomerSchema,
  product: polarProductReferenceSchema.nullable(),
  subscription_id: polarId.nullable(),
  metadata: polarMetadata,
}).passthrough();

export const polarSubscriptionSchema = z.object({
  id: polarId,
  status: z.enum(['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused']),
  amount: polarAmount,
  currency: polarCurrency,
  recurring_interval: z.enum(['day', 'week', 'month', 'year']),
  cancel_at_period_end: z.boolean(),
  created_at: polarTimestamp,
  modified_at: polarTimestamp.nullable(),
  started_at: polarTimestamp.nullable(),
  current_period_start: polarTimestamp.nullable(),
  current_period_end: polarTimestamp.nullable(),
  trial_start: polarTimestamp.nullable(),
  trial_end: polarTimestamp.nullable(),
  canceled_at: polarTimestamp.nullable(),
  ends_at: polarTimestamp.nullable(),
  ended_at: polarTimestamp.nullable(),
  customer: polarCustomerSchema,
  product: polarProductReferenceSchema,
  metadata: polarMetadata,
}).passthrough();

const orderListResponseSchema = z.object({ items: z.array(polarOrderSchema), pagination: polarPaginationSchema }).passthrough();
const subscriptionListResponseSchema = z.object({ items: z.array(polarSubscriptionSchema), pagination: polarPaginationSchema }).passthrough();

export class PolarProviderError extends Error {
  constructor(public readonly code: 'NOT_CONFIGURED' | 'TIMEOUT' | 'REJECTED' | 'INVALID_RESPONSE', message: string, public readonly retryable: boolean, public readonly status?: number) {
    super(message);
    this.name = 'PolarProviderError';
  }
}

export interface PolarConfiguration { environment: 'sandbox' | 'production'; accessToken: string; webhookSecret?: string; timeoutMs?: number }

export function polarConfiguration(environmentVariables: NodeJS.ProcessEnv = process.env): PolarConfiguration {
  const environment = z.enum(['sandbox', 'production']).safeParse(environmentVariables.POLAR_ENV);
  const accessToken = environmentVariables.POLAR_ACCESS_TOKEN?.trim();
  if (!environment.success || !accessToken) throw new PolarProviderError('NOT_CONFIGURED', 'Polar payment operations are not configured.', false);
  return { environment: environment.data, accessToken, webhookSecret: environmentVariables.POLAR_WEBHOOK_SECRET?.trim(), timeoutMs: 10_000 };
}

type PolarFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createPolarProvider(configuration = polarConfiguration(), fetcher: PolarFetch = fetch) {
  const baseUrl = configuration.environment === 'sandbox' ? 'https://sandbox-api.polar.sh/v1' : 'https://api.polar.sh/v1';
  async function request(path: string, init: RequestInit, schema: z.ZodTypeAny) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), configuration.timeoutMs ?? 10_000);
    try {
      const response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { Authorization: `Bearer ${configuration.accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers },
      });
      if (!response.ok) throw new PolarProviderError('REJECTED', `Polar request failed with status ${response.status}.`, response.status === 429 || response.status >= 500, response.status);
      let body: unknown;
      try { body = await response.json(); } catch { throw new PolarProviderError('INVALID_RESPONSE', 'Polar returned invalid JSON.', true); }
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new PolarProviderError('INVALID_RESPONSE', 'Polar returned an invalid response.', true);
      return parsed.data;
    } catch (error) {
      if (error instanceof PolarProviderError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') throw new PolarProviderError('TIMEOUT', 'Polar request timed out.', true);
      throw new PolarProviderError('REJECTED', 'Polar request failed.', true);
    } finally { clearTimeout(timeout); }
  }
  return Object.freeze({
    async listProducts() {
      const products: z.infer<typeof productResponseSchema>[] = [];
      for (let page = 1, maxPage = 1; page <= maxPage; page += 1) {
        const response = productListResponseSchema.parse(await request(`/products/?limit=100&page=${page}`, { method: 'GET' }, productListResponseSchema));
        products.push(...response.items);
        maxPage = response.pagination.max_page;
      }
      return products;
    },
    async listOrders(createdBefore: string) {
      const cutoff = polarTimestamp.parse(createdBefore);
      const orders: PolarOrder[] = [];
      for (let page = 1, maxPage = 1; page <= maxPage; page += 1) {
        const response = orderListResponseSchema.parse(await request(`/orders/?limit=100&page=${page}&created_before=${encodeURIComponent(cutoff)}`, { method: 'GET' }, orderListResponseSchema));
        orders.push(...response.items);
        maxPage = response.pagination.max_page;
      }
      return orders;
    },
    async listSubscriptions() {
      const subscriptions: PolarSubscription[] = [];
      for (let page = 1, maxPage = 1; page <= maxPage; page += 1) {
        const response = subscriptionListResponseSchema.parse(await request(`/subscriptions/?limit=100&page=${page}`, { method: 'GET' }, subscriptionListResponseSchema));
        subscriptions.push(...response.items);
        maxPage = response.pagination.max_page;
      }
      return subscriptions;
    },
    async createCheckout(input: { providerProductId: string; userKey: string; productId: string; idempotencyKey: string; successUrl: string; returnUrl: string; customerIpAddress?: string }) {
      return checkoutResponseSchema.parse(await request('/checkouts/', { method: 'POST', headers: { 'Idempotency-Key': input.idempotencyKey }, body: JSON.stringify({ products: [input.providerProductId], external_customer_id: input.userKey, success_url: input.successUrl, return_url: input.returnUrl, allow_discount_codes: false, ...(input.customerIpAddress ? { customer_ip_address: input.customerIpAddress } : {}), metadata: { userKey: input.userKey, productId: input.productId } }) }, checkoutResponseSchema));
    },
    async updateSubscription(providerSubscriptionId: string, cancelAtPeriodEnd: boolean) {
      return subscriptionResponseSchema.parse(await request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: 'PATCH', body: JSON.stringify({ cancel_at_period_end: cancelAtPeriodEnd }) }, subscriptionResponseSchema));
    },
    async revokeSubscription(providerSubscriptionId: string) {
      try {
        return subscriptionResponseSchema.parse(await request(`/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { method: 'DELETE' }, subscriptionResponseSchema));
      } catch (error) {
        if (error instanceof PolarProviderError && error.status === 404) return null;
        throw error;
      }
    },
    async createProduct(input: { name: string; productId: string; priceCents: number; billingPeriod: 'week' | 'month' | null }) {
      return productResponseSchema.parse(await request('/products/', { method: 'POST', body: JSON.stringify({ name: input.name, recurring_interval: input.billingPeriod, prices: [{ amount_type: 'fixed', price_currency: 'usd', price_amount: input.priceCents, tax_behavior: 'exclusive' }], metadata: { productId: input.productId } }) }, productResponseSchema));
    },
    async updateProduct(providerProductId: string, input: { name?: string; productId?: string; priceCents?: number; archived?: boolean }) {
      const body = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.productId === undefined ? {} : { metadata: { productId: input.productId } }),
        ...(input.archived === undefined ? {} : { is_archived: input.archived }),
        ...(input.priceCents === undefined ? {} : { prices: [{ amount_type: 'fixed', price_currency: 'usd', price_amount: input.priceCents, tax_behavior: 'exclusive' }] }),
      };
      return productResponseSchema.parse(await request(`/products/${encodeURIComponent(providerProductId)}`, { method: 'PATCH', body: JSON.stringify(body) }, productResponseSchema));
    },
  });
}

export function verifyPolarWebhookSignature(input: { rawBody: string; webhookId?: string; webhookTimestamp?: string; webhookSignature?: string; secret?: string }) {
  const secret = input.secret ?? process.env.POLAR_WEBHOOK_SECRET;
  if (!secret) throw new PolarProviderError('NOT_CONFIGURED', 'Polar webhook verification is not configured.', false);
  if (!input.webhookId || !input.webhookTimestamp || !input.webhookSignature) return null;
  const headers = { 'webhook-id': input.webhookId, 'webhook-timestamp': input.webhookTimestamp, 'webhook-signature': input.webhookSignature };
  try {
    return new Webhook(secret).verify(input.rawBody, headers);
  } catch {
    const legacySecret = Buffer.from(secret, 'utf8').toString('base64');
    return new Webhook(legacySecret).verify(input.rawBody, headers);
  }
}

type CompletePolarProvider = ReturnType<typeof createPolarProvider>;
export type PolarProvider = Pick<CompletePolarProvider, 'listProducts' | 'createCheckout' | 'updateSubscription' | 'revokeSubscription' | 'createProduct' | 'updateProduct'> & Partial<Pick<CompletePolarProvider, 'listOrders' | 'listSubscriptions'>>;
export type PolarReconciliationProvider = Required<Pick<CompletePolarProvider, 'listOrders' | 'listSubscriptions'>>;
export type PolarProduct = Awaited<ReturnType<PolarProvider['listProducts']>>[number];
export type PolarOrder = z.infer<typeof polarOrderSchema>;
export type PolarSubscription = z.infer<typeof polarSubscriptionSchema>;

export function activeExclusiveFixedUsdPrice(product: PolarProduct, priceAmount?: number) {
  for (const price of product.prices) {
    const fixed = fixedPriceSchema.safeParse(price);
    if (fixed.success && !fixed.data.is_archived && fixed.data.price_currency.toLowerCase() === 'usd' && fixed.data.tax_behavior === 'exclusive' && (priceAmount === undefined || fixed.data.price_amount === priceAmount)) return fixed.data;
  }
  return null;
}
