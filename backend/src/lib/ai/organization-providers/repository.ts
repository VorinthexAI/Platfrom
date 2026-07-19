import { db } from '@/lib/db/client';
import { z } from 'zod';
import { isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { recordOrganizationEvent, type OrganizationEventRecorder } from '@/lib/live/organization-events';
import { ORGANIZATION_PROVIDERS_COLLECTION, organizationProviderSchema, type OrganizationProvider } from './schema';
import { DuplicateOrganizationProviderError, OrganizationProviderNotFoundError, type OrganizationProviderRepository, type OrganizationProvidersDatabase } from './types';

export function createOrganizationProviderRepository(
  database: OrganizationProvidersDatabase = db,
  recordEvent: OrganizationEventRecorder = recordOrganizationEvent,
): OrganizationProviderRepository {
  async function event(scopeKey: string | undefined, slug: 'organization.provider.create' | 'organization.provider.update' | 'organization.provider.usage', provider: OrganizationProvider) {
    if (!scopeKey) return;
    await recordEvent({ scopeId: scopeKey, slug, data: { nodeType: 'organizationProviders', nodeKey: provider.key } });
  }

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
    async addProvider(organizationKey, provider, scopeKey) {
      const timestamp = new Date().toISOString();
      const document = organizationProviderSchema.parse({
        key: newId(),
        organizationKey,
        ...provider,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        lastUsedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        embedding: [],
      });
      try {
        const result = await database.collection(ORGANIZATION_PROVIDERS_COLLECTION).save(toArangoDoc(document), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        const created = saved ? organizationProviderSchema.parse(withArangoKey(saved)) : document;
        await event(scopeKey, 'organization.provider.create', created);
        return created;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateOrganizationProviderError(document.organizationKey, document.providerKey);
        throw error;
      }
    },
    async upsertProvider(organizationKey, provider, scopeKey) {
      try {
        return await this.addProvider(organizationKey, provider, scopeKey);
      } catch (error) {
        if (!(error instanceof DuplicateOrganizationProviderError)) throw error;
        const valid = organizationProviderSchema.pick({ organizationKey: true, providerKey: true }).parse({ organizationKey, providerKey: provider.providerKey });
        const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey LIMIT 1 RETURN link', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, ...valid });
        const existing = await cursor.next();
        if (!existing || typeof existing !== 'object') throw error;
        return organizationProviderSchema.parse(withArangoKey(existing as Record<string, unknown>));
      }
    },
    async updateProvider(organizationKey, providerKey, patch, scopeKey) {
      const valid = organizationProviderSchema.pick({ organizationKey: true, providerKey: true }).parse({ organizationKey, providerKey });
      const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey LIMIT 1 RETURN link._key', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, ...valid });
      const key = await cursor.next();
      if (typeof key !== 'string') throw new OrganizationProviderNotFoundError(valid.organizationKey, valid.providerKey);
      const updatedAt = new Date().toISOString();
      const result = await database.collection(ORGANIZATION_PROVIDERS_COLLECTION).update(key, { ...organizationProviderSchema.pick({ name: true, description: true }).parse(patch), updatedAt }, { returnNew: true });
      const updated = organizationProviderSchema.parse(withArangoKey((result as { new: Record<string, unknown> }).new));
      await event(scopeKey, 'organization.provider.update', updated);
      return updated;
    },
    async recordUsage(organizationKey, providerKey, usage, scopeKey) {
      const valid = organizationProviderSchema.pick({ organizationKey: true, providerKey: true }).parse({ organizationKey, providerKey });
      const cursor = await database.query('FOR link IN @@collection FILTER link.organizationKey == @organizationKey && link.providerKey == @providerKey LIMIT 1 RETURN link', { '@collection': ORGANIZATION_PROVIDERS_COLLECTION, ...valid });
      const current = await cursor.next();
      if (!current || typeof current !== 'object') throw new OrganizationProviderNotFoundError(valid.organizationKey, valid.providerKey);
      const provider = organizationProviderSchema.parse(withArangoKey(current as Record<string, unknown>));
      const increment = z.object({ inputTokens: z.number().finite().nonnegative(), outputTokens: z.number().finite().nonnegative(), totalTokens: z.number().finite().nonnegative() }).strict().parse(usage);
      const timestamp = new Date().toISOString();
      const result = await database.collection(ORGANIZATION_PROVIDERS_COLLECTION).update(provider.key, {
        inputTokens: provider.inputTokens + increment.inputTokens,
        outputTokens: provider.outputTokens + increment.outputTokens,
        totalTokens: provider.totalTokens + increment.totalTokens,
        lastUsedAt: timestamp,
        updatedAt: timestamp,
      }, { returnNew: true });
      const updated = organizationProviderSchema.parse(withArangoKey((result as { new: Record<string, unknown> }).new));
      await event(scopeKey, 'organization.provider.usage', updated);
      return updated;
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
