import { db } from '@/lib/db/client';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { ORGANIZATION_PROVIDERS_COLLECTION, organizationProviderSchema } from './schema';
import { DuplicateOrganizationProviderError, OrganizationProviderNotFoundError, type OrganizationProviderRepository, type OrganizationProvidersDatabase } from './types';

export function createOrganizationProviderRepository(database: OrganizationProvidersDatabase = db): OrganizationProviderRepository {
  return {
    async listProviderKeys(organizationKey) {
      const validOrganizationKey = organizationProviderSchema.shape.organizationKey.parse(organizationKey);
      const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey SORT link.providerKey ASC RETURN link.providerKey', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, organizationKey: validOrganizationKey });
      return (await cursor.all()).map((key) => organizationProviderSchema.shape.providerKey.parse(key));
    },
    async hasProvider(organizationKey, providerKey) {
      const valid = organizationProviderSchema.pick({ organizationKey: true, providerKey: true }).parse({ organizationKey, providerKey });
      const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey LIMIT 1 RETURN true', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, ...valid });
      return (await cursor.next()) === true;
    },
    async addProvider(organizationKey, providerKey) {
      const document = organizationProviderSchema.parse({ key: newId(), organizationKey, providerKey });
      try {
        const result = await database.collection(ORGANIZATION_PROVIDERS_COLLECTION).save(toArangoDoc(document), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return saved ? organizationProviderSchema.parse(withArangoKey(saved)) : document;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateOrganizationProviderError(document.organizationKey, document.providerKey);
        throw error;
      }
    },
    async removeProvider(organizationKey, providerKey) {
      const valid = organizationProviderSchema.pick({ organizationKey: true, providerKey: true }).parse({ organizationKey, providerKey });
      const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey LIMIT 1 RETURN link._key', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, ...valid });
      const key = await cursor.next();
      if (typeof key !== 'string') throw new OrganizationProviderNotFoundError(valid.organizationKey, valid.providerKey);
      await database.collection(ORGANIZATION_PROVIDERS_COLLECTION).remove(key);
    },
  };
}
let cachedDefaultRepository: OrganizationProviderRepository | null = null;
export function getDefaultOrganizationProviderRepository() { return cachedDefaultRepository ??= createOrganizationProviderRepository(); }
