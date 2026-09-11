import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { withDatabaseTransaction } from '@/lib/db/client';
import { createScopeRepository, SCOPE_KEYED_REMOVAL_COLLECTIONS, SCOPE_REMOVAL_WRITE_COLLECTIONS } from './repository';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
import { SCOPE_MEMBERS_COLLECTION, SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, scopeSchema, scopesEmbedKeys, scopeScopeSchema } from './schema';
import {
  DuplicateScopeSlugError,
  ProductScopeMutationError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeTeamMismatchError,
  ScopeRelationNotFoundError,
  type ScopesDatabase,
  type ScopesSetupDatabase,
} from './types';

test('designated root product scopes cannot be deleted or reparented through the generic repository', async () => {
  const productKey = 'cmrnlzf640000qc7k4p5zem5w';
  const parentKey = 'cmrnlzf640004qc7kdvj99uva';
  const documents: Record<string, Record<string, unknown>> = {
    [productKey]: { _key: productKey, teamKey: 'root', slug: 'vorinthex-ai', name: 'Vorinthex AI', summary: 'Summary', description: 'Description', position: 1, level: 1, embedding: [] },
    [parentKey]: { _key: parentKey, teamKey: 'root', slug: 'command', name: 'Command', summary: 'Summary', description: 'Description', position: 2, level: 1, embedding: [] },
  };
  const database = {
    collection: () => ({ document: async (key: string) => documents[key] }),
    query: async (query: string) => query.includes('scope.slug IN @productSlugs')
      ? { all: async () => [], next: async () => 1 }
      : { all: async () => [], next: async () => undefined },
  } as never;
  const repository = createScopeRepository(database, async () => []);
  await expect(repository.removeScope(productKey)).rejects.toBeInstanceOf(ProductScopeMutationError);
  await expect(repository.updateScope(productKey, { slug: 'renamed-product' })).rejects.toBeInstanceOf(ProductScopeMutationError);
  await expect(repository.addScopeRelation(parentKey, productKey)).rejects.toBeInstanceOf(ProductScopeMutationError);
  await expect(repository.removeScopeRelation(parentKey, productKey)).rejects.toBeInstanceOf(ProductScopeMutationError);
});

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
      if (query.includes('LET image = DOCUMENT(images, @coverImageKey)')) {
        const image = store('images').get(String(bindVars.coverImageKey));
        return { all: async () => [], next: async () => image && image.scopeKey === bindVars.scopeKey ? image.storageKey : undefined };
      }
      if (query.includes('RETURN DOCUMENT(scopes, @scopeKey)')) return { all: async () => [], next: async () => store(SCOPES_COLLECTION).has(String(bindVars.scopeKey)) ? 1 : 0 };
      if (query.includes('user.currentScopeKey')) return { all: async () => [], next: async () => 0 };
      if (query.includes('LET storageKeys =')) return { all: async () => [], next: async () => [] };
      if (query.includes('FOR relation IN scopeScopes')) {
        for (const [key, doc] of [...store(SCOPE_SCOPES_COLLECTION).entries()]) {
          if (doc.parentKey === bindVars.scopeKey || doc.childKey === bindVars.scopeKey) store(SCOPE_SCOPES_COLLECTION).delete(key);
        }
        return { all: async () => [], next: async () => undefined };
      }
      if (query.includes('FOR scope IN scopes') && query.includes('REMOVE scope IN scopes')) {
        const deleted = store(SCOPES_COLLECTION).delete(String(bindVars.scopeKey));
        return { all: async () => [], next: async () => deleted ? bindVars.scopeKey : undefined };
      }
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
      if (query.includes('scope.teamKey == @teamKey')) {
        rows = rows.filter((doc) => doc.teamKey === bindVars.teamKey);
        if (query.includes('REGEX_TEST(scope._key')) {
          rows = rows.filter((doc) => scopeSchema.shape.key.safeParse(doc._key).success);
        }
        rows.sort((a, b) => Number(a.position) - Number(b.position) || String(a._key).localeCompare(String(b._key)));
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
              return existing.teamKey === doc.teamKey && existing.slug === doc.slug;
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
  test('scope carries team ownership and semantic embedding fields', () => {
    const scope = scopeSchema.parse({
      key: newId(),
      teamKey: newId(),
      slug: 'core',
      name: 'Core',
      summary: 'Conversational intelligence.',
      description: 'The conversational intelligence scope.',
      position: 2,
    });
    expect(scope).toEqual({
      key: scope.key,
      teamKey: scope.teamKey,
      slug: 'core',
      name: 'Core',
      summary: 'Conversational intelligence.',
      description: 'The conversational intelligence scope.',
      position: 2,
      level: 1,
      embedding: [],
    });
    expect(scopesEmbedKeys.options).toEqual(['summary']);
    expect(scopeSchema.parse({ ...scope, description: 'x'.repeat(10_000) }).description).toHaveLength(10_000);
    expect(scopeSchema.parse({ ...scope, description: null }).description).toBeNull();
    expect(() => scopeSchema.parse({ ...scope, slug: 'Not Valid' })).toThrow();
    expect(scopeSchema.parse({ ...scope, teamKey: 'legacy-root-key' }).teamKey).toBe('legacy-root-key');
  });

  test('scope relation rejects self-parenting', () => {
    const parentKey = newId();
    const childKey = newId();
    expect(scopeScopeSchema.parse({ key: newId(), parentKey, childKey, level: 2 })).toEqual({
      key: expect.any(String),
      parentKey,
      childKey,
      level: 2,
    });
    expect(() => scopeScopeSchema.parse({ key: newId(), parentKey, childKey: parentKey })).toThrow();
  });
});

describe('scope repository', () => {
  test('derives one generic deletion pass for every ordinary scope-owned collection', () => {
    expect(new Set(SCOPE_REMOVAL_WRITE_COLLECTIONS).size).toBe(SCOPE_REMOVAL_WRITE_COLLECTIONS.length);
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('generatedDocumentBindings');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).toContain('collectionImages');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('users');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('scopes');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('scopeScopes');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('userTeams');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('storageDeletionJobs');
    expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain('bookRefundIntents');
    for (const collection of ['appNotifications', 'appNotificationRecipients', 'pushDeliveries']) {
      expect(SCOPE_REMOVAL_WRITE_COLLECTIONS).toContain(collection as never);
      expect(SCOPE_KEYED_REMOVAL_COLLECTIONS).not.toContain(collection);
    }
  });

  test('uses separate statements for storage discovery and every collection modification across scopes', async () => {
    const scopeKeys = [newId(), newId()];
    const queries: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const database = {
      async query(query: string, bindVars: Record<string, unknown> = {}) {
        queries.push({ query, bindVars });
        if (query.includes('scope.slug IN @productSlugs')) return { next: async () => 0 };
        if (query.includes('RETURN DOCUMENT(scopes, @scopeKey)')) return { next: async () => 1 };
        if (query.includes('user.currentScopeKey')) return { next: async () => 0 };
        if (query.includes('LET storageKeys =')) return { next: async () => [`objects/${bindVars.scopeKey}`] };
        if (query.includes('REMOVE scope IN scopes')) return { next: async () => bindVars.scopeKey, all: async () => [] };
        return { next: async () => undefined, all: async () => query.includes('FOR notification IN appNotifications') && query.includes('RETURN notification._key') ? ['notification-1'] : [] };
      },
    } as never;
    const repository = createScopeRepository(database);

    for (const scopeKey of scopeKeys) await repository.removeScope(scopeKey);

    for (const scopeKey of scopeKeys) {
      const scopeQueries = queries.filter(({ bindVars }) => bindVars.scopeKey === scopeKey);
      const genericDeletes = scopeQueries.filter(({ query }) => query.includes('REMOVE item IN @@collection'));
      expect(genericDeletes.map(({ bindVars }) => bindVars['@collection'])).toEqual(SCOPE_KEYED_REMOVAL_COLLECTIONS);
      expect(genericDeletes.filter(({ bindVars }) => bindVars['@collection'] === 'generatedDocumentBindings')).toHaveLength(1);
      expect(genericDeletes.filter(({ bindVars }) => bindVars['@collection'] === 'collectionImages')).toHaveLength(1);
      const notificationQueries = scopeQueries.filter(({ query }) => query.includes('appNotifications') || query.includes('appNotificationRecipients') || query.includes('pushDeliveries'));
      expect(notificationQueries.map(({ query }) => query)).toEqual([
        'FOR notification IN appNotifications FILTER notification.scopeKey == @scopeKey RETURN notification._key',
      ]);
    }
    const storageDeletionQueries = queries.filter(({ query }) => query.includes('IN storageDeletionJobs'));
    expect(storageDeletionQueries).toHaveLength(scopeKeys.length);
    expect(storageDeletionQueries.every(({ bindVars }) => Object.keys(bindVars).sort().join(',') === 'now,storageKeys')).toBe(true);
    const notificationDeletionQueries = queries.filter(({ query }) => query.includes('@notificationKeys') && query.includes('REMOVE'));
    expect(notificationDeletionQueries).toHaveLength(scopeKeys.length * 3);
    expect(notificationDeletionQueries.every(({ bindVars }) => Object.keys(bindVars).join(',') === 'notificationKeys')).toBe(true);
    expect(queries.every(({ query }) => (query.match(/\bREMOVE\b/g) ?? []).length <= 1)).toBe(true);
    expect(queries.every(({ query }) => !query.includes('REMOVE') || (!query.includes('UPDATE') && !query.includes('UPSERT')))).toBe(true);
  });
  test('does not eagerly create Compass or Signal export folders with a scope', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const create = source.slice(source.indexOf('async createScope(input)'), source.indexOf('async updateScope'));
    expect(create).not.toContain('ensureGeneratedDocumentFolders');
    expect(create).not.toContain('ensureMailFolders');
    const seed = await Bun.file(new URL('../../db/seed.ts', import.meta.url)).text();
    expect(seed).not.toContain('ensureGeneratedDocumentFolders');
    expect(seed).not.toContain('ensureMailFolders');
  });
  const teamKey = newId();
  const generateEmbedding = async (text: string) => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    vector[0] = [...text].reduce((hash, character) => Math.imul(hash ^ character.charCodeAt(0), 16_777_619), 2_166_136_261);
    return vector;
  };
  const input = (overrides: Partial<{ teamKey: string; slug: string; name: string; summary: string; description: string; position: number }> = {}) => ({
    teamKey,
    slug: 'core',
    name: 'Core',
    summary: 'Conversational intelligence.',
    description: 'The conversational intelligence scope.',
    position: 2,
    ...overrides,
  });

  test('creates and lists scopes per team with unique slugs', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding);
    const core = await repository.createScope(input());
    expect(core.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
    const updated = await repository.updateScope(core.key, { name: 'Core Intelligence', description: 'Updated scope description.' });
    expect(updated).toMatchObject({ key: core.key, name: 'Core Intelligence', description: 'Updated scope description.' });
    expect(updated.embedding).toEqual(core.embedding);
    const resummarized = await repository.updateScope(core.key, { summary: 'A new semantic summary.' });
    expect(resummarized.embedding).not.toEqual(core.embedding);
    await repository.createScope(input({ slug: 'command', name: 'Command', position: 1 }));
    await repository.createScope(input({ teamKey: newId() }));
    stores.get(SCOPES_COLLECTION)?.set('legacy_scope', {
      _key: 'legacy_scope',
      teamKey,
      slug: 'legacy',
      name: 'Legacy',
      description: 'Retired pre-CUID scope.',
      position: 1,
      embedding: [],
    });

    expect((await repository.listScopes(teamKey)).map((scope) => scope.slug)).toEqual(['command', 'core']);
    expect(await repository.getScopeByKey(core.key)).toEqual(resummarized);
    await expect(repository.createScope(input())).rejects.toBeInstanceOf(DuplicateScopeSlugError);
  });

  test('resolves cover storage only for an image owned by the target scope', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding);
    const target = await repository.createScope(input());
    const imageKey = newId();
    stores.set('images', new Map([[imageKey, { _key: imageKey, scopeKey: target.key, storageKey: 'private/cover.jpg' }]]));
    await expect(repository.coverStorageKey(target.key, imageKey)).resolves.toBe('private/cover.jpg');
    await expect(repository.coverStorageKey(newId(), imageKey)).resolves.toBeUndefined();
    await expect(repository.coverStorageKey(target.key, null)).resolves.toBeUndefined();
  });

  test('does not seed private email tones when creating a shared scope', async () => {
    const { fake, stores } = createFakeDb();
    const query = fake.query.bind(fake);
    const seeded: Record<string, any>[] = [];
    fake.query = async (text, bindVars = {}) => {
      if (text.includes('IN emailTones') && bindVars.value) seeded.push(bindVars.value as Record<string, any>);
      return query(text, bindVars);
    };
    let embeddingCalls = 0;
    const repository = createScopeRepository(fake, async (text) => {
      embeddingCalls += 1;
      if (embeddingCalls > 1) throw new Error('injected embedding provider failure');
      return generateEmbedding(text);
    });

    const created = await repository.createScope(input({ slug: 'durable', name: 'Durable' }));

    expect(stores.get(SCOPES_COLLECTION)?.has(created.key)).toBe(true);
    expect(embeddingCalls).toBe(1);
    expect(seeded).toEqual([]);
  });

  test('enforces team boundaries, strict parents, and cycles', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding);
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    const command = await repository.createScope(input({ slug: 'command', name: 'Command' }));
    const nested = await repository.createScope(input({ slug: 'nested', name: 'Nested' }));
    const foreign = await repository.createScope(input({ teamKey: newId(), slug: 'foreign', name: 'Foreign' }));

    await repository.addScopeRelation(root.key, core.key);
    await repository.addScopeRelation(root.key, command.key);
    await repository.addScopeRelation(core.key, nested.key);
    expect((await repository.listChildRelations(root.key)).map((relation) => relation.childKey)).toEqual([
      core.key,
      command.key,
    ]);

    await expect(repository.addScopeRelation(command.key, core.key)).rejects.toBeInstanceOf(ScopeAlreadyHasParentError);
    await expect(repository.addScopeRelation(root.key, foreign.key)).rejects.toBeInstanceOf(ScopeTeamMismatchError);
    await expect(repository.addScopeRelation(root.key, newId())).rejects.toThrow();
    await expect(repository.addScopeRelation(command.key, root.key)).rejects.toBeInstanceOf(ScopeCycleError);
  });

  test('removes relations and cascades them when a scope is deleted', async () => {
    const { fake, stores } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding);
    const root = await repository.createScope(input({ slug: 'root', name: 'Root' }));
    const core = await repository.createScope(input());
    await repository.addScopeRelation(root.key, core.key);

    await repository.removeScopeRelation(root.key, core.key);
    await expect(repository.removeScopeRelation(root.key, core.key)).rejects.toBeInstanceOf(ScopeRelationNotFoundError);
    await repository.addScopeRelation(root.key, core.key);
    stores.set(SCOPE_MEMBERS_COLLECTION, new Map([[newId(), {
      _key: newId(),
      scopeKey: core.key,
      userTeamKey: newId(),
      role: 'owner',
    }]]));
    stores.set('generatedDocumentBindings', new Map([[newId(), { _key: newId(), scopeKey: core.key }]]));
    stores.set('collectionImages', new Map([[newId(), { _key: newId(), scopeKey: core.key }]]));
    await repository.removeScope(core.key);
    expect(stores.get(SCOPE_SCOPES_COLLECTION)?.size).toBe(0);
    expect(stores.get(SCOPE_MEMBERS_COLLECTION)?.size).toBe(0);
    expect(stores.get('generatedDocumentBindings')?.size).toBe(0);
    expect(stores.get('collectionImages')?.size).toBe(0);
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
      `${SCOPES_COLLECTION}:teamKey+slug`,
      `${SCOPE_SCOPES_COLLECTION}:parentKey+childKey`,
      `${SCOPE_SCOPES_COLLECTION}:childKey`,
      `${SCOPE_MEMBERS_COLLECTION}:scopeKey+userTeamKey`,
    ]);
    expect(ensured).toContainEqual({
      collection: SCOPES_COLLECTION,
      fields: ['teamKey', 'position'],
      unique: false,
    });
  });
});

const liveArangoSuite = process.env.ARANGO_URL && process.env.ARANGO_USERNAME && process.env.ARANGO_ROOT_PASSWORD !== undefined ? describe : describe.skip;

liveArangoSuite('scope removal live Arango', () => {
  test('removes multiple scopes in one stream transaction without repeated collection access', async () => {
    const { Database } = await import('arangojs');
    const temporaryName = `scope_removal_${crypto.randomUUID().replaceAll('-', '')}`;
    const root = new Database({
      url: process.env.ARANGO_URL!,
      auth: { username: process.env.ARANGO_USERNAME!, password: process.env.ARANGO_ROOT_PASSWORD! },
    });
    await root.createDatabase(temporaryName);
    const temporary = root.database(temporaryName);
    const scopeKeys = [newId(), newId()];
    try {
      for (const name of new Set([...SCOPE_REMOVAL_WRITE_COLLECTIONS, 'teams'])) await temporary.createCollection(name);
      await temporary.collection('scopes').import(scopeKeys.map((key, index) => ({ _key: key, teamKey: 'team-live', slug: `scope-${index}`, name: `Scope ${index}`, summary: 'Live teardown test', description: null, position: index, level: 1, embedding: [] })));
      for (const scopeKey of scopeKeys) {
        await temporary.collection('generatedDocumentBindings').save({ _key: newId(), scopeKey });
        await temporary.collection('collectionImages').save({ _key: newId(), scopeKey });
        const notificationKey = newId();
        await temporary.collection('appNotifications').save({ _key: notificationKey, scopeKey });
        await temporary.collection('appNotificationRecipients').save({ _key: newId(), notificationKey });
        await temporary.collection('pushDeliveries').save({ _key: newId(), notificationKey });
      }

      await withDatabaseTransaction(temporary, { read: ['teams'], write: [...SCOPE_REMOVAL_WRITE_COLLECTIONS] }, async (transaction) => {
        const repository = createScopeRepository(transaction as never, async () => []);
        for (const scopeKey of scopeKeys) await repository.removeScope(scopeKey);
      });

      expect(await (await temporary.query<number>('RETURN LENGTH(scopes)')).next()).toBe(0);
      expect(await (await temporary.query<number>('RETURN LENGTH(generatedDocumentBindings)')).next()).toBe(0);
      expect(await (await temporary.query<number>('RETURN LENGTH(collectionImages)')).next()).toBe(0);
      expect(await (await temporary.query<number>('RETURN LENGTH(appNotifications)')).next()).toBe(0);
      expect(await (await temporary.query<number>('RETURN LENGTH(appNotificationRecipients)')).next()).toBe(0);
      expect(await (await temporary.query<number>('RETURN LENGTH(pushDeliveries)')).next()).toBe(0);
    } finally {
      temporary.close();
      await root.dropDatabase(temporaryName);
      root.close();
    }
  }, 30_000);
});
