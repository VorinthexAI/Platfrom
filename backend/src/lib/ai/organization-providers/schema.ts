import { z } from 'zod';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { providerIdSchema, type ProviderId } from '@/lib/ai/providers/types';

/**
 * Strict allow-list: one document per provider enabled for one
 * organization. Existence of the document MEANS enabled — there is
 * deliberately no `enabled` boolean; disabling a provider deletes its
 * document. Named per the repo's camelCase-plural collection convention
 * (the legacy organization_providers name is migrated in arango-migrate).
 */
export const ORGANIZATION_PROVIDERS_COLLECTION = 'organizationProviders';

/**
 * Intentionally minimal document. Per repo convention the primary-key
 * field is ALWAYS `key` — application code never reads or writes Arango's
 * `_key` directly; only the shared base.ts translators touch it. Like the
 * node schemas, this parses in zod's default strip mode so Arango system
 * attributes (`_key`/`_id`/`_rev`) drop away silently on read.
 * `organizationId` is validated as a non-empty string, not `.cuid2()`,
 * because legacy organization keys predate CUID2.
 */
export const organizationProviderSchema = z.object({
  key: z.string().min(1),
  organizationId: organizationIdSchema,
  providerId: providerIdSchema,
  /** Human-readable provider name (PROVIDER_NAMES) — the embedded text. */
  name: z.string().min(1),
  /** Backfilled by arango-migrate from embedKeys; ids are never embedded. */
  embedding: z.array(z.number()).default([]),
});

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
