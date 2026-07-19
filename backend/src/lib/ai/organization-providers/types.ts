import { AiError } from '@/lib/ai/shared/result';
import type { OrganizationProvider } from './schema';

export interface OrganizationProviderRepository {
  listProviderKeys(organizationKey: string): Promise<readonly string[]>;
  hasProvider(organizationKey: string, providerKey: string): Promise<boolean>;
  addProvider(organizationKey: string, provider: Pick<OrganizationProvider, 'providerKey' | 'name' | 'description'>, scopeKey?: string): Promise<OrganizationProvider>;
  upsertProvider(organizationKey: string, provider: Pick<OrganizationProvider, 'providerKey' | 'name' | 'description'>, scopeKey?: string): Promise<OrganizationProvider>;
  updateProvider(organizationKey: string, providerKey: string, patch: Pick<OrganizationProvider, 'name' | 'description'>, scopeKey?: string): Promise<OrganizationProvider>;
  recordUsage(organizationKey: string, providerKey: string, usage: { inputTokens: number; outputTokens: number; totalTokens: number }, scopeKey?: string): Promise<OrganizationProvider>;
  removeProvider(organizationKey: string, providerKey: string): Promise<void>;
}
export class DuplicateOrganizationProviderError extends AiError {
  constructor(organizationKey: string, providerKey: string) { super('duplicate_organization_provider', `Provider ${providerKey} is already enabled for organization ${organizationKey}`); }
}
export class OrganizationProviderNotFoundError extends AiError {
  constructor(organizationKey: string, providerKey: string) { super('organization_provider_not_found', `Provider ${providerKey} is not enabled for organization ${organizationKey}`); }
}
export class OrganizationProviderReferenceError extends AiError {
  constructor(entity: 'organization' | 'provider', value: string) { super('organization_provider_reference_not_found', `${entity} not found: ${value}`); }
}
export interface OrganizationProvidersDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]>; next(): Promise<unknown> }>;
  collection(name: string): { save(doc: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>; update(selector: string, patch: Record<string, unknown>, options?: { returnNew?: boolean }): Promise<unknown>; remove(selector: string): Promise<unknown> };
}
export interface OrganizationProvidersSetupDatabase {
  collection(name: string): { exists(): Promise<boolean>; create(): Promise<unknown>; ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }): Promise<unknown> };
}
