import { db } from '@/lib/db/client';
import { isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import {
  SCOPE_CHILDREN_COLLECTION,
  SCOPE_USERS_COLLECTION,
  SCOPES_COLLECTION,
  scopeChildKey,
  scopeChildSchema,
  scopeSchema,
  scopeUserKey,
  scopeUserSchema,
  type Scope,
  type ScopeChild,
  type ScopeUser,
} from './schema';
import {
  DuplicateScopeChildError,
  DuplicateScopeError,
  DuplicateScopeUserError,
  InvalidScopeDescriptionError,
  InvalidScopeNameError,
  InvalidScopeOrganizationError,
  InvalidScopeUserError,
  ScopeChildNotFoundError,
  ScopeNotFoundError,
  ScopeOrganizationMismatchError,
  ScopeUserNotFoundError,
  SelfScopeChildError,
  type ScopeRepository,
  type ScopesDatabase,
} from './types';

function requireTrimmed(value: unknown, error: () => Error): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) throw error();
  return trimmed;
}

/**
 * Data access for the scope tree (`scopes`, `scopeChildren`, `scopeUsers`).
 * Application code only ever handles `key`; the `_key` rename happens
 * exclusively through the shared base.ts translators. All queries are
 * parameterized — untrusted strings are never interpolated into AQL.
 */
export function createScopeRepository(database: ScopesDatabase = db): ScopeRepository {
  async function requireScope(scopeId: string): Promise<Scope> {
    try {
      const doc = await database.collection(SCOPES_COLLECTION).document(scopeId);
      return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
    } catch (err) {
      if (isArangoNotFoundError(err)) throw new ScopeNotFoundError(scopeId);
      throw err;
    }
  }

  return {
    async createScope(input) {
      const organizationId = requireTrimmed(input.organizationId, () => new InvalidScopeOrganizationError());
      const name = requireTrimmed(input.name, () => new InvalidScopeNameError());
      const description = requireTrimmed(input.description, () => new InvalidScopeDescriptionError());
      const now = new Date().toISOString();
      const scope = scopeSchema.parse({
        key: newId(),
        organizationId,
        name,
        description,
        createdAt: now,
        updatedAt: now,
      });
      try {
        const result = await database
          .collection(SCOPES_COLLECTION)
          .save(toArangoDoc({ ...scope }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeSchema.parse(withArangoKey(saved)) : scope) satisfies Scope;
      } catch (err) {
        if (isArangoUniqueConstraintError(err)) throw new DuplicateScopeError(organizationId, name);
        throw err;
      }
    },

    async getScopeById(scopeId) {
      try {
        const doc = await database.collection(SCOPES_COLLECTION).document(scopeId);
        return scopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (err) {
        if (isArangoNotFoundError(err)) return null;
        throw err;
      }
    },

    async listScopes(organizationId) {
      const validOrganizationId = requireTrimmed(organizationId, () => new InvalidScopeOrganizationError());
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.organizationId == @organizationId
            SORT doc.name ASC
            RETURN doc
        `,
        { '@collection': SCOPES_COLLECTION, organizationId: validOrganizationId },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => scopeSchema.parse(withArangoKey(doc)));
    },

    async removeScope(scopeId) {
      try {
        await database.collection(SCOPES_COLLECTION).remove(scopeId);
      } catch (err) {
        if (isArangoNotFoundError(err)) throw new ScopeNotFoundError(scopeId);
        throw err;
      }
      // A deleted scope leaves no dangling links: its tree edges (either
      // direction) and its memberships go with it.
      await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.parentScopeId == @scopeId || doc.childScopeId == @scopeId
            REMOVE doc IN @@collection
        `,
        { '@collection': SCOPE_CHILDREN_COLLECTION, scopeId },
      );
      await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.scopeId == @scopeId
            REMOVE doc IN @@collection
        `,
        { '@collection': SCOPE_USERS_COLLECTION, scopeId },
      );
    },

    async addChild(parentScopeId, childScopeId) {
      if (parentScopeId === childScopeId) throw new SelfScopeChildError(parentScopeId);
      const parent = await requireScope(parentScopeId);
      const child = await requireScope(childScopeId);
      // The tree never crosses tenants: both ends must belong to the same
      // organization.
      if (parent.organizationId !== child.organizationId) {
        throw new ScopeOrganizationMismatchError(parentScopeId, childScopeId);
      }
      const link = scopeChildSchema.parse({
        key: scopeChildKey(parentScopeId, childScopeId),
        parentScopeId,
        childScopeId,
      });
      try {
        const result = await database
          .collection(SCOPE_CHILDREN_COLLECTION)
          .save(toArangoDoc({ ...link }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeChildSchema.parse(withArangoKey(saved)) : link) satisfies ScopeChild;
      } catch (err) {
        if (isArangoUniqueConstraintError(err)) throw new DuplicateScopeChildError(parentScopeId, childScopeId);
        throw err;
      }
    },

    async removeChild(parentScopeId, childScopeId) {
      try {
        await database.collection(SCOPE_CHILDREN_COLLECTION).remove(scopeChildKey(parentScopeId, childScopeId));
      } catch (err) {
        if (isArangoNotFoundError(err)) throw new ScopeChildNotFoundError(parentScopeId, childScopeId);
        throw err;
      }
    },

    async listChildScopeIds(parentScopeId) {
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.parentScopeId == @parentScopeId
            SORT doc.childScopeId ASC
            RETURN doc.childScopeId
        `,
        { '@collection': SCOPE_CHILDREN_COLLECTION, parentScopeId },
      );
      const raw = await cursor.all();
      return (raw as unknown[]).filter((value): value is string => typeof value === 'string' && value.length > 0);
    },

    async addUser(scopeId, userId) {
      const validUserId = requireTrimmed(userId, () => new InvalidScopeUserError());
      await requireScope(scopeId);
      const link = scopeUserSchema.parse({
        key: scopeUserKey(scopeId, validUserId),
        scopeId,
        userId: validUserId,
      });
      try {
        const result = await database
          .collection(SCOPE_USERS_COLLECTION)
          .save(toArangoDoc({ ...link }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? scopeUserSchema.parse(withArangoKey(saved)) : link) satisfies ScopeUser;
      } catch (err) {
        if (isArangoUniqueConstraintError(err)) throw new DuplicateScopeUserError(scopeId, validUserId);
        throw err;
      }
    },

    async removeUser(scopeId, userId) {
      try {
        await database.collection(SCOPE_USERS_COLLECTION).remove(scopeUserKey(scopeId, userId));
      } catch (err) {
        if (isArangoNotFoundError(err)) throw new ScopeUserNotFoundError(scopeId, userId);
        throw err;
      }
    },

    async listUserIds(scopeId) {
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            FILTER doc.scopeId == @scopeId
            SORT doc.userId ASC
            RETURN doc.userId
        `,
        { '@collection': SCOPE_USERS_COLLECTION, scopeId },
      );
      const raw = await cursor.all();
      return (raw as unknown[]).filter((value): value is string => typeof value === 'string' && value.length > 0);
    },
  };
}

let cachedDefaultRepository: ScopeRepository | null = null;

/** Process-wide repository bound to the shared ArangoDB client. */
export function getDefaultScopeRepository(): ScopeRepository {
  cachedDefaultRepository ??= createScopeRepository();
  return cachedDefaultRepository;
}
