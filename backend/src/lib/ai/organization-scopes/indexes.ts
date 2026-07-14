import { db } from '@/lib/db/client';
import { ORGANIZATION_SCOPES_COLLECTION } from './schema';
import type { OrganizationScopesSetupDatabase } from './types';

/**
 * Idempotent setup for `organizationScopes`: creates the collection when
 * missing and ensures a unique persistent index on `name` so two scopes
 * can never share a name. Safe to run on every deploy — called from
 * `src/db/arango-migrate.ts`.
 */
export async function ensureOrganizationScopesCollection(
  database: OrganizationScopesSetupDatabase = db,
): Promise<void> {
  const collection = database.collection(ORGANIZATION_SCOPES_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['name'], unique: true });
}
