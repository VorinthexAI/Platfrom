import type { Product } from './contracts';
import { resolvePurchaseGrantMicroSparks } from '@/lib/costs';

const seededAt = '2026-09-05T00:00:00.000Z';

export const COMMERCE_CATALOG = Object.freeze([
  { key: 'cml9commerce0000000000001', productId: 'nova.weekly', type: 'subscription', priceCents: 799, discountedPriceCents: null, currency: 'USD', billingPeriod: 'week', sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('nova.weekly'), active: true, providerProductId: null, createdAt: seededAt, updatedAt: seededAt },
  { key: 'cml9commerce0000000000002', productId: 'nova.monthly', type: 'subscription', priceCents: 2499, discountedPriceCents: null, currency: 'USD', billingPeriod: 'month', sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('nova.monthly'), active: false, providerProductId: null, createdAt: seededAt, updatedAt: seededAt },
  { key: 'cml9commerce0000000000003', productId: 'nova.monthly.discounted', type: 'subscription', priceCents: 2499, discountedPriceCents: 1999, currency: 'USD', billingPeriod: 'month', sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('nova.monthly.discounted'), active: true, providerProductId: null, createdAt: seededAt, updatedAt: seededAt },
  { key: 'cml9commerce0000000000004', productId: 'topup.small', type: 'one_time', priceCents: 999, discountedPriceCents: null, currency: 'USD', billingPeriod: null, sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('topup.small'), active: true, providerProductId: null, createdAt: seededAt, updatedAt: seededAt },
] satisfies readonly Product[]);
