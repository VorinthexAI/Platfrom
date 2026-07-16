import { getProviderBySlug, providerSlugSchema, type ProviderSlug } from '@/lib/db/providers.node';
import { getOrganizationById } from '@/lib/db/organizations.node';
import { organizationProviderSchema, type OrganizationProvider } from './schema';
import { getDefaultOrganizationProviderRepository } from './repository';
import { OrganizationProviderReferenceError, type OrganizationProviderRepository } from './types';

export interface OrganizationProviderReferenceResolver {
  organizationExists(key: string): Promise<boolean>;
  providerKeyForSlug(slug: ProviderSlug): Promise<string | null>;
}
const defaultResolver: OrganizationProviderReferenceResolver = {
  async organizationExists(key) { return (await getOrganizationById(key)) !== null; },
  async providerKeyForSlug(slug) { return (await getProviderBySlug(slug))?.key ?? null; },
};
export interface OrganizationProviderService {
  enableProvider(organizationKey: string, providerSlug: ProviderSlug): Promise<OrganizationProvider>;
  disableProvider(organizationKey: string, providerSlug: ProviderSlug): Promise<void>;
  listEnabledProviderKeys(organizationKey: string): Promise<readonly string[]>;
  isProviderEnabled(organizationKey: string, providerSlug: ProviderSlug): Promise<boolean>;
}
export function createOrganizationProviderService(
  repository: OrganizationProviderRepository = getDefaultOrganizationProviderRepository(),
  resolver: OrganizationProviderReferenceResolver = defaultResolver,
): OrganizationProviderService {
  async function resolve(organizationKey: string, providerSlug: ProviderSlug) {
    const validOrganizationKey = organizationProviderSchema.shape.organizationKey.parse(organizationKey);
    const validProviderSlug = providerSlugSchema.parse(providerSlug);
    if (!(await resolver.organizationExists(validOrganizationKey))) throw new OrganizationProviderReferenceError('organization', validOrganizationKey);
    const providerKey = await resolver.providerKeyForSlug(validProviderSlug);
    if (!providerKey) throw new OrganizationProviderReferenceError('provider', validProviderSlug);
    return { organizationKey: validOrganizationKey, providerKey: organizationProviderSchema.shape.providerKey.parse(providerKey) };
  }
  return {
    async enableProvider(organizationKey, providerSlug) { const keys = await resolve(organizationKey, providerSlug); return repository.addProvider(keys.organizationKey, keys.providerKey); },
    async disableProvider(organizationKey, providerSlug) { const keys = await resolve(organizationKey, providerSlug); return repository.removeProvider(keys.organizationKey, keys.providerKey); },
    async listEnabledProviderKeys(organizationKey) { return repository.listProviderKeys(organizationProviderSchema.shape.organizationKey.parse(organizationKey)); },
    async isProviderEnabled(organizationKey, providerSlug) { const keys = await resolve(organizationKey, providerSlug); return repository.hasProvider(keys.organizationKey, keys.providerKey); },
  };
}
