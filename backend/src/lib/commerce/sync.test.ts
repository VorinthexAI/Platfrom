import { describe, expect, test } from 'bun:test';
import { COMMERCE_CATALOG } from './catalog';
import { synchronizeCommerceProducts } from './sync';
import type { CommerceRepository } from './repository';
import type { PolarProvider, PolarProduct } from './polar';

const remote = (localIndex: number, overrides: Partial<PolarProduct> = {}): PolarProduct => ({
  id: `remote-${localIndex}`,
  name: COMMERCE_CATALOG[localIndex]!.productId,
  metadata: { productId: COMMERCE_CATALOG[localIndex]!.productId },
  recurring_interval: COMMERCE_CATALOG[localIndex]!.billingPeriod,
  is_archived: false,
  prices: [{ id: `price-${localIndex}`, amount_type: 'fixed', price_currency: 'usd', price_amount: COMMERCE_CATALOG[localIndex]!.discountedPriceCents ?? COMMERCE_CATALOG[localIndex]!.priceCents, tax_behavior: 'exclusive', is_archived: false }],
  ...overrides,
});

describe('commerce product synchronization', () => {
  test('reconnects a fresh local catalog by metadata without creating products or prices', async () => {
    const linked: unknown[] = []; const updates: unknown[] = [];
    const repository = { listProducts: async () => [COMMERCE_CATALOG[0]], updateProductProviderId: async (...args: unknown[]) => { linked.push(args); } } as unknown as CommerceRepository;
    const provider = { listProducts: async () => [remote(0)], createProduct: async () => { throw new Error('must not create'); }, updateProduct: async (...args: unknown[]) => { updates.push(args); } } as unknown as PolarProvider;
    await synchronizeCommerceProducts(repository, provider, () => new Date('2026-09-05T12:00:00.000Z'));
    expect(linked).toEqual([[COMMERCE_CATALOG[0].key, 'remote-0', '2026-09-05T12:00:00.000Z']]);
    expect(updates).toEqual([]);
  });

  test('archives inactive known products and only replaces a price when it changed', async () => {
    const updates: unknown[] = [];
    const products = [{ ...COMMERCE_CATALOG[1], providerProductId: 'remote-1' }, { ...COMMERCE_CATALOG[3], providerProductId: 'remote-3' }];
    const repository = { listProducts: async () => products, updateProductProviderId: async () => {} } as unknown as CommerceRepository;
    const provider = { listProducts: async () => [remote(1), remote(3, { prices: [{ id: 'old-price', amount_type: 'fixed', price_currency: 'usd', price_amount: 500, tax_behavior: 'exclusive', is_archived: false }] })], updateProduct: async (...args: unknown[]) => { updates.push(args); } } as unknown as PolarProvider;
    await synchronizeCommerceProducts(repository, provider);
    expect(updates).toEqual([['remote-1', { archived: true }], ['remote-3', { priceCents: 999 }]]);
  });

  test('keeps all prices untouched when any active fixed USD price already matches', async () => {
    const updates: unknown[] = [];
    const product = { ...COMMERCE_CATALOG[3], providerProductId: 'remote-3' };
    const existing = remote(3, { prices: [
      { id: 'other-price', amount_type: 'fixed', price_currency: 'usd', price_amount: 500, tax_behavior: 'exclusive', is_archived: false },
      { id: 'desired-price', amount_type: 'fixed', price_currency: 'usd', price_amount: 999, tax_behavior: 'exclusive', is_archived: false },
    ] });
    const repository = { listProducts: async () => [product], updateProductProviderId: async () => {} } as unknown as CommerceRepository;
    const provider = { listProducts: async () => [existing], updateProduct: async (...args: unknown[]) => { updates.push(args); } } as unknown as PolarProvider;
    await synchronizeCommerceProducts(repository, provider);
    expect(updates).toEqual([]);
  });

  test('replaces a matching amount when the active Polar price is not tax-exclusive', async () => {
    const updates: unknown[] = [];
    const product = { ...COMMERCE_CATALOG[3], providerProductId: 'remote-3' };
    const existing = remote(3, { prices: [{ id: 'inclusive-price', amount_type: 'fixed', price_currency: 'usd', price_amount: 999, tax_behavior: 'inclusive', is_archived: false }] });
    const repository = { listProducts: async () => [product], updateProductProviderId: async () => {} } as unknown as CommerceRepository;
    const provider = { listProducts: async () => [existing], updateProduct: async (...args: unknown[]) => { updates.push(args); } } as unknown as PolarProvider;
    await synchronizeCommerceProducts(repository, provider);
    expect(updates).toEqual([['remote-3', { priceCents: 999 }]]);
  });
});
