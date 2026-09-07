import { db } from '@/lib/db/client';
import { scopeSchema, type Scope } from '@/lib/ai/scopes';
import { CANONICAL_APPS, PRODUCT_SCOPE_SLUGS } from './registry';

type ProductCatalogDatabase = Pick<typeof db, 'query'>;

export function createProductScopeRepository(database: ProductCatalogDatabase = db) {
  return {
    async list(): Promise<Scope[]> {
      const cursor = await database.query(`
        LET rootTeams = (FOR team IN teams FILTER team.is_root == true RETURN team._key)
        FILTER LENGTH(rootTeams) == 1
        FOR scope IN scopes
          FILTER scope.teamKey == rootTeams[0] && scope.slug IN @slugs
          SORT scope.slug ASC, scope._key ASC
          RETURN scope
      `, { slugs: PRODUCT_SCOPE_SLUGS });
      return (await cursor.all() as Record<string, unknown>[]).map((scope) => scopeSchema.parse({ ...scope, key: scope._key }));
    },
  };
}

export async function requireProductScopes(repository: ReturnType<typeof createProductScopeRepository> = createProductScopeRepository()) {
  const scopes = await repository.list();
  const bySlug = new Map(scopes.map((scope) => [scope.slug, scope]));
  const missing = CANONICAL_APPS.filter(({ slug }) => !bySlug.has(slug)).map(({ slug }) => slug);
  if (scopes.length !== CANONICAL_APPS.length || missing.length) {
    throw new Error(`Product scope catalog is incomplete; expected exactly seven designated root-team scopes${missing.length ? ` (missing: ${missing.join(', ')})` : ''}.`);
  }
  return bySlug;
}
