import { AiError } from '@/lib/ai/shared/result';
import type { ProviderId } from '@/lib/ai/providers/types';
import type { OrganizationProvider } from './schema';

export interface OrganizationProviderRepository {
  listProviderIds(organizationId: string): Promise<readonly ProviderId[]>;

  hasProvider(organizationId: string, providerId: ProviderId): Promise<boolean>;

  addProvider(organizationId: string, providerId: ProviderId): Promise<OrganizationProvider>;

  removeProvider(organizationId: string, providerId: ProviderId): Promise<void>;
}

export class InvalidOrganizationIdError extends AiError {
  constructor() {
    super('invalid_organization_id', 'organizationId must be a non-empty string');
  }
}

export class UnknownProviderIdError extends AiError {
  constructor(providerId: string) {
    super('unknown_provider_id', `Unknown provider id: ${providerId}`);
  }
}

export class DuplicateOrganizationProviderError extends AiError {
  constructor(organizationId: string, providerId: string) {
    super('duplicate_organization_provider', `Provider ${providerId} is already enabled for organization ${organizationId}`);
  }
}

export class OrganizationProviderNotFoundError extends AiError {
  constructor(organizationId: string, providerId: string) {
    super('organization_provider_not_found', `Provider ${providerId} is not enabled for organization ${organizationId}`);
  }
}

/**
 * The narrow slice of an arangojs `Database` the repository uses — kept
 * structural so tests can substitute an in-memory fake without a live
 * ArangoDB.
 */
export interface OrganizationProvidersDatabase {
  query(
    query: string,
    bindVars?: Record<string, unknown>,
  ): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): {
    save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>;
    remove(selector: string): Promise<unknown>;
  };
}

/** The slice used by idempotent collection/index setup. */
export interface OrganizationProvidersSetupDatabase {
  collection(name: string): {
    exists(): Promise<boolean>;
    create(): Promise<unknown>;
    ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown>;
  };
}
