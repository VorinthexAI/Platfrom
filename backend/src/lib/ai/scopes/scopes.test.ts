import { describe, expect, test } from 'bun:test';
import { createScopeRepository } from './repository';
import { ensureScopeChildrenCollection, ensureScopesCollection, ensureScopeUsersCollection } from './indexes';
import { SCOPE_CHILDREN_COLLECTION, SCOPE_USERS_COLLECTION, SCOPES_COLLECTION, scopeSchema } from './schema';
import {
  DuplicateScopeChildError,
  DuplicateScopeError,
  DuplicateScopeUserError,
  InvalidScopeDescriptionError,
  InvalidScopeNameError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopeUserNotFoundError,
  SelfScopeChildError,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';

/** In-memory stand-in mirroring Arango semantics (1210 unique violation, 1202 missing document). */
function createFakeDb() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const store = (name: string) => {
    let docs = stores.get(name);
    if (!docs) {
      docs = new Map();
      stores.set(name, docs);
    }
    return docs;
  };

  const uniquePairs: Record<string, [string, string]> = {
    [SCOPES_COLLECTION]: ['organizationId', 'name'],
    [SCOPE_CHILDREN_COLLECTION]: ['parentScopeId', 'childScopeId'],
    [SCOPE_USERS_COLLECTION]: ['scopeId', 'userId'],
  };

  const fake: ScopesDatabase = {
    async query(query: string, bindVars: Record<string, unknown> = {}) {
      const collectionName = String(bindVars['@collection']);
      const docs = store(collectionName);
      if (query.includes('REMOVE')) {
        for (const [key, doc] of [...docs.entries()]) {
          const matches = query.includes('parentScopeId == @scopeId')
            ? doc.parentScopeId === bindVars.scopeId || doc.childScopeId === bindVars.scopeId
            : doc.scopeId === bindVars.scopeId;
          if (matches) docs.delete(key);
        }
        return { all: async () => [], next: async () => undefined };
      }
      let rows = [...docs.values()];
      if (query.includes('doc.organizationId == @organizationId')) {
        rows = rows.filter((doc) => doc.organizationId === bindVars.organizationId);
      }
      if (query.includes('doc.parentScopeId == @parentScopeId')) {
        rows = rows
          .filter((doc) => doc.parentScopeId === bindVars.parentScopeId)
          .sort((a, b) => String(a.childScopeId).localeCompare(String(b.childScopeId)));
        const ids = rows.map((doc) => doc.childScopeId);
        return { all: async () => ids, next: async () => ids[0] };
      }
      if (query.includes('doc.scopeId == @scopeId')) {
        rows = rows
          .filter((doc) => doc.scopeId === bindVars.scopeId)
          .sort((a, b) => String(a.userId).localeCompare(String(b.userId)));
        const ids = rows.map((doc) => doc.userId);
        return { all: async () => ids, next: async () => ids[0] };
      }
      rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection(name: string) {
      const docs = store(name);
      const unique = uniquePairs[name];
      return {
        async save(doc: Record<string, unknown>) {
          const duplicatePair = unique
            ? [...docs.values()].some(
                (existing) => existing[unique[0]] === doc[unique[0]] && existing[unique[1]] === doc[unique[1]],
              )
            : false;
          if (docs.has(String(doc._key)) || duplicatePair) {
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

  return { fake, stores };
}

describe('scope schema', () => {
  test('carries organization, name, description, timestamps, embedding; system fields strip on read', () => {
    const parsed = scopeSchema.parse({
      key: 'scope1',
      _key: 'scope1',
      _rev: 'x',
      organizationId: 'org1',
      name: 'support',
      description: 'Handles customer support conversations.',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    });
    expect(parsed).toEqual({
      key: 'scope1',
      organizationId: 'org1',
      name: 'support',
      description: 'Handles customer support conversations.',
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
      embedding: [],
    });
  });
});

describe('scope repository', () => {
  const input = (overrides: Partial<{ organizationId: string; name: string; description: string }> = {}) => ({
    organizationId: 'org1',
    name: 'support',
    description: 'Handles customer support conversations.',
    ...overrides,
  });

  test('creates, gets, lists per organization, and removes scopes', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);

    const scope = await repository.createScope(input());
    expect(scope.organizationId).toBe('org1');
    expect(scope.description).toBe('Handles customer support conversations.');
    expect(scope.createdAt).toBe(scope.updatedAt);

    await repository.createScope(input({ name: 'billing', description: 'Billing questions.' }));
    await repository.createScope(input({ organizationId: 'org2', name: 'support', description: 'Other org.' }));

    expect((await repository.listScopes('org1')).map((s) => s.name)).toEqual(['billing', 'support']);
    expect((await repository.listScopes('org2')).map((s) => s.name)).toEqual(['support']);
    expect(await repository.getScopeById(scope.key)).toEqual(scope);

    await repository.removeScope(scope.key);
    expect(await repository.getScopeById(scope.key)).toBeNull();
    await expect(repository.removeScope(scope.key)).rejects.toBeInstanceOf(ScopeNotFoundError);
  });

  test('scope names are unique per organization, not globally', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    await repository.createScope(input());
    await expect(repository.createScope(input({ description: 'again' }))).rejects.toBeInstanceOf(DuplicateScopeError);
    // Same name in another organization is fine.
    await repository.createScope(input({ organizationId: 'org2' }));
  });

  test('rejects empty name and description', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    await expect(repository.createScope(input({ name: '  ' }))).rejects.toBeInstanceOf(InvalidScopeNameError);
    await expect(repository.createScope(input({ description: '' }))).rejects.toBeInstanceOf(
      InvalidScopeDescriptionError,
    );
  });

  test('links children within one organization and refuses cross-organization or self links', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    const parent = await repository.createScope(input({ name: 'root', description: 'Root scope.' }));
    const child = await repository.createScope(input({ name: 'support', description: 'Support scope.' }));
    const foreign = await repository.createScope(
      input({ organizationId: 'org2', name: 'other', description: 'Foreign scope.' }),
    );

    await repository.addChild(parent.key, child.key);
    expect(await repository.listChildScopeIds(parent.key)).toEqual([child.key]);

    await expect(repository.addChild(parent.key, child.key)).rejects.toBeInstanceOf(DuplicateScopeChildError);
    await expect(repository.addChild(parent.key, parent.key)).rejects.toBeInstanceOf(SelfScopeChildError);
    await expect(repository.addChild(parent.key, foreign.key)).rejects.toBeInstanceOf(ScopeOrganizationMismatchError);
    await expect(repository.addChild(parent.key, 'missing')).rejects.toBeInstanceOf(ScopeNotFoundError);

    await repository.removeChild(parent.key, child.key);
    expect(await repository.listChildScopeIds(parent.key)).toEqual([]);
  });

  test('adds and removes scope users, one membership per (scope, user)', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    const scope = await repository.createScope(input());

    await repository.addUser(scope.key, 'user1');
    await repository.addUser(scope.key, 'user2');
    expect(await repository.listUserIds(scope.key)).toEqual(['user1', 'user2']);

    await expect(repository.addUser(scope.key, 'user1')).rejects.toBeInstanceOf(DuplicateScopeUserError);
    await expect(repository.addUser('missing', 'user1')).rejects.toBeInstanceOf(ScopeNotFoundError);

    await repository.removeUser(scope.key, 'user1');
    expect(await repository.listUserIds(scope.key)).toEqual(['user2']);
    await expect(repository.removeUser(scope.key, 'user1')).rejects.toBeInstanceOf(ScopeUserNotFoundError);
  });

  test('removing a scope removes its child links and memberships', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake);
    const parent = await repository.createScope(input({ name: 'root', description: 'Root scope.' }));
    const child = await repository.createScope(input({ name: 'support', description: 'Support scope.' }));
    await repository.addChild(parent.key, child.key);
    await repository.addUser(child.key, 'user1');

    await repository.removeScope(child.key);

    expect(stores.get(SCOPE_CHILDREN_COLLECTION)?.size ?? 0).toBe(0);
    expect(stores.get(SCOPE_USERS_COLLECTION)?.size ?? 0).toBe(0);
    expect(await repository.listChildScopeIds(parent.key)).toEqual([]);
  });
});

describe('scope index setup', () => {
  test('ensures the three collections with the right unique pairs', async () => {
    const created: string[] = [];
    const ensured: Array<{ collection: string; fields: string[]; unique: boolean }> = [];
    const fake: ScopesSetupDatabase = {
      collection(name: string) {
        return {
          async exists() {
            return false;
          },
          async create() {
            created.push(name);
            return {};
          },
          async ensureIndex(index: { type: 'persistent'; fields: string[]; unique: boolean }) {
            ensured.push({ collection: name, fields: index.fields, unique: index.unique });
            return {};
          },
        };
      },
    };

    await ensureScopesCollection(fake);
    await ensureScopeChildrenCollection(fake);
    await ensureScopeUsersCollection(fake);

    expect(created).toEqual([SCOPES_COLLECTION, SCOPE_CHILDREN_COLLECTION, SCOPE_USERS_COLLECTION]);
    const uniques = ensured.filter((index) => index.unique).map((index) => `${index.collection}:${index.fields.join('+')}`);
    expect(uniques).toEqual([
      `${SCOPES_COLLECTION}:organizationId+name`,
      `${SCOPE_CHILDREN_COLLECTION}:parentScopeId+childScopeId`,
      `${SCOPE_USERS_COLLECTION}:scopeId+userId`,
    ]);
  });
});
