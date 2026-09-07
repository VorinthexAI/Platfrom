import { describe, expect, test } from 'bun:test';
import { COMMERCE_CATALOG } from './catalog';
import { productSchema, publicProductSchema } from './contracts';

describe('commerce product contracts', () => {
  test('accepts only the exact deterministic catalog and strict safe projection', () => {
    expect(COMMERCE_CATALOG.map((product) => productSchema.parse(product).productId)).toEqual(['nova.weekly', 'nova.monthly', 'nova.monthly.discounted', 'topup.small']);
    expect(COMMERCE_CATALOG.map(({ productId, priceCents, discountedPriceCents, sparkGrantMicroSparks, active }) => ({ productId, priceCents, discountedPriceCents, sparkGrantMicroSparks, active }))).toEqual([
      { productId: 'nova.weekly', priceCents: 799, discountedPriceCents: null, sparkGrantMicroSparks: 200_000_000, active: true },
      { productId: 'nova.monthly', priceCents: 2499, discountedPriceCents: null, sparkGrantMicroSparks: 1_000_000_000, active: false },
      { productId: 'nova.monthly.discounted', priceCents: 2499, discountedPriceCents: 1999, sparkGrantMicroSparks: 1_000_000_000, active: true },
      { productId: 'topup.small', priceCents: 999, discountedPriceCents: null, sparkGrantMicroSparks: 200_000_000, active: true },
    ]);
    const { providerProductId: _providerProductId, ...safe } = COMMERCE_CATALOG[0];
    expect(publicProductSchema.parse(safe)).not.toHaveProperty('providerProductId');
    expect(() => publicProductSchema.parse(COMMERCE_CATALOG[0])).toThrow('Unrecognized key');
  });

  test('rejects invalid type/period, discounts, currency, money, grants, IDs, keys, and unknown fields', () => {
    const base = COMMERCE_CATALOG[0];
    for (const invalid of [
      { ...base, billingPeriod: null },
      { ...base, type: 'one_time' },
      { ...base, discountedPriceCents: 799 },
      { ...base, discountedPriceCents: 900 },
      { ...base, currency: 'EUR' },
      { ...base, priceCents: 1.5 },
      { ...base, sparkGrantMicroSparks: 0 },
      { ...base, productId: 'other' },
      { ...base, key: 'not-a-cuid' },
      { ...base, secret: true },
    ]) expect(() => productSchema.parse(invalid)).toThrow();
    expect(() => productSchema.parse({ ...COMMERCE_CATALOG[3], billingPeriod: 'month' })).toThrow();
  });
});
