import { getProviderBySlug, providerSlugSchema, type ProviderSlug } from '@/lib/db/providers.node';
import { getOrganizationById } from '@/lib/db/organizations.node';
import { organizationProviderSchema, type OrganizationProvider } from './schema';
import { getDefaultOrganizationProviderRepository } from './repository';
import { OrganizationProviderReferenceError, type OrganizationProviderRepository } from './types';

export interface OrganizationProviderReferenceResolver {
  organizationExists(key: string): Promise<boolean>;
  providerForSlug(slug: ProviderSlug): Promise<{ key: string; name: string } | null>;
}
const defaultResolver: OrganizationProviderReferenceResolver = {
  async organizationExists(key) { return (await getOrganizationById(key)) !== null; },
  async providerForSlug(slug) {
    const provider = await getProviderBySlug(slug);
    return provider ? { key: provider.key, name: provider.name } : null;
  },
};
export interface OrganizationProviderService {
  enableProvider(organizationKey: string, providerSlug: ProviderSlug, scopeKey?: string): Promise<OrganizationProvider>;
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
    const provider = await resolver.providerForSlug(validProviderSlug);
    if (!provider) throw new OrganizationProviderReferenceError('provider', validProviderSlug);
    return {
      organizationKey: validOrganizationKey,
      providerKey: organizationProviderSchema.shape.providerKey.parse(provider.key),
      name: organizationProviderSchema.shape.name.parse(provider.name),
    };
  }
  return {
    async enableProvider(organizationKey, providerSlug, scopeKey) {
      const provider = await resolve(organizationKey, providerSlug);
      return repository.addProvider(provider.organizationKey, { providerKey: provider.providerKey, name: provider.name, description: null }, scopeKey);
    },
    async disableProvider(organizationKey, providerSlug) { const keys = await resolve(organizationKey, providerSlug); return repository.removeProvider(keys.organizationKey, keys.providerKey); },
    async listEnabledProviderKeys(organizationKey) { return repository.listProviderKeys(organizationProviderSchema.shape.organizationKey.parse(organizationKey)); },
    async isProviderEnabled(organizationKey, providerSlug) { const keys = await resolve(organizationKey, providerSlug); return repository.hasProvider(keys.organizationKey, keys.providerKey); },
  };
}
