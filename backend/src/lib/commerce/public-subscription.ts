import { subscriptionSchema } from './contracts';

// contracts.ts is included in the checksum of the applied 0018 seed migration.
// Evolve the public response independently of those immutable migration inputs.
export const currentSubscriptionResponseSchema = subscriptionSchema.omit({
  providerSubscriptionId: true,
  providerModifiedAt: true,
}).nullable();
