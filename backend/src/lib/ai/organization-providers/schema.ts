import { z } from 'zod';
import { organizationKeySchema } from '@/lib/ai/shared/ids';

export const ORGANIZATION_PROVIDERS_COLLECTION = 'organizationProviders';
export const organizationProviderSchema = z.object({
  key: z.string().cuid(),
  // The root organization preserves its pre-CUID production key.
  organizationKey: organizationKeySchema,
  providerKey: z.string().cuid(),
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().min(1).max(2_000).nullable().default(null),
  inputTokens: z.number().finite().nonnegative().default(0),
  outputTokens: z.number().finite().nonnegative().default(0),
  totalTokens: z.number().finite().nonnegative().default(0),
  lastUsedAt: z.string().datetime().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  embedding: z.array(z.number().finite()).default([]),
}).strict();
export type OrganizationProvider = z.infer<typeof organizationProviderSchema>;
