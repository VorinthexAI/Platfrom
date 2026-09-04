import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { createScopeRepository } from './repository';
import { ensureScopeMembersCollection, ensureScopesCollection, ensureScopeScopesCollection } from './indexes';
import { SCOPE_MEMBERS_COLLECTION, SCOPES_COLLECTION, SCOPE_SCOPES_COLLECTION, scopeSchema, scopesEmbedKeys, scopeScopeSchema } from './schema';
import { createHash } from 'node:crypto';
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
      if (query.includes('LET cleanupScopeRelations')) {
        for (const collection of [SCOPE_SCOPES_COLLECTION, SCOPE_MEMBERS_COLLECTION]) {
          for (const [key, doc] of [...store(collection).entries()]) {
            if (doc.parentKey === bindVars.scopeKey || doc.childKey === bindVars.scopeKey || doc.scopeKey === bindVars.scopeKey) store(collection).delete(key);
          }
        }
        store(SCOPES_COLLECTION).delete(String(bindVars.scopeKey));
        return { all: async () => [], next: async () => true };
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
    });
    expect(() => scopeScopeSchema.parse({ key: newId(), parentKey, childKey: parentKey })).toThrow();
  });
});

describe('scope repository', () => {
  test('hard-deletes managed place media and queues permanent object deletion during scope teardown', async () => {
    const source = await Bun.file(new URL('./repository.ts', import.meta.url)).text();
    const teardown = source.slice(source.indexOf('async removeScope(scopeKey)'), source.indexOf('async addScopeRelation'));
    for (const collection of ['generatedDocumentBindings', 'ticketVotes', 'tickets', 'tripAttachments', 'tripCreationReceipts', 'tripGuides', 'placeReferences', 'placeHeroMedia', 'placeImages', 'collectionImages', 'imageIdentities', 'imageCollecitionHightlights', 'imageCollectionMemories', 'collectionInvites', 'collectionMembers', 'tagAssignments', 'shares', 'userHiddens', 'places', 'images', 'imageCaptions', 'collections', 'documentSummaryAudio', 'documentSummaries', 'documentAudioVersions', 'documentVersions', 'documentShares', 'emailAttachmentBindings', 'emailAttachments', 'emailInboxes', 'emailThreads', 'emailMessages', 'emailDrafts', 'emailTones', 'emailReplyContext', 'emailWritingProfiles', 'books', 'bookContexts', 'bookThemes', 'bookSources', 'bookParts', 'bookChapters', 'chapterContexts', 'bookProgress', 'events', 'folders', 'scopeScopes', 'scopeMembers', 'scopes']) expect(teardown).toContain(collection);
    expect(teardown).toContain('folder.managedPurpose IN ["mail-attachment", "mail-inbox", "mail-inbox-files", "mail-thread"]');
    expect(teardown).not.toContain('FOR inbox IN inboxes');
    expect(teardown.indexOf('LET cleanupMailVersions')).toBeLessThan(teardown.indexOf('LET cleanupMailDocuments'));
    expect(teardown).toContain('FOR storageKey IN UNIQUE(UNION(mailStorageKeys');
    expect(teardown).toContain('UPSERT { storageKey }');
    expect(teardown).toContain('storageDeletionJobs');
    expect(teardown).toContain('collection.purpose IN ["place-media", "email-media", "generated-media"] && collection.mutationPolicy == "system-only"');
    expect(teardown).toContain('LET canonicalStorageKeys = UNIQUE(UNION(');
    expect(teardown).toContain('LET ordinaryStorageKeys = UNIQUE(UNION(');
    expect(teardown).not.toContain('decodeEmailTone');
    expect(teardown).not.toContain('JSON_PARSE(document.content)');
    expect(teardown).not.toContain('@toneFolderKey');
    expect(teardown).toContain('document.sourceStorageKeys');
    expect(teardown).toContain('document.speechStorageKeys');
    expect(teardown).toContain('LET mailDocumentKeys =');
    expect(teardown).toContain('summary.documentKey IN mailDocumentKeys');
    expect(teardown).toContain('audio.summaryKey IN mailSummaryKeys');
    expect(teardown.indexOf('LET mailDeletionJobs')).toBeLessThan(teardown.indexOf('LET cleanupMailDocuments'));
    expect(teardown).toContain('FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN imageKeys');
    expect(teardown).toContain('FOR item IN tickets FILTER item.scopeKey == @scopeKey REMOVE item IN tickets');
    expect(teardown).toContain('FOR item IN ticketVotes FILTER item.scopeKey == @scopeKey REMOVE item IN ticketVotes');
    expect(teardown.indexOf('REMOVE item IN ticketVotes')).toBeLessThan(teardown.indexOf('REMOVE item IN tickets'));
    expect(teardown).toContain('FOR item IN events FILTER item.scopeKey == @scopeKey REMOVE item IN events');
    expect(source).toContain('FILTER user.currentScopeKey == @scopeKey');
    expect(teardown.indexOf('LET cleanupFolderCovers')).toBeLessThan(teardown.indexOf('LET cleanupImages'));
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
  test('scope teardown deletes an unbound processing attachment image from its receipt ownership', async () => {
    const scopeKey = newId();
    const bindingKey = newId();
    const targetKey = `c${createHash('sha256').update(['email-attachment-target', bindingKey].join('\0')).digest('hex').slice(0, 24)}`;
    const state = {
      images: new Map([[targetKey, { key: targetKey, scopeKey, mutationPolicy: 'system-only', storageKey: 'attachments/unbound.jpg', imageCaptionKey: newId() }]]),
      bindings: new Map([[bindingKey, { key: bindingKey, scopeKey, targetType: 'image', targetKey, status: 'processing' }]]),
      memories: new Map([[newId(), { scopeKey, imageKey: targetKey }]]),
      highlights: new Map([[newId(), { scopeKey, collectionKey: newId(), imageKeys: [targetKey, newId()] }]]),
      folders: new Map([[newId(), { scopeKey, coverImageKey: targetKey as string | undefined }]]),
      deletionJobs: new Set<string>(),
    };
    let teardownQuery = '';
    const database: ScopesDatabase = {
      collection: () => ({ document: async () => ({ _key: scopeKey, organizationKey: newId(), slug: 'scope', name: 'Scope', summary: 'Summary', description: null, position: 1, level: 1, embedding: [] }), save: async () => ({}), update: async () => ({}), remove: async () => ({}) }),
      query: async (query) => {
        if (query.trim().startsWith('FOR document')) return { all: async () => [], next: async () => undefined };
        if (query.includes('user.currentScopeKey')) return { all: async () => [], next: async () => 0 };
        teardownQuery = query;
        const binding = state.bindings.get(bindingKey);
        const image = binding?.targetType === 'image' ? state.images.get(binding.targetKey) : undefined;
        if (image && query.includes('LET boundAttachmentImages') && query.includes('UNION(boundAttachmentImages, relatedManagedImages)')) {
          state.deletionJobs.add(image.storageKey);
          state.images.delete(image.key);
          state.bindings.delete(bindingKey);
          for (const [key, memory] of state.memories) if (memory.imageKey === image.key) state.memories.delete(key);
          for (const highlight of state.highlights.values()) highlight.imageKeys = highlight.imageKeys.filter((key) => key !== image.key);
          for (const folder of state.folders.values()) if (folder.coverImageKey === image.key) folder.coverImageKey = undefined;
        }
        return { all: async () => [], next: async () => true };
      },
    };
    await createScopeRepository(database).removeScope(scopeKey);
    expect(teardownQuery).toContain('binding.targetKey == CONCAT("c", LEFT(SHA256');
    expect(teardownQuery).not.toContain('\0');
    expect(teardownQuery).toContain('CONCAT_SEPARATOR("\\u0000", "email-attachment-target"');
    expect(state.images.has(targetKey)).toBe(false);
    expect(state.bindings.has(bindingKey)).toBe(false);
    expect(state.memories.size).toBe(0);
    expect([...state.highlights.values()][0]?.imageKeys).not.toContain(targetKey);
    expect([...state.folders.values()][0]?.coverImageKey).toBeUndefined();
    expect(state.deletionJobs).toContain('attachments/unbound.jpg');
    expect(teardownQuery.indexOf('LET cleanupFolderCovers')).toBeLessThan(teardownQuery.indexOf('LET cleanupImages'));
  });
  const organizationKey = newId();
  const generateEmbedding = async (text: string) => {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
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
    const repository = createScopeRepository(fake, generateEmbedding);
    const core = await repository.createScope(input());
    expect(core.embedding).toHaveLength(EMBEDDING_DIMENSIONS);
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
    await expect(repository.createScope(input())).rejects.toBeInstanceOf(DuplicateScopeSlugError);
  });

  test('seeds exact default tones without provider work after scope persistence', async () => {
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
    expect(seeded.map(({ name }) => name)).toEqual(['Casual', 'Formal', 'Direct']);
    expect(seeded.map(({ embedding }) => embedding)).toEqual(Array.from({ length: 3 }, () => Array(EMBEDDING_DIMENSIONS).fill(0)));
    expect(seeded.map(({ instruction }) => instruction)).toEqual([
      'Use conversational language, natural contractions, and an approachable tone.',
      'Use professional language, complete sentences, and a clear conventional structure.',
      'Lead with the answer or action and avoid hedging.',
    ]);
  });

  test('enforces organization boundaries, strict parents, and cycles', async () => {
    const { fake } = createFakeDb();
    const repository = createScopeRepository(fake, generateEmbedding);
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
