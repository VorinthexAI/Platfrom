import type { ProviderId } from '@/lib/ai/providers/types';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { providerIdSchema } from '@/lib/ai/providers/types';
import { getDefaultOrganizationProviderRepository } from './repository';
import type { OrganizationProvider } from './schema';
import { InvalidOrganizationIdError, UnknownProviderIdError, type OrganizationProviderRepository } from './types';

export interface OrganizationProviderService {
  /** Enables a provider for the organization. Throws `DuplicateOrganizationProviderError` when already enabled. */
  enableProvider(organizationId: string, providerId: string): Promise<OrganizationProvider>;
  /** Disables a provider by deleting its allow-list document. Throws `OrganizationProviderNotFoundError` when not enabled. */
  disableProvider(organizationId: string, providerId: string): Promise<void>;
  listEnabledProviderIds(organizationId: string): Promise<readonly ProviderId[]>;
  isProviderEnabled(organizationId: string, providerId: string): Promise<boolean>;
}

function validateOrganizationId(organizationId: string): string {
  const parsed = organizationIdSchema.safeParse(organizationId);
  if (!parsed.success) throw new InvalidOrganizationIdError();
  return parsed.data;
}

/**
 * Provider ids arrive from clients here — they are ALWAYS validated
 * against `PROVIDER_IDS` before touching the database; a client can never
 * enable (or query) a provider the platform does not know.
 */
function validateProviderId(providerId: string): ProviderId {
  const parsed = providerIdSchema.safeParse(providerId);
  if (!parsed.success) throw new UnknownProviderIdError(providerId);
  return parsed.data;
}

export function createOrganizationProviderService(
  repository: OrganizationProviderRepository = getDefaultOrganizationProviderRepository(),
): OrganizationProviderService {
  return {
    async enableProvider(organizationId, providerId) {
      return repository.addProvider(validateOrganizationId(organizationId), validateProviderId(providerId));
    },

    async disableProvider(organizationId, providerId) {
      await repository.removeProvider(validateOrganizationId(organizationId), validateProviderId(providerId));
    },

    async listEnabledProviderIds(organizationId) {
      return repository.listProviderIds(validateOrganizationId(organizationId));
    },

    async isProviderEnabled(organizationId, providerId) {
      return repository.hasProvider(validateOrganizationId(organizationId), validateProviderId(providerId));
    },
  };
}
