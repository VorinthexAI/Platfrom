import type { Context } from 'hono';
import { z } from 'zod';
import { commerceService, type CommerceService } from '@/lib/commerce/service';
import { checkoutCreateInputSchema, subscriptionMutationInputSchema } from '@/lib/commerce/contracts';
import { getAuthIdentity } from './security';
import { parseJson } from './validation';
import { checkoutHandoffInputSchema, checkoutHandoffService, type CheckoutHandoffService, CheckoutHandoffIssueConflictError, CheckoutHandoffUnavailableError } from '@/lib/commerce/checkout-handoffs';

const idempotencyKeySchema = z.string().trim().min(1).max(200);
const ipAddressSchema = z.string().ip();

function customerIpAddress(c: Context, trustedHeader = false) {
  const value = trustedHeader
    ? c.req.header('x-vorinthex-customer-ip')
    : c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  const parsed = ipAddressSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

interface CommerceHandlerDependencies { service?: CommerceService; handoffs?: CheckoutHandoffService; getIdentity?: typeof getAuthIdentity }

async function authenticatedUser(c: Context, getIdentity: typeof getAuthIdentity) {
  const identity = await getIdentity(c);
  if (!identity || identity.identityType !== 'user') {
    c.header('WWW-Authenticate', 'Bearer');
    return null;
  }
  return identity.key;
}

export function createCommerceHandlers(dependencies: CommerceHandlerDependencies = {}) {
  const service = dependencies.service ?? commerceService;
  const identity = dependencies.getIdentity ?? getAuthIdentity;
  const handoffs = dependencies.handoffs ?? checkoutHandoffService;
  return Object.freeze({
    async listProducts(c: Context) {
      c.header('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
      return c.json({ success: true, data: await service.listProducts() });
    },
    async createCheckout(c: Context) {
      const userKey = await authenticatedUser(c, identity);
      if (!userKey) return c.json({ success: false, error: 'authenticated user required' }, 401);
      const idempotencyKey = idempotencyKeySchema.safeParse(c.req.header('idempotency-key'));
      if (!idempotencyKey.success) return c.json({ success: false, error: 'Idempotency-Key header is required' }, 400);
      const input = await parseJson(c, checkoutCreateInputSchema);
      const address = customerIpAddress(c);
      return c.json({ success: true, data: await (address ? service.createCheckout(input, userKey, idempotencyKey.data, address) : service.createCheckout(input, userKey, idempotencyKey.data)) }, 201);
    },
    async issueCheckoutHandoff(c: Context) {
      const userKey = await authenticatedUser(c, identity);
      if (!userKey) return c.json({ success: false, error: 'authenticated user required' }, 401);
      const idempotencyKey = idempotencyKeySchema.safeParse(c.req.header('idempotency-key'));
      if (!idempotencyKey.success) return c.json({ success: false, error: 'Idempotency-Key header is required' }, 400);
      try { return c.json({ success: true, data: await handoffs.issue(await parseJson(c, checkoutCreateInputSchema), userKey, idempotencyKey.data) }, 201); }
      catch (error) { if (error instanceof CheckoutHandoffIssueConflictError) return c.json({ success: false, error: error.message }, 409); throw error; }
    },
    async inspectCheckoutHandoff(c: Context) {
      try { return c.json({ success: true, data: await handoffs.inspect(await parseJson(c, checkoutHandoffInputSchema)) }); }
      catch (error) { if (error instanceof CheckoutHandoffUnavailableError) return c.json({ success: false, error: 'checkout handoff unavailable' }, 404); throw error; }
    },
    async continueCheckoutHandoff(c: Context) {
      try {
        const input = await parseJson(c, checkoutHandoffInputSchema);
        const address = customerIpAddress(c, true);
        return c.json({ success: true, data: await (address ? handoffs.continue(input, address) : handoffs.continue(input)) });
      }
      catch (error) { if (error instanceof CheckoutHandoffUnavailableError) return c.json({ success: false, error: 'checkout handoff unavailable' }, 404); throw error; }
    },
    async currentSubscription(c: Context) {
      const userKey = await authenticatedUser(c, identity);
      if (!userKey) return c.json({ success: false, error: 'authenticated user required' }, 401);
      return c.json({ success: true, data: await service.getCurrentSubscription(userKey) });
    },
    async cancelSubscription(c: Context) {
      const userKey = await authenticatedUser(c, identity);
      if (!userKey) return c.json({ success: false, error: 'authenticated user required' }, 401);
      await parseJson(c, subscriptionMutationInputSchema);
      return c.json({ success: true, data: await service.setCancellation(userKey, true) });
    },
    async restoreSubscription(c: Context) {
      const userKey = await authenticatedUser(c, identity);
      if (!userKey) return c.json({ success: false, error: 'authenticated user required' }, 401);
      await parseJson(c, subscriptionMutationInputSchema);
      return c.json({ success: true, data: await service.setCancellation(userKey, false) });
    },
  });
}

export const commerceHandlers = createCommerceHandlers();
