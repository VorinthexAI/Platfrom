import { z } from 'zod';
import { subscriptionSchema } from './contracts';

// Keep the public response independent of provider identifiers and ledger metadata.
export const currentSubscriptionResponseSchema = subscriptionSchema.omit({
  providerSubscriptionId: true,
  providerModifiedAt: true,
}).nullable();

export const scheduledSubscriptionResponseSchema = subscriptionSchema.omit({
  providerSubscriptionId: true,
  providerModifiedAt: true,
}).extend({ pendingProductKey: z.string().cuid().nullable() }).nullable();
