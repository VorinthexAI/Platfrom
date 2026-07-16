import { db } from '@/lib/db/client';
import { buildEmbeddingText, isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { embed } from '@/lib/embed';
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
  ScopePositionConflictError,
  ScopeRelationNotFoundError,
  type ScopeRepository,
  type ScopesDatabase,
} from './types';

export function createScopeRepository(database: ScopesDatabase = db): ScopeRepository {
  async function requireScope(scopeKey: string): Promise<Scope> {
    try {
      const doc = await database.collection(SCOPES_COLLECTION).document(scopeKey);
      return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
    } catch (error) {
      if (isArangoNotFoundError(error)) throw new ScopeNotFoundError(scopeKey);
      throw error;
    }
  }

  async function listRelations(parentScopeKey: string): Promise<ScopeScope[]> {
    const cursor = await database.query(
      `
        FOR relation IN @@collection
          FILTER relation.parentScopeKey == @parentScopeKey
          SORT relation.position ASC, relation._key ASC
          RETURN relation
      `,
      { '@collection': SCOPE_SCOPES_COLLECTION, parentScopeKey },
    );
    const docs = await cursor.all();
    return (docs as Record<string, unknown>[]).map((doc) => scopeScopeSchema.parse(withArangoKey(doc)));
  }

  async function wouldCreateCycle(parentScopeKey: string, childScopeKey: string): Promise<boolean> {
    const pending = [childScopeKey];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (current === parentScopeKey) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const children = await listRelations(current);
      pending.push(...children.map((relation) => relation.childScopeKey));
    }
    return false;
  }

  return {
    async createScope(input) {
      const parsed = scopeSchema.parse({ ...input, key: newId() });
      const scope = {
        ...parsed,
        embedding: await embed({
          text: buildEmbeddingText(scopesEmbedKeys.options, parsed)!,
        }),
      } satisfies Scope;
      try {
        const result = await database.collection(SCOPES_COLLECTION).save(toArangoDoc(scope), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeSchema.parse(withArangoKey(saved)) : scope) satisfies Scope;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeSlugError(scope.organizationKey, scope.slug);
        }
        throw error;
      }
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
      const validOrganizationKey = zCuid(organizationKey);
      const cursor = await database.query(
        `
          FOR scope IN @@collection
            FILTER scope.organizationKey == @organizationKey
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
            FILTER relation.parentScopeKey == @scopeKey || relation.childScopeKey == @scopeKey
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

    async addScopeRelation(parentScopeKey, childScopeKey, position) {
      const relation = scopeScopeSchema.parse({ key: newId(), parentScopeKey, childScopeKey, position });
      const [parent, child] = await Promise.all([requireScope(parentScopeKey), requireScope(childScopeKey)]);
      if (parent.organizationKey !== child.organizationKey) {
        throw new ScopeOrganizationMismatchError(parentScopeKey, childScopeKey);
      }

      const existingParentCursor = await database.query(
        'FOR relation IN @@collection FILTER relation.childScopeKey == @childScopeKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, childScopeKey },
      );
      if (await existingParentCursor.next()) throw new ScopeAlreadyHasParentError(childScopeKey);

      const positionCursor = await database.query(
        'FOR relation IN @@collection FILTER relation.parentScopeKey == @parentScopeKey && relation.position == @position LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, parentScopeKey, position },
      );
      if (await positionCursor.next()) throw new ScopePositionConflictError(parentScopeKey, position);
      if (await wouldCreateCycle(parentScopeKey, childScopeKey)) {
        throw new ScopeCycleError(parentScopeKey, childScopeKey);
      }

      try {
        const result = await database.collection(SCOPE_SCOPES_COLLECTION).save(toArangoDoc(relation), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeScopeSchema.parse(withArangoKey(saved)) : relation) satisfies ScopeScope;
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) {
          throw new DuplicateScopeRelationError(parentScopeKey, childScopeKey);
        }
        throw error;
      }
    },

    async removeScopeRelation(parentScopeKey, childScopeKey) {
      const cursor = await database.query(
        'FOR relation IN @@collection FILTER relation.parentScopeKey == @parentScopeKey && relation.childScopeKey == @childScopeKey LIMIT 1 RETURN relation',
        { '@collection': SCOPE_SCOPES_COLLECTION, parentScopeKey, childScopeKey },
      );
      const raw = await cursor.next();
      if (!raw) throw new ScopeRelationNotFoundError(parentScopeKey, childScopeKey);
      const relation = scopeScopeSchema.parse(withArangoKey(raw as Record<string, unknown>));
      await database.collection(SCOPE_SCOPES_COLLECTION).remove(relation.key);
    },

    listChildRelations(parentScopeKey) {
      return listRelations(parentScopeKey);
    },
  };
}

function zCuid(value: string): string {
  return scopeSchema.shape.organizationKey.parse(value);
}

let cachedDefaultRepository: ScopeRepository | null = null;

export function getDefaultScopeRepository(): ScopeRepository {
  cachedDefaultRepository ??= createScopeRepository();
  return cachedDefaultRepository;
}
