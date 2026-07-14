import { z } from 'zod';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { providerIdSchema, type ProviderId } from '@/lib/ai/providers/types';

/**
 * Strict allow-list: one document per provider enabled for one
 * organization. Existence of the document MEANS enabled — there is
 * deliberately no `enabled` boolean; disabling a provider deletes its
 * document. The collection name is fixed by the execution-layer spec.
 */
export const ORGANIZATION_PROVIDERS_COLLECTION = 'organization_providers';

/**
 * Intentionally minimal document. Per repo convention the public
 * primary-key field is `key` (translated to Arango's `_key` only at the
 * storage boundary). `organizationId` is validated as a non-empty string,
 * not `.cuid2()`, because legacy organization keys predate CUID2.
 */
export const organizationProviderSchema = z
  .object({
    key: z.string().min(1),
    organizationId: organizationIdSchema,
    providerId: providerIdSchema,
  })
  .strict();

export type OrganizationProvider = z.infer<typeof organizationProviderSchema>;

/**
 * Deterministic document key for one (organization, provider) pair — makes
 * writes idempotent to reason about and removals addressable by key. The
 * unique persistent index on ["organizationId", "providerId"] remains the
 * database-level guarantee against duplicates.
 */
export function organizationProviderKey(organizationId: string, providerId: ProviderId): string {
  return `${organizationId}:${providerId}`;
}
