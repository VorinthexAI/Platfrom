import { describe, expect, test } from 'bun:test';
import { createOrganizationScopeRepository } from './repository';
import { ensureOrganizationScopesCollection } from './indexes';
import { organizationScopeSchema } from './schema';
import {
  DuplicateOrganizationScopeError,
  InvalidScopeNameError,
  OrganizationScopeNotFoundError,
  type OrganizationScopesDatabase,
  type OrganizationScopesSetupDatabase,
} from './types';

/** In-memory stand-in mirroring Arango semantics (1210 unique violation, 1202 missing document). */
function createFakeDb() {
  const docs = new Map<string, Record<string, unknown>>();

  const fake: OrganizationScopesDatabase = {
    async query() {
      const rows = [...docs.values()].sort((a, b) => (String(a.name) < String(b.name) ? -1 : 1));
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection() {
      return {
        async save(doc: Record<string, unknown>) {
          const duplicateName = [...docs.values()].some((existing) => existing.name === doc.name);
          if (docs.has(String(doc._key)) || duplicateName) {
            throw Object.assign(new Error('unique constraint violated'), { errorNum: 1210 });
          }
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async remove(key: string) {
          if (!docs.has(key)) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          docs.delete(key);
          return {};
        },
        async document(key: string) {
          const doc = docs.get(key);
          if (!doc) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          return doc;
        },
      };
    },
  };

  return { fake, docs };
}

describe('organization scope schema', () => {
  test('is minimal — key and name; Arango system fields strip on read', () => {
    const parsed = organizationScopeSchema.parse({ key: 'scope1', _key: 'scope1', _rev: 'x', name: 'support' });
    expect(parsed).toEqual({ key: 'scope1', name: 'support', embedding: [] });
  });
});

describe('organization scope repository', () => {
  test('creates, gets, lists, and removes scopes', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationScopeRepository(fake);

    const support = await repository.createScope('support');
    expect(support.name).toBe('support');
    expect(support.key.length).toBeGreaterThan(0);
    await repository.createScope('finance');

    const listed = await repository.listScopes();
    expect(listed.map((scope) => scope.name)).toEqual(['finance', 'support']);

    expect(await repository.getScopeById(support.key)).toEqual(support);
    expect(await repository.getScopeById('missing')).toBeNull();

    await repository.removeScope(support.key);
    expect(await repository.getScopeById(support.key)).toBeNull();
  });

  test('duplicate names and blank names fail deterministically', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationScopeRepository(fake);
    await repository.createScope('support');
    expect(repository.createScope('support')).rejects.toBeInstanceOf(DuplicateOrganizationScopeError);
    expect(repository.createScope('   ')).rejects.toBeInstanceOf(InvalidScopeNameError);
  });

  test('removing a missing scope fails deterministically', async () => {
    const { fake } = createFakeDb();
    const repository = createOrganizationScopeRepository(fake);
    expect(repository.removeScope('nope')).rejects.toBeInstanceOf(OrganizationScopeNotFoundError);
  });
});

describe('organization scopes index setup', () => {
  test('collection creation and unique name index are idempotent', async () => {
    let exists = false;
    let createCalls = 0;
    const ensuredIndexes: Array<{ type: string; fields: string[]; unique: boolean }> = [];
    const fake: OrganizationScopesSetupDatabase = {
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

    await ensureOrganizationScopesCollection(fake);
    await ensureOrganizationScopesCollection(fake);

    expect(createCalls).toBe(1);
    for (const index of ensuredIndexes) {
      expect(index).toEqual({ type: 'persistent', fields: ['name'], unique: true });
    }
  });
});
