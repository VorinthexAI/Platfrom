import { db } from '@/lib/db/client';
import { ORGANIZATION_CONNECTORS_COLLECTION } from './connector-schema';

export async function ensureOrganizationConnectorsCollection(database: Pick<typeof db, 'collection'> = db) {
  const collection = database.collection(ORGANIZATION_CONNECTORS_COLLECTION);
  if (!(await collection.exists())) await collection.create();
  for (const index of await collection.indexes()) {
    const fields = 'fields' in index && Array.isArray(index.fields) ? index.fields.map(String) : [];
    if (fields.join(',') === 'organizationKey,scopeKey,provider,providerAccountId') await collection.dropIndex(index.id);
  }
  await collection.ensureIndex({ type: 'persistent', fields: ['organizationKey', 'scopeKey', 'provider'], unique: true });
  await collection.ensureIndex({ type: 'persistent', fields: ['scopeKey', 'provider', 'status'] });
}
