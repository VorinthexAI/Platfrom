import { db } from '@/lib/db/client';
import { isArangoNotFoundError, isArangoUniqueConstraintError, toArangoDoc, withArangoKey } from '@/lib/db/base';
import { newId } from '@/lib/ids';
import { ORGANIZATION_SCOPES_COLLECTION, organizationScopeSchema, type OrganizationScope } from './schema';
import {
  DuplicateOrganizationScopeError,
  InvalidScopeNameError,
  OrganizationScopeNotFoundError,
  type OrganizationScopeRepository,
  type OrganizationScopesDatabase,
} from './types';

/**
 * Data access for `organization_scopes`. Application code only ever
 * handles `key`; the `_key` rename happens exclusively through the shared
 * base.ts translators. All queries are parameterized.
 */
export function createOrganizationScopeRepository(
  database: OrganizationScopesDatabase = db,
): OrganizationScopeRepository {
  return {
    async createScope(name) {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (trimmed.length === 0) throw new InvalidScopeNameError();
      const scope = organizationScopeSchema.parse({ key: newId(), name: trimmed });
      try {
        const result = await database
          .collection(ORGANIZATION_SCOPES_COLLECTION)
          .save(toArangoDoc({ ...scope }), { returnNew: true });
        const saved = (result as { new?: Record<string, unknown> }).new;
        return (saved ? organizationScopeSchema.parse(withArangoKey(saved)) : scope) satisfies OrganizationScope;
      } catch (err) {
        if (isArangoUniqueConstraintError(err)) throw new DuplicateOrganizationScopeError(trimmed);
        throw err;
      }
    },

    async getScopeById(scopeId) {
      try {
        const doc = await database.collection(ORGANIZATION_SCOPES_COLLECTION).document(scopeId);
        return organizationScopeSchema.parse(withArangoKey(doc as Record<string, unknown>));
      } catch (err) {
        if (isArangoNotFoundError(err)) return null;
        throw err;
      }
    },

    async listScopes() {
      const cursor = await database.query(
        `
          FOR doc IN @@collection
            SORT doc.name ASC
            RETURN doc
        `,
        { '@collection': ORGANIZATION_SCOPES_COLLECTION },
      );
      const docs = await cursor.all();
      return (docs as Record<string, unknown>[]).map((doc) => organizationScopeSchema.parse(withArangoKey(doc)));
    },

    async removeScope(scopeId) {
      try {
        await database.collection(ORGANIZATION_SCOPES_COLLECTION).remove(scopeId);
      } catch (err) {
        if (isArangoNotFoundError(err)) throw new OrganizationScopeNotFoundError(scopeId);
        throw err;
      }
    },
  };
}

let cachedDefaultRepository: OrganizationScopeRepository | null = null;

/** Process-wide repository bound to the shared ArangoDB client. */
export function getDefaultOrganizationScopeRepository(): OrganizationScopeRepository {
  cachedDefaultRepository ??= createOrganizationScopeRepository();
  return cachedDefaultRepository;
}
