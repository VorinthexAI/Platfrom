import { z } from 'zod';

export const ORGANIZATION_PROVIDERS_COLLECTION = 'organizationProviders';
export const organizationProviderSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  providerKey: z.string().cuid(),
}).strict();
export type OrganizationProvider = z.infer<typeof organizationProviderSchema>;
