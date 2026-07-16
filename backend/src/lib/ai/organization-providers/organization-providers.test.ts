import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createOrganizationProviderRepository } from './repository';
import { organizationProviderSchema, ORGANIZATION_PROVIDERS_COLLECTION } from './schema';
import { createOrganizationProviderService } from './service';
import { DuplicateOrganizationProviderError, OrganizationProviderReferenceError, type OrganizationProvidersDatabase } from './types';
import { ensureOrganizationProvidersCollection } from './indexes';

function memoryDatabase(): OrganizationProvidersDatabase & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async query(query, vars = {}) {
      const matches = [...docs.values()].filter((doc) => doc.organizationKey === vars.organizationKey && (!('providerKey' in vars) || doc.providerKey === vars.providerKey));
      return {
        async all() { return query.includes('RETURN link.providerKey') ? matches.map((doc) => doc.providerKey) : matches; },
        async next() { if (query.includes('RETURN true')) return matches.length > 0 ? true : undefined; if (query.includes('RETURN link._key')) return matches[0]?._key; return matches[0]; },
      };
    },
    collection() {
      return {
        async save(doc) {
          if ([...docs.values()].some((existing) => existing.organizationKey === doc.organizationKey && existing.providerKey === doc.providerKey)) throw { errorNum: 1210 };
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async remove(key) { docs.delete(key); },
      };
    },
  };
}

describe('organizationProviders key allow-list', () => {
  test('schema accepts the preserved root organization key and CUID provider key', () => {
    const link = organizationProviderSchema.parse({ key: newId(), organizationKey: 'legacy-root-key', providerKey: newId() });
    expect(Object.keys(link)).toEqual(['key', 'organizationKey', 'providerKey']);
    expect(link.organizationKey).toBe('legacy-root-key');
    expect(() => organizationProviderSchema.parse({ ...link, organizationKey: '' })).toThrow();
    expect(() => organizationProviderSchema.parse({ ...link, providerKey: 'legacy-provider-key' })).toThrow();
    expect(() => organizationProviderSchema.parse({ ...link, enabled: true })).toThrow();
  });

  test('repository adds, lists, checks, rejects duplicates and removes deterministically', async () => {
    const database = memoryDatabase();
    const repository = createOrganizationProviderRepository(database);
    const organizationKey = newId();
    const providerKey = newId();
    await repository.addProvider(organizationKey, providerKey);
    expect(await repository.listProviderKeys(organizationKey)).toEqual([providerKey]);
    expect(await repository.hasProvider(organizationKey, providerKey)).toBe(true);
    await expect(repository.addProvider(organizationKey, providerKey)).rejects.toBeInstanceOf(DuplicateOrganizationProviderError);
    await repository.removeProvider(organizationKey, providerKey);
    expect(await repository.hasProvider(organizationKey, providerKey)).toBe(false);
  });

  test('service resolves provider slugs and rejects missing references', async () => {
    const repository = createOrganizationProviderRepository(memoryDatabase());
    const organizationKey = newId();
    const providerKey = newId();
    const service = createOrganizationProviderService(repository, { async organizationExists(key) { return key === organizationKey; }, async providerKeyForSlug(slug) { return slug === 'openai' ? providerKey : null; } });
    expect((await service.enableProvider(organizationKey, 'openai')).providerKey).toBe(providerKey);
    await expect(service.enableProvider(newId(), 'openai')).rejects.toBeInstanceOf(OrganizationProviderReferenceError);
  });

  test('index setup is idempotent and key-based', async () => {
    const indexes: string[][] = [];
    let exists = false;
    const database = { collection(name: string) { expect(name).toBe(ORGANIZATION_PROVIDERS_COLLECTION); return { async exists() { return exists; }, async create() { exists = true; }, async ensureIndex(index: { fields: string[] }) { indexes.push(index.fields); } }; } };
    await ensureOrganizationProvidersCollection(database);
    await ensureOrganizationProvidersCollection(database);
    expect(indexes).toEqual([['organizationKey', 'providerKey'], ['organizationKey', 'providerKey']]);
  });
});
