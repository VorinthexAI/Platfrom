import type { Product } from './contracts';
import { resolvePurchaseGrantMicroSparks } from '@/lib/costs';

const seededAt = '2026-09-05T00:00:00.000Z';

export const COMMERCE_CATALOG = Object.freeze([
  { key: 'cml9commerce0000000000001', productId: 'nova.weekly', type: 'subscription', priceCents: 799, currency: 'USD', billingPeriod: 'week', sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('nova.weekly'), active: true, createdAt: seededAt, updatedAt: seededAt },
  { key: 'cml9commerce0000000000002', productId: 'nova.monthly', type: 'subscription', priceCents: 1999, currency: 'USD', billingPeriod: 'month', sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('nova.monthly'), active: true, createdAt: seededAt, updatedAt: seededAt },
  { key: 'cml9commerce0000000000004', productId: 'topup.small', type: 'one_time', priceCents: 999, currency: 'USD', billingPeriod: null, sparkGrantMicroSparks: resolvePurchaseGrantMicroSparks('topup.small'), active: true, createdAt: seededAt, updatedAt: seededAt },
] satisfies readonly Product[]);
