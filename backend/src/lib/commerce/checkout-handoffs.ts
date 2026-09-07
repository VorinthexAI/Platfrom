import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@/lib/ids';
import { checkoutCreateInputSchema } from './contracts';
import { commerceService, type CommerceService } from './service';
import { createArangoCheckoutHandoffRepository, type CheckoutHandoffRepository } from './checkout-handoffs-repository';
import { CHECKOUT_HANDOFF_PURPOSE, checkoutHandoffContinueResultSchema, checkoutHandoffInputSchema, checkoutHandoffInspectResultSchema, checkoutHandoffIssueResultSchema, checkoutHandoffSchema, checkoutHandoffTokenSchema } from './checkout-handoff-contracts';

export const CHECKOUT_HANDOFF_TTL_MS = 60 * 60_000;
export const CHECKOUT_HANDOFF_LEASE_MS = 5 * 60_000;
export { checkoutHandoffInputSchema } from './checkout-handoff-contracts';

export class CheckoutHandoffUnavailableError extends Error {
  constructor() { super('Checkout handoff is unavailable.'); this.name = 'CheckoutHandoffUnavailableError'; }
}
export class CheckoutHandoffIssueConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'CheckoutHandoffIssueConflictError'; }
}

export function checkoutOrigin(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = environment.CHECKOUT_ORIGIN?.trim() || 'https://vorinthex.com';
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== configured.replace(/\/$/, '')) throw new Error();
    return url.origin;
  } catch {
    throw new Error('CHECKOUT_ORIGIN must be an HTTPS origin.');
  }
}

interface CheckoutHandoffServiceDependencies {
  repository: CheckoutHandoffRepository;
  commerce?: Pick<CommerceService, 'getCheckoutProduct' | 'createCheckout'>;
  createKey?: () => string;
  createToken?: () => string;
  now?: () => Date;
  origin?: () => string;
}

export function createCheckoutHandoffService({ repository, commerce = commerceService, createKey = newId, createToken = () => `vch_${randomBytes(32).toString('base64url')}`, now = () => new Date(), origin = checkoutOrigin }: CheckoutHandoffServiceDependencies) {
  const tokenHash = (token: string) => createHash('sha256').update(checkoutHandoffTokenSchema.parse(token)).digest('hex');
  return Object.freeze({
    async issue(rawInput: unknown, trustedUserKey: string, requestIdempotencyKey: string) {
      const input = checkoutCreateInputSchema.parse(rawInput);
      await commerce.getCheckoutProduct(input.productId);
      const baseUrl = origin();
      const token = checkoutHandoffTokenSchema.parse(createToken());
      const key = createKey();
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + CHECKOUT_HANDOFF_TTL_MS).toISOString();
      const issuanceKey = createHash('sha256').update(`${trustedUserKey}\0${requestIdempotencyKey}`).digest('hex');
      const requestHash = createHash('sha256').update(`${trustedUserKey}\0${input.productId}`).digest('hex');
      const issued = await repository.issue(checkoutHandoffSchema.parse({
        key,
        tokenHash: tokenHash(token),
        issuanceKey,
        requestHash,
        purpose: CHECKOUT_HANDOFF_PURPOSE,
        userKey: trustedUserKey,
        productId: input.productId,
        checkoutIdempotencyKey: `handoff:${createHash('sha256').update(`${trustedUserKey}\0${requestIdempotencyKey}`).digest('hex')}`,
        expiresAt,
        claimLeaseKey: null,
        claimLeaseExpiresAt: null,
        consumedAt: null,
        checkoutKey: null,
        createdAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(),
      }), createdAt.toISOString());
      if (issued === 'duplicate') throw new CheckoutHandoffIssueConflictError('Checkout handoff was already issued; reuse the original URL.');
      if (issued === 'conflict') throw new CheckoutHandoffIssueConflictError('Checkout handoff idempotency key conflicts with another request.');
      return checkoutHandoffIssueResultSchema.parse({ url: `${baseUrl}/checkout#handoff=${token}`, expiresAt });
    },
    async inspect(rawInput: unknown) {
      const input = checkoutHandoffInputSchema.parse(rawInput);
      const handoff = await repository.inspect(tokenHash(input.token), now().toISOString());
      if (!handoff) throw new CheckoutHandoffUnavailableError();
      return checkoutHandoffInspectResultSchema.parse({ product: await commerce.getCheckoutProduct(handoff.productId), expiresAt: handoff.expiresAt });
    },
    async continue(rawInput: unknown, customerIpAddress?: string) {
      const input = checkoutHandoffInputSchema.parse(rawInput);
      const hash = tokenHash(input.token);
      const claimedAt = now();
      const leaseKey = createKey();
      const handoff = await repository.claim(hash, leaseKey, claimedAt.toISOString(), new Date(claimedAt.getTime() + CHECKOUT_HANDOFF_LEASE_MS).toISOString());
      if (!handoff) throw new CheckoutHandoffUnavailableError();
      try {
        const checkout = customerIpAddress
          ? await commerce.createCheckout({ productId: handoff.productId }, handoff.userKey, handoff.checkoutIdempotencyKey, customerIpAddress)
          : await commerce.createCheckout({ productId: handoff.productId }, handoff.userKey, handoff.checkoutIdempotencyKey);
        const consumed = await repository.consume(hash, leaseKey, checkout.key, now().toISOString());
        if (!consumed) throw new CheckoutHandoffUnavailableError();
        return checkoutHandoffContinueResultSchema.parse({ url: checkout.url });
      } catch (error) {
        await repository.release(hash, leaseKey, now().toISOString());
        throw error;
      }
    },
  });
}

export const checkoutHandoffService = createCheckoutHandoffService({ repository: createArangoCheckoutHandoffRepository() });
export type CheckoutHandoffService = ReturnType<typeof createCheckoutHandoffService>;
