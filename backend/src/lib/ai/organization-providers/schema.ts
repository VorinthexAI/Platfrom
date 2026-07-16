import { z } from 'zod';

export const ORGANIZATION_PROVIDERS_COLLECTION = 'organizationProviders';
export const organizationProviderSchema = z.object({
  key: z.string().cuid(),
  // The root organization preserves its pre-CUID production key.
  organizationKey: z.string().trim().min(1),
  providerKey: z.string().cuid(),
}).strict();
export type OrganizationProvider = z.infer<typeof organizationProviderSchema>;
