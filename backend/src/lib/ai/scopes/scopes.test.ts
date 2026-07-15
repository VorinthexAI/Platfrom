import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createScopeRepository } from './repository';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
import { SCOPE_MEMBERS_COLLECTION, SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, scopeSchema, scopeScopeSchema } from './schema';
import {
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeOrganizationMismatchError,
  ScopePositionConflictError,
  ScopeRelationNotFoundError,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';

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

  const fake: ScopesDatabase = {
    async query(query: string, bindVars: Record<string, unknown> = {}) {
      const docs = store(String(bindVars['@collection']));
      if (query.includes('REMOVE')) {
        for (const [key, doc] of [...docs.entries()]) {
          if (
            doc.parentScopeKey === bindVars.scopeKey
            || doc.childScopeKey === bindVars.scopeKey
            || doc.scopeKey === bindVars.scopeKey
          ) docs.delete(key);
        }
        return { all: async () => [], next: async () => undefined };
      }

      let rows = [...docs.values()];
      if (query.includes('scope.organizationKey == @organizationKey')) {
        rows = rows.filter((doc) => doc.organizationKey === bindVars.organizationKey);
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }
      if (query.includes('relation.parentScopeKey == @parentScopeKey')) {
        rows = rows.filter((doc) => doc.parentScopeKey === bindVars.parentScopeKey);
      }
      if (query.includes('relation.childScopeKey == @childScopeKey')) {
        rows = rows.filter((doc) => doc.childScopeKey === bindVars.childScopeKey);
      }
      if (query.includes('relation.position == @position')) {
        rows = rows.filter((doc) => doc.position === bindVars.position);
      }
      if (query.includes('SORT relation.position')) {
        rows.sort((a, b) => Number(a.position) - Number(b.position));
      }
      return { all: async () => rows, next: async () => rows[0] };
    },
    collection(name: string) {
      const docs = store(name);
      return {
        async save(doc: Record<string, unknown>) {
          const duplicate = [...docs.values()].some((existing) => {
            if (name === SCOPES_COLLECTION) {
              return existing.organizationKey === doc.organizationKey && existing.slug === doc.slug;
            }
            if (name === SCOPE_SCOPES_COLLECTION) {
              return existing.childScopeKey === doc.childScopeKey
                || (existing.parentScopeKey === doc.parentScopeKey && existing.position === doc.position);
            }
            return false;
          });
          if (docs.has(String(doc._key)) || duplicate) {
            throw Object.assign(new Error('unique constraint violated'), { errorNum: 1210 });
          }
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async remove(key: string) {
          if (!docs.delete(key)) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
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

describe('scope schemas', () => {
  test('scope carries organization ownership and semantic embedding fields', () => {
    const scope = scopeSchema.parse({
      key: newId(),
      organizationKey: newId(),
      slug: 'core',
      name: 'Core',
      description: 'The conversational intelligence scope.',
    });
    expect(scope).toEqual({
      key: scope.key,
      organizationKey: scope.organizationKey,
      slug: 'core',
      name: 'Core',
      description: 'The conversational intelligence scope.',
      embedding: [],
    });
    expect(() => scopeSchema.parse({ ...scope, slug: 'Not Valid' })).toThrow();
  });

  test('scope relation rejects self-parenting', () => {
    const key = newId();
    expect(() => scopeScopeSchema.parse({ key: newId(), parentScopeKey: key, childScopeKey: key, position: 1 })).toThrow();
  });
});

describe('scope repository', () => {
  const organizationKey = newId();
  const input = (overrides: Partial<{ organizationKey: string; slug: string; name: string; description: string }> = {}) => ({
    organizationKey,
    slug: 'core',
    name: 'Core',
    description: 'The conversational intelligence scope.',
    ...overrides,
  });

  test('creates and lists scopes per organization with unique slugs', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    const core = await repository.createScope(input());
    expect(core.embedding).toHaveLength(1536);
    await repository.createScope(input({ slug: 'command', name: 'Command' }));
    await repository.createScope(input({ organizationKey: newId() }));

    expect((await repository.listScopes(organizationKey)).map((scope) => scope.slug)).toEqual(['command', 'core']);
    expect(await repository.getScopeByKey(core.key)).toEqual(core);
    await expect(repository.createScope(input())).rejects.toBeInstanceOf(DuplicateScopeSlugError);
  });

  test('enforces organization boundaries, strict parents, sibling positions, and cycles', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake);
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    const command = await repository.createScope(input({ slug: 'command', name: 'Command' }));
    const nested = await repository.createScope(input({ slug: 'nested', name: 'Nested' }));
    const foreign = await repository.createScope(input({ organizationKey: newId(), slug: 'foreign', name: 'Foreign' }));

    await repository.addScopeRelation(root.key, core.key, 1);
    await repository.addScopeRelation(root.key, command.key, 2);
    await repository.addScopeRelation(core.key, nested.key, 1);
    expect((await repository.listChildRelations(root.key)).map((relation) => relation.childScopeKey)).toEqual([
      core.key,
      command.key,
    ]);

    await expect(repository.addScopeRelation(command.key, core.key, 1)).rejects.toBeInstanceOf(ScopeAlreadyHasParentError);
    await expect(repository.addScopeRelation(root.key, foreign.key, 3)).rejects.toBeInstanceOf(ScopeOrganizationMismatchError);
    await expect(repository.addScopeRelation(root.key, newId(), 3)).rejects.toThrow();
    await expect(repository.addScopeRelation(command.key, root.key, 1)).rejects.toBeInstanceOf(ScopeCycleError);

    const extra = await repository.createScope(input({ slug: 'extra', name: 'Extra' }));
    await expect(repository.addScopeRelation(root.key, extra.key, 2)).rejects.toBeInstanceOf(ScopePositionConflictError);
  });

  test('removes relations and cascades them when a scope is deleted', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake);
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    await repository.addScopeRelation(root.key, core.key, 1);

    await repository.removeScopeRelation(root.key, core.key);
    await expect(repository.removeScopeRelation(root.key, core.key)).rejects.toBeInstanceOf(ScopeRelationNotFoundError);
    await repository.addScopeRelation(root.key, core.key, 1);
    stores.set(SCOPE_MEMBERS_COLLECTION, new Map([[newId(), {
      _key: newId(),
      scopeKey: core.key,
      userOrganizationKey: newId(),
      role: 'owner',
    }]]));
    await repository.removeScope(core.key);
    expect(stores.get(SCOPE_SCOPES_COLLECTION)?.size).toBe(0);
    expect(stores.get(SCOPE_MEMBERS_COLLECTION)?.size).toBe(0);
  });
});

describe('scope index setup', () => {
  test('ensures normalized ownership and strict-tree indexes', async () => {
    const created: string[] = [];
    const ensured: Array<{ collection: string; fields: string[]; unique: boolean }> = [];
    const fake: ScopesSetupDatabase = {
      collection(name) {
        return {
          async exists() { return false; },
          async create() { created.push(name); return {}; },
          async ensureIndex(index) { ensured.push({ collection: name, fields: index.fields, unique: index.unique }); return {}; },
        };
      },
    };

    await ensureScopesCollection(fake);
    await ensureScopeScopesCollection(fake);
    await ensureScopeMembersCollection(fake);

    expect(created).toEqual([SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, SCOPE_MEMBERS_COLLECTION]);
    expect(ensured.filter((index) => index.unique).map((index) => `${index.collection}:${index.fields.join('+')}`)).toEqual([
      `${SCOPES_COLLECTION}:organizationKey+slug`,
      `${SCOPE_SCOPES_COLLECTION}:parentScopeKey+childScopeKey`,
      `${SCOPE_SCOPES_COLLECTION}:childScopeKey`,
      `${SCOPE_SCOPES_COLLECTION}:parentScopeKey+position`,
      `${SCOPE_MEMBERS_COLLECTION}:scopeKey+userOrganizationKey`,
    ]);
  });
});
