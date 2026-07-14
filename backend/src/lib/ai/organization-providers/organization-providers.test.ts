import { describe, expect, test } from 'bun:test';
import { createOrganizationProviderRepository } from './repository';
import { createOrganizationProviderService } from './service';
import { ensureOrganizationProvidersCollection } from './indexes';
import { organizationProviderKey, organizationProviderSchema } from './schema';
import {
  DuplicateOrganizationProviderError,
  InvalidOrganizationIdError,
  OrganizationProviderNotFoundError,
  UnknownProviderIdError,
  type OrganizationProvidersDatabase,
  type OrganizationProvidersSetupDatabase,
} from './types';

/**
 * In-memory stand-in for the narrow ArangoDB surface the repository uses.
 * Mirrors Arango semantics: errorNum 1210 on unique-constraint violation,
 * errorNum 1202 on removing a missing document.
 */
function createFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();

  const fake: OrganizationProvidersDatabase = {
    async query(_query: string, bindVars: Record<string, unknown> = {}) {
      const matches = [...docs.values()].filter((doc) => doc.organizationId === bindVars.organizationId);
      if ('providerId' in bindVars) {
        const exists = matches.some((doc) => doc.providerId === bindVars.providerId);
        const rows = exists ? [true] : [];
        return { all: async () => rows, next: async () => rows[0] };
      }
      const rows = matches
        .map((doc) => doc.providerId)
        .sort();
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection() {
      return {
        async save(doc: Record<string, unknown>) {
          const key = String(doc._key);
          const duplicate =
            docs.has(key) ||
            [...docs.values()].some(
              (existing) => existing.organizationId === doc.organizationId && existing.providerId === doc.providerId,
            );
          if (duplicate) throw Object.assign(new Error('unique constraint violated'), { errorNum: 1210 });
          docs.set(key, doc);
          return { new: doc };
        },
        async remove(key: string) {
          if (!docs.has(key)) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          docs.delete(key);
          return {};
        },
      };
    },
  };

  return { fake, docs };
}

describe('organization provider schema', () => {
  test('is intentionally minimal — key, organizationId, providerId, nothing else', () => {
    const parsed = organizationProviderSchema.parse({ key: 'org1:openai', organizationId: 'org1', providerId: 'openai' });
    expect(parsed).toEqual({ key: 'org1:openai', organizationId: 'org1', providerId: 'openai' });
    // No enabled boolean — document existence IS enablement. Extra fields
    // (including Arango's own _key/_id/_rev on read) strip away silently.
    const stripped = organizationProviderSchema.parse({
      key: 'k',
      _key: 'k',
      organizationId: 'org1',
      providerId: 'openai',
      enabled: true,
    });
    expect(stripped).toEqual({ key: 'k', organizationId: 'org1', providerId: 'openai' });
  });

  test('rejects unknown provider ids', () => {
    expect(() =>
      organizationProviderSchema.parse({ key: 'k', organizationId: 'org1', providerId: 'perplexity' }),
    ).toThrow();
  });
});

describe('organization provider repository', () => {
  test('adds, lists, checks, and removes providers', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationProviderRepository(fake);

    const added = await repository.addProvider('org1', 'openai');
    expect(added).toEqual({ key: organizationProviderKey('org1', 'openai'), organizationId: 'org1', providerId: 'openai' });
    await repository.addProvider('org1', 'anthropic');
    await repository.addProvider('org2', 'xai');

    expect(await repository.listProviderIds('org1')).toEqual(['anthropic', 'openai']);
    expect(await repository.listProviderIds('org2')).toEqual(['xai']);
    expect(await repository.hasProvider('org1', 'openai')).toBe(true);
    expect(await repository.hasProvider('org1', 'xai')).toBe(false);

    await repository.removeProvider('org1', 'openai');
    expect(await repository.listProviderIds('org1')).toEqual(['anthropic']);
  });

  test('duplicate insertion fails deterministically', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationProviderRepository(fake);
    await repository.addProvider('org1', 'openai');
    expect(repository.addProvider('org1', 'openai')).rejects.toBeInstanceOf(DuplicateOrganizationProviderError);
  });

  test('removing a provider that is not enabled fails deterministically', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationProviderRepository(fake);
    expect(repository.removeProvider('org1', 'openai')).rejects.toBeInstanceOf(OrganizationProviderNotFoundError);
  });

  test('unknown provider ids and empty organization ids are rejected before any query', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationProviderRepository(fake);
    expect(repository.addProvider('org1', 'perplexity' as never)).rejects.toBeInstanceOf(UnknownProviderIdError);
    expect(repository.listProviderIds('')).rejects.toBeInstanceOf(InvalidOrganizationIdError);
  });

  test('stored provider ids that are no longer known are ignored on read', async () => {
    const { fake, docs } = createFakeDb();
    docs.set('org1:legacy', { _key: 'org1:legacy', organizationId: 'org1', providerId: 'legacy-provider' });
    docs.set('org1:openai', { _key: 'org1:openai', organizationId: 'org1', providerId: 'openai' });
    const repository = createOrganizationProviderRepository(fake);
    expect(await repository.listProviderIds('org1')).toEqual(['openai']);
  });
});

describe('organization provider service', () => {
  test('validates ids and delegates to the repository', async () => {
    const { fake } = createFakeDb();
    const service = createOrganizationProviderService(createOrganizationProviderRepository(fake));

    await service.enableProvider('org1', 'openai');
    expect(await service.isProviderEnabled('org1', 'openai')).toBe(true);
    expect(await service.listEnabledProviderIds('org1')).toEqual(['openai']);

    await service.disableProvider('org1', 'openai');
    expect(await service.isProviderEnabled('org1', 'openai')).toBe(false);

    expect(service.enableProvider('org1', 'not-a-provider')).rejects.toBeInstanceOf(UnknownProviderIdError);
    expect(service.enableProvider('', 'openai')).rejects.toBeInstanceOf(InvalidOrganizationIdError);
  });
});

describe('organization providers index setup', () => {
  test('collection creation and unique index creation are idempotent', async () => {
    let exists = false;
    let createCalls = 0;
    const ensuredIndexes: Array<{ type: string; fields: string[]; unique: boolean }> = [];
    const fake: OrganizationProvidersSetupDatabase = {
      collection() {
        return {
          async exists() {
            return exists;
          },
          async create() {
            exists = true;
            createCalls += 1;
            return {};
          },
          async ensureIndex(index) {
            ensuredIndexes.push(index);
            return {};
          },
        };
      },
    };

    await ensureOrganizationProvidersCollection(fake);
    await ensureOrganizationProvidersCollection(fake);

    expect(createCalls).toBe(1);
    expect(ensuredIndexes).toHaveLength(2);
    for (const index of ensuredIndexes) {
      expect(index).toEqual({ type: 'persistent', fields: ['organizationId', 'providerId'], unique: true });
    }
  });
});
