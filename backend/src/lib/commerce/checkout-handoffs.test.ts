import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { COMMERCE_CATALOG } from './catalog';
import { checkoutHandoffSchema } from './checkout-handoff-contracts';
import { CHECKOUT_HANDOFF_TTL_MS, CheckoutHandoffUnavailableError, checkoutOrigin, createCheckoutHandoffService } from './checkout-handoffs';
import type { CheckoutHandoff, } from './checkout-handoff-contracts';
import type { CheckoutHandoffRepository } from './checkout-handoffs-repository';

const at = new Date('2026-09-05T10:00:00.000Z');
const token = `vch_${'A'.repeat(43)}`;
const userKey = newId();
const handoffKey = newId();
const checkoutKey = newId();
const product = { ...COMMERCE_CATALOG[3], providerProductId: 'remote-topup' };
const { providerProductId: _providerProductId, ...safeProduct } = product;

function handoff(overrides: Partial<CheckoutHandoff> = {}): CheckoutHandoff {
  return checkoutHandoffSchema.parse({ key: handoffKey, tokenHash: createHash('sha256').update(token).digest('hex'), issuanceKey: 'b'.repeat(64), requestHash: 'c'.repeat(64), purpose: 'payment-checkout', userKey, productId: 'topup.small', checkoutIdempotencyKey: 'handoff:server', expiresAt: new Date(at.getTime() + CHECKOUT_HANDOFF_TTL_MS).toISOString(), claimLeaseKey: null, claimLeaseExpiresAt: null, consumedAt: null, checkoutKey: null, createdAt: at.toISOString(), updatedAt: at.toISOString(), ...overrides });
}

function repository(overrides: Partial<CheckoutHandoffRepository> = {}): CheckoutHandoffRepository {
  return { issue: async () => 'issued', inspect: async () => handoff(), claim: async () => handoff(), consume: async () => handoff({ consumedAt: at.toISOString(), checkoutKey }), release: async () => {}, ...overrides };
}

describe('checkout handoff contracts and service', () => {
  test('uses a strict private document contract with consistent lease and consumption fields', () => {
    expect(() => checkoutHandoffSchema.parse({ ...handoff(), rawToken: token })).toThrow('Unrecognized key');
    expect(() => checkoutHandoffSchema.parse({ ...handoff(), claimLeaseKey: newId() })).toThrow('Claim lease');
    expect(() => checkoutHandoffSchema.parse({ ...handoff(), consumedAt: at.toISOString() })).toThrow('Consumption');
  });

  test('issues an exact one-hour prefixed 256-bit handoff while persisting only its hash and trusted values', async () => {
    let inserted: CheckoutHandoff | undefined;
    const calls: unknown[] = [];
    const service = createCheckoutHandoffService({
      repository: repository({ issue: async (value) => { inserted = value; return 'issued'; } }),
      commerce: { getCheckoutProduct: async (value) => { calls.push(value); return safeProduct; }, createCheckout: async () => { throw new Error('unused'); } },
      createKey: () => handoffKey,
      createToken: () => token,
      now: () => at,
    });
    await expect(service.issue({ productId: 'topup.small' }, userKey, 'browser-request')).resolves.toEqual({ url: `https://vorinthex.com/checkout#handoff=${token}`, expiresAt: '2026-09-05T11:00:00.000Z' });
    expect(calls).toEqual(['topup.small']);
    expect(inserted).toMatchObject({ key: handoffKey, userKey, productId: 'topup.small', tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: '2026-09-05T11:00:00.000Z' });
    expect(JSON.stringify(inserted)).not.toContain(token);
    expect(inserted?.checkoutIdempotencyKey).toMatch(/^handoff:[a-f0-9]{64}$/);
  });

  test('rejects duplicate issuance deterministically without storing another token', async () => {
    let issues = 0;
    const service = createCheckoutHandoffService({ repository: repository({ issue: async () => { issues += 1; return 'duplicate'; } }), commerce: { getCheckoutProduct: async () => safeProduct, createCheckout: async () => { throw new Error('unused'); } }, createToken: () => token, now: () => at });
    await expect(service.issue({ productId: 'topup.small' }, userKey, 'same-request')).rejects.toThrow('already issued');
    expect(issues).toBe(1);
  });

  test('inspects without consuming and continues through canonical checkout before final consumption', async () => {
    const operations: string[] = [];
    const service = createCheckoutHandoffService({
      repository: repository({ inspect: async () => { operations.push('inspect'); return handoff(); }, claim: async () => { operations.push('claim'); return handoff(); }, consume: async (_hash, _lease, key) => { operations.push(`consume:${key}`); return handoff({ consumedAt: at.toISOString(), checkoutKey: key }); } }),
      commerce: { getCheckoutProduct: async () => safeProduct, createCheckout: async (input, trustedUser, idempotency, customerIpAddress) => { operations.push(`checkout:${trustedUser}:${idempotency}:${customerIpAddress}`); expect(input).toEqual({ productId: 'topup.small' }); return { key: checkoutKey, status: 'open', url: 'https://checkout.polar.sh/session' }; } },
      createKey: () => newId(), now: () => at,
    });
    const inspected = await service.inspect({ token });
    expect(inspected).toMatchObject({ product: { productId: 'topup.small' }, expiresAt: '2026-09-05T11:00:00.000Z' });
    expect(JSON.stringify(inspected)).not.toContain(userKey);
    await expect(service.continue({ token }, '203.0.113.7')).resolves.toEqual({ url: 'https://checkout.polar.sh/session' });
    expect(operations).toEqual(['inspect', 'claim', `checkout:${userKey}:handoff:server:203.0.113.7`, `consume:${checkoutKey}`]);
  });

  test('releases only the matching lease after transient checkout failure and fails generically when unavailable', async () => {
    const released: string[] = [];
    const service = createCheckoutHandoffService({ repository: repository({ claim: async () => handoff(), release: async (_hash, lease) => { released.push(lease); } }), commerce: { getCheckoutProduct: async () => safeProduct, createCheckout: async () => { throw new Error('transient'); } }, createKey: () => handoffKey, now: () => at });
    await expect(service.continue({ token })).rejects.toThrow('transient');
    expect(released).toEqual([handoffKey]);
    const unavailable = createCheckoutHandoffService({ repository: repository({ inspect: async () => null, claim: async () => null }), commerce: { getCheckoutProduct: async () => safeProduct, createCheckout: async () => { throw new Error('unused'); } } });
    await expect(unavailable.inspect({ token })).rejects.toBeInstanceOf(CheckoutHandoffUnavailableError);
    await expect(unavailable.continue({ token })).rejects.toBeInstanceOf(CheckoutHandoffUnavailableError);
  });

  test('validates configured checkout origins and rejects non-Polar checkout URLs', async () => {
    expect(checkoutOrigin({})).toBe('https://vorinthex.com');
    expect(checkoutOrigin({ CHECKOUT_ORIGIN: 'https://checkout.example.com' })).toBe('https://checkout.example.com');
    expect(() => checkoutOrigin({ CHECKOUT_ORIGIN: 'http://vorinthex.com' })).toThrow('HTTPS origin');
    const service = createCheckoutHandoffService({ repository: repository(), commerce: { getCheckoutProduct: async () => safeProduct, createCheckout: async () => ({ key: checkoutKey, status: 'open', url: 'https://attacker.example/checkout' }) } as never, createKey: () => handoffKey, now: () => at });
    await expect(service.continue({ token })).rejects.toThrow('allowed Polar');
  });
});
