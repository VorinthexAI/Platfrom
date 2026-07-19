import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createScopeRepository } from './repository';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
import { SCOPE_MEMBERS_COLLECTION, SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, scopeSchema, scopesEmbedKeys, scopeScopeSchema } from './schema';
import {
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeOrganizationMismatchError,
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
            doc.parentKey === bindVars.scopeKey
            || doc.childKey === bindVars.scopeKey
            || doc.scopeKey === bindVars.scopeKey
          ) docs.delete(key);
        }
        return { all: async () => [], next: async () => undefined };
      }

      let rows = [...docs.values()];
      if (query.includes('scope.organizationKey == @organizationKey')) {
        rows = rows.filter((doc) => doc.organizationKey === bindVars.organizationKey);
        if (query.includes('REGEX_TEST(scope._key')) {
          rows = rows.filter((doc) => scopeSchema.shape.key.safeParse(doc._key).success);
        }
        rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
      }
      if (query.includes('relation.parentKey == @parentKey')) {
        rows = rows.filter((doc) => doc.parentKey === bindVars.parentKey);
      }
      if (query.includes('relation.childKey == @childKey')) {
        rows = rows.filter((doc) => doc.childKey === bindVars.childKey);
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
              return existing.childKey === doc.childKey;
            }
            return false;
          });
          if (docs.has(String(doc._key)) || duplicate) {
            throw Object.assign(new Error('unique constraint violated'), { errorNum: 1210 });
          }
          docs.set(String(doc._key), doc);
          return { new: doc };
        },
        async update(key: string, patch: Record<string, unknown>) {
          const current = docs.get(key);
          if (!current) throw Object.assign(new Error('document not found'), { errorNum: 1202 });
          const updated = { ...current, ...patch };
          docs.set(key, updated);
          return { new: updated };
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
      summary: 'Conversational intelligence.',
      description: 'The conversational intelligence scope.',
      position: 2,
    });
    expect(scope).toEqual({
      key: scope.key,
      organizationKey: scope.organizationKey,
      slug: 'core',
      name: 'Core',
      summary: 'Conversational intelligence.',
      description: 'The conversational intelligence scope.',
      position: 2,
      level: 1,
      deletedAt: null,
      embedding: [],
    });
    expect(scopesEmbedKeys.options).toEqual(['summary']);
    expect(scopeSchema.parse({ ...scope, description: 'x'.repeat(10_000) }).description).toHaveLength(10_000);
    expect(scopeSchema.parse({ ...scope, description: null }).description).toBeNull();
    expect(() => scopeSchema.parse({ ...scope, slug: 'Not Valid' })).toThrow();
    expect(scopeSchema.parse({ ...scope, organizationKey: 'legacy-root-key' }).organizationKey).toBe('legacy-root-key');
  });

  test('scope relation rejects self-parenting', () => {
    const parentKey = newId();
    const childKey = newId();
    expect(scopeScopeSchema.parse({ key: newId(), parentKey, childKey, level: 2 })).toEqual({
      key: expect.any(String),
      parentKey,
      childKey,
      level: 2,
      deletedAt: null,
    });
    expect(() => scopeScopeSchema.parse({ key: newId(), parentKey, childKey: parentKey })).toThrow();
  });
});

describe('scope repository', () => {
  const organizationKey = newId();
  const generateEmbedding = async (text: string) => {
    const vector = Array.from({ length: 1536 }, () => 0);
    vector[0] = [...text].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261);
    return vector;
  };
  const input = (overrides: Partial<{ organizationKey: string; slug: string; name: string; summary: string; description: string; position: number }> = {}) => ({
    organizationKey,
    slug: 'core',
    name: 'Core',
    summary: 'Conversational intelligence.',
    description: 'The conversational intelligence scope.',
    position: 2,
    ...overrides,
  });

  test('creates and lists scopes per organization with unique slugs', async () => {
    const { fake, stores } = createFakeDb();
    const events: Array<{ scopeId: string; slug: string; data: { nodeType: string; nodeKey: string } }> = [];
    const repository = createScopeRepository(fake, generateEmbedding, async (event) => { events.push(event); });
    const core = await repository.createScope(input());
    expect(core.embedding).toHaveLength(1536);
    const updated = await repository.updateScope(core.key, { name: 'Core Intelligence', description: 'Updated scope description.' });
    expect(updated).toMatchObject({ key: core.key, name: 'Core Intelligence', description: 'Updated scope description.' });
    expect(updated.embedding).toEqual(core.embedding);
    const resummarized = await repository.updateScope(core.key, { summary: 'A new semantic summary.' });
    expect(resummarized.embedding).not.toEqual(core.embedding);
    await repository.createScope(input({ slug: 'command', name: 'Command' }));
    await repository.createScope(input({ organizationKey: newId() }));
    stores.get(SCOPES_COLLECTION)?.set('legacy_scope', {
      _key: 'legacy_scope',
      organizationKey,
      slug: 'legacy',
      name: 'Legacy',
      description: 'Retired pre-CUID scope.',
      position: 1,
      embedding: [],
    });

    expect((await repository.listScopes(organizationKey)).map((scope) => scope.slug)).toEqual(['command', 'core']);
    expect(await repository.getScopeByKey(core.key)).toEqual(resummarized);
    expect(events).toEqual(expect.arrayContaining([
      { scopeId: core.key, slug: 'scope.create', data: { nodeType: 'scopes', nodeKey: core.key } },
      { scopeId: core.key, slug: 'scope.update', data: { nodeType: 'scopes', nodeKey: core.key } },
    ]));
    await expect(repository.createScope(input())).rejects.toBeInstanceOf(DuplicateScopeSlugError);
  });

  test('enforces organization boundaries, strict parents, and cycles', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding, async () => {});
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    const command = await repository.createScope(input({ slug: 'command', name: 'Command' }));
    const nested = await repository.createScope(input({ slug: 'nested', name: 'Nested' }));
    const foreign = await repository.createScope(input({ organizationKey: newId(), slug: 'foreign', name: 'Foreign' }));

    await repository.addScopeRelation(root.key, core.key);
    await repository.addScopeRelation(root.key, command.key);
    await repository.addScopeRelation(core.key, nested.key);
    expect((await repository.listChildRelations(root.key)).map((relation) => relation.childKey)).toEqual([
      core.key,
      command.key,
    ]);

    await expect(repository.addScopeRelation(command.key, core.key)).rejects.toBeInstanceOf(ScopeAlreadyHasParentError);
    await expect(repository.addScopeRelation(root.key, foreign.key)).rejects.toBeInstanceOf(ScopeOrganizationMismatchError);
    await expect(repository.addScopeRelation(root.key, newId())).rejects.toThrow();
    await expect(repository.addScopeRelation(command.key, root.key)).rejects.toBeInstanceOf(ScopeCycleError);
  });

  test('removes relations and cascades them when a scope is deleted', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding, async () => {});
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    await repository.addScopeRelation(root.key, core.key);

    await repository.removeScopeRelation(root.key, core.key);
    await expect(repository.removeScopeRelation(root.key, core.key)).rejects.toBeInstanceOf(ScopeRelationNotFoundError);
    await repository.addScopeRelation(root.key, core.key);
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
      `${SCOPE_SCOPES_COLLECTION}:parentKey+childKey`,
      `${SCOPE_SCOPES_COLLECTION}:childKey`,
      `${SCOPE_MEMBERS_COLLECTION}:scopeKey+userOrganizationKey`,
    ]);
    expect(ensured).toContainEqual({
      collection: SCOPES_COLLECTION,
      fields: ['organizationKey', 'position'],
      unique: false,
    });
  });
});
