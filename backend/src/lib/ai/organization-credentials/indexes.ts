import { db } from '@/lib/db/client';
import { ORGANIZATION_CREDENTIALS_COLLECTION } from './schema';
import type { OrganizationCredentialsSetupDatabase } from './types';

export async function ensureOrganizationCredentialsCollection(database: OrganizationCredentialsSetupDatabase = db): Promise<void> {
  const collection = database.collection(ORGANIZATION_CREDENTIALS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'providerKey'], unique: true });
}
