import { db } from '@/lib/db/client';
import { ORGANIZATION_PROVIDERS_COLLECTION } from './schema';
import type { OrganizationProvidersSetupDatabase } from './types';

/**
 * Idempotent setup for the `organization_providers` collection: creates
 * the collection when missing and ensures the unique persistent compound
 * index over (organizationId, providerId). `ensureIndex` is a no-op when
 * an identical index already exists, so this is safe to run on every
 * deploy — it is called from `src/db/arango-migrate.ts`.
 */
export async function ensureOrganizationProvidersCollection(
  database: OrganizationProvidersSetupDatabase = db,
): Promise<void> {
  const collection = database.collection(ORGANIZATION_PROVIDERS_COLLECTION);
  if (!(await collection.exists())) {
    await collection.create();
  }
  await collection.ensureIndex({
    type: 'persistent',
    fields: ['organizationId', 'providerId'],
    unique: true,
  });
}
