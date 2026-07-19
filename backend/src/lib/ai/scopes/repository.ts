import { db } from '@/lib/db/client';
import { buildEmbeddingText, isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { embed, embeddingMetadata } from '@/lib/embed';
import { recordOrganizationEvent, type OrganizationEventRecorder } from '@/lib/live/organization-events';
import {
  SCOPE_SCOPES_COLLECTION,
  SCOPE_MEMBERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeSchema,
  scopesEmbedKeys,
  scopeScopeSchema,
  type Scope,
  type ScopeScope,
} from './schema';
import {
  DuplicateScopeRelationError,
  DuplicateScopeSlugError,
  ScopeAlreadyHasParentError,
  ScopeCycleError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopeRelationNotFoundError,
  type ScopeRepository,
  type ScopesDatabase,
} from './types';

export function createScopeRepository(
  database: ScopesDatabase = db,
  generateEmbedding: (text: string) => Promise<number[]> = async (text) => embed({ text }),
  recordEvent: OrganizationEventRecorder = recordOrganizationEvent,
): ScopeRepository {
  async function requireScope(scopeKey: string): Promise<Scope> {
    try {
      const doc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
      return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
    } catch (error) {
      if (isArangoNotFoundError(error)) throw new ScopeNotFoundError(scopeKey);
      throw error;
    }
  }

  async function listRelations(parentKey: string): Promise<ScopeScope[]> {
    const cursor = await database.query(
      `
        FOR relation IN @@collection
          FILTER relation.parentKey == @parentKey
          SORT relation._key ASC
          RETURN relation
      `,
      { '@collection': SCOPE_SCOPES_COLLECTION, parentKey },
    );
    const docs = await cursor.all();
    return (docs as Record<string, unknown>[]).map((doc) => scopeScopeSchema.parse(withArangoKey(doc)));
  }

  async function wouldCreateCycle(parentKey: string, childKey: string): Promise<boolean> {
    const pending = [childKey];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (current === parentKey) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const children = await listRelations(current);
      pending.push(...children.map((relation) => relation.childKey));
    }
    return false;
  }

  return {
    async createScope(input) {
      const parsed = scopeSchema.parse({ ...input, key: input.key ?? newId() });
      const scope = {
        ...parsed,
        embedding: await generateEmbedding(buildEmbeddingText(scopesEmbedKeys.options, parsed)!),
      } satisfies Scope;
      try {
        const result = await database.collection(SCOPES_COLLECTION).save(toArangoDoc({ ...scope, ...embeddingMetadata() }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        const created = (saved ? scopeSchema.parse(withArangoKey(saved)) : scope) satisfies Scope;
        await recordEvent({ scopeId: created.key, slug: 'scope.create', data: { nodeType: 'scopes', nodeKey: created.key } });
        return created;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeSlugError(scope.organizationKey, scope.slug);
        }
        throw error;
      }
    },

    async updateScope(scopeKey, input) {
      const current = await requireScope(scopeKey);
      const parsed = scopeSchema.parse({ ...current, ...input });
      const embedding = await generateEmbedding(buildEmbeddingText(scopesEmbedKeys.options, parsed)!);
      const result = await database.collection(SCOPES_COLLECTION).update(scopeKey, { ...input, embedding, ...embeddingMetadata() }, { returnNew: true });
      const saved = (result as { new?: Record<string, unknown> }).new;
      const updated = saved ? scopeSchema.parse(withArangoKey(saved)) : { ...parsed, embedding };
      await recordEvent({ scopeId: updated.key, slug: 'scope.update', data: { nodeType: 'scopes', nodeKey: updated.key } });
      return updated;
    },

    async getScopeByKey(scopeKey) {
      try {
        const doc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
        return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (error) {
        if (isArangoNotFoundError(error)) return null;
        throw error;
      }
    },

    async listScopes(organizationKey) {
      const validOrganizationKey = parseOrganizationKey(organizationKey);
      const cursor = await database.query(
        `
          FOR scope IN @@collection
            FILTER scope.organizationKey == @organizationKey
              && REGEX_TEST(scope._key, "^c[^\\\\s-]{8,}$", true)
            SORT scope.name ASC, scope._key ASC
            RETURN scope
        `,
        { '@collection': SCOPES_COLLECTION, organizationKey: validOrganizationKey },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => scopeSchema.parse(withArangoKey(doc)));
    },

    async removeScope(scopeKey) {
      await requireScope(scopeKey);
      await database.query(
        `
          FOR relation IN @@collection
            FILTER relation.parentKey == @scopeKey || relation.childKey == @scopeKey
            REMOVE relation IN @@collection
        `,
        { '@collection': SCOPE_SCOPES_COLLECTION, scopeKey },
      );
      await database.query(
        `
          FOR member IN @@collection
            FILTER member.scopeKey == @scopeKey
            REMOVE member IN @@collection
        `,
        { '@collection': SCOPE_MEMBERS_COLLECTION, scopeKey },
      );
      await database.collection(SCOPES_COLLECTION).remove(scopeKey);
    },

    async addScopeRelation(parentKey, childKey) {
      const [parent, child] = await Promise.all([requireScope(parentKey), requireScope(childKey)]);
      const relation = scopeScopeSchema.parse({ key: newId(), parentKey, childKey, level: parent.level + 1 });
      if (parent.organizationKey !== child.organizationKey) {
        throw new ScopeOrganizationMismatchError(parentKey, childKey);
      }

      const existingParentCursor = await database.query(
        'FOR relation IN @@collection FILTER relation.childKey == @childKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, childKey },
      );
      if (await existingParentCursor.next()) throw new ScopeAlreadyHasParentError(childKey);

      if (await wouldCreateCycle(parentKey, childKey)) {
        throw new ScopeCycleError(parentKey, childKey);
      }

      try {
        const result = await database.collection(SCOPE_SCOPES_COLLECTION).save(toArangoDoc(relation), { returnNew: true });
        await database.collection(SCOPES_COLLECTION).update(child.key, { level: relation.level });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeScopeSchema.parse(withArangoKey(saved)) : relation) satisfies ScopeScope;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeRelationError(parentKey, childKey);
        }
        throw error;
      }
    },

    async removeScopeRelation(parentKey, childKey) {
      const cursor = await database.query(
        'FOR relation IN @@collection FILTER relation.parentKey == @parentKey && relation.childKey == @childKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, parentKey, childKey },
      );
      const raw = await cursor.next();
      if (!raw) throw new ScopeRelationNotFoundError(parentKey, childKey);
      const relation = scopeScopeSchema.parse(withArangoKey(raw as Record<string, unknown>));
      await database.collection(SCOPE_SCOPES_COLLECTION).remove(relation.key);
    },

    listChildRelations(parentKey) {
      return listRelations(parentKey);
    },
  };
}

function parseOrganizationKey(value: string): string {
  return scopeSchema.shape.organizationKey.parse(value);
}

let cachedDefaultRepository: ScopeRepository | null = null;

export function getDefaultScopeRepository(): ScopeRepository {
  cachedDefaultRepository ??= createScopeRepository();
  return cachedDefaultRepository;
}
